// ================================================================
// surface_utils.rs -- 曲面生成:数值采样 + 网格后处理(Rust/WASM 侧)
//
// 职责:把 "z = f(x, y)" 表达式变成可直接交给 Three.js 的网格数据,
// 产出 positions / valid_indices / normals 以及 z_min / z_max.
// 本文件只做几何,不做颜色.
//
// ------------------------------------------------------------------
// 颜色映射已拆到渲染侧(着色器),见 math-lab/src/render/visualization/
// surfaceColorMap.ts:旧的 CPU 路径 map_surface_colors(HSL 伪彩色 +
// color attribute + vertexColors)已从 render_rs 移除;同一套 z->HSL
// 映射搬进了顶点着色器,按 position.z 与 uZRange 每帧实时计算.
// 因此本文件仍需把采样结果的 z 极值(z_min/z_max)回传出去 -- 它是
// 着色器色带区间的数据来源(主线程把它更新进 uZRange uniform).
//
// 曲面生成的完整流程:
//
//   UI 输入(滑杆 / 系数 / 区间)变化
//     -> rAF 脏标记绘制 SurfaceRenderer.draw()
//     -> SurfaceMesh.update()
//     -> SurfaceComputeClient(latest-only,过期请求被丢弃)
//     -> surfaceWorker(独立线程)
//     -> render_rs::sample_and_process_surface(lib.rs 的 wasm 导出)
//         └─ sample_and_process_surface(本文件,编排入口)
//              ① sample_surface_values()    数值采样
//                 委托 math_rs::sampling_core::sample_surface_values:
//                 表达式(CompiledEvaluator)只编译一次,在
//                 (cols+1)×(rows+1) 行优先网格(外 y 内 x)上逐点求值
//                 z = f(x,y),非有限值写为 NaN;再据此组装 positions
//                 (x,y,z 扁平 f32)并统计 z_min/z_max -- 只统计有限 z,
//                 若全部非法则回退 DEGENERATE_Z_MIN/Z_MAX(见 config.rs)
//              ② generate_full_indices()    网格索引
//                 每格拆两个三角形 (a,b,d)+(a,d,c),共 cols·rows·6 个
//              ③ filter_nan_triangles()     无效三角形剔除
//                 丢弃任一顶点 z 为 NaN 的三角形,防止 NaN 面法线经
//                 顶点平均污染相邻正常三角形
//              ④ compute_vertex_normals()   平滑法线
//                 对共享顶点累加三角形面法线再归一化,与 Three.js
//                 BufferGeometry.computeVertexNormals() 语义一致;
//                 放在 WASM 做,避免主线程 O(顶点数) 遍历
//             ↓ 产出
//         SurfaceSampleResult { positions, valid_indices, normals,
//                               z_min, z_max }
//     -> 结果经 Transferable 数组回主线程
//     -> SurfaceMesh._applyResult()
//          · 把 positions / normals / valid_indices 写回预分配的
//            BufferGeometry(几何体只创建一次,高频更新只改 attribute)
//          · colorRange.setRange(z_min, z_max) -> 更新 uZRange uniform
//     -> 渲染(Three.js Phong 材质,渲染侧流程)
//          顶点着色器  surfaceColorFromZ(position.z) -> vSurfaceColor
//                      · t = (z - z_min)/(z_max - z_min),clamp 到 [0,1];
//                        range == 0(平面)时取 FLAT_COLOR_T = 0.5
//                      · NaN/Inf 顶点 -> 黑(其所在三角形已被 ③ 剔除)
//                      · hue 0.66->0,sat 0.9,light 0.5->0.8(HSL 伪彩)
//          片段着色器  diffuseColor.rgb *= vSurfaceColor
//                      (diffuse 乘顶点色;specular 不受影响,
//                       与旧 vertexColors + CPU color 语义一致)
//
// 同步约束:config.rs 中的配色常量(SURFACE_HUE_START / SURFACE_SATURATION /
// SURFACE_LIGHTNESS_BASE / SURFACE_LIGHTNESS_RANGE / FLAT_COLOR_T)必须与
// surfaceColorMap.ts 内嵌的 GLSL 常量保持一致 -- 改任一侧都要同步另一侧.
// ================================================================
use crate::config::{DEGENERATE_Z_MAX, DEGENERATE_Z_MIN};

/**
剔除所有包含 NaN z 值的三角形

原理:任何包含 NaN 顶点的三角形,其面法线为 NaN,
Three.js 的 computeVertexNormals 会把 NaN 通过顶点平均
扩散到相邻的正常三角形,导致高光/阴影异常.

修复:遍历所有三角形,只保留三个顶点 z 值均有限的三角形.

- `z_values[i*3+2]` 对应的 z 值(注意: 实际我们只需要 z 分量, 可以只传 z 数组)

参数:
- `full_indices`: 完整三角形的顶点索引(每 3 个一组)
- `z_values`: 所有顶点的 z 坐标, NaN 表示无效顶点

返回: 过滤后的索引数组, 长度是 3 的倍数
*/
pub fn filter_nan_triangles(full_indices: &[u32], z_values: &[f64]) -> Vec<u32> {
    // 预分配容量(最多等于原始长度)
    let mut filtered = Vec::with_capacity(full_indices.len());

    for chunk in full_indices.as_chunks::<3>().0 {
        let a = chunk[0] as usize;
        let b = chunk[1] as usize;
        let c = chunk[2] as usize;

        // 安全边界检查(Rust 会自动 panic, 但我们可以用 get 避免崩溃)
        if let (Some(&za), Some(&zb), Some(&zc)) =
            (z_values.get(a), z_values.get(b), z_values.get(c))
        {
            if za.is_finite() && zb.is_finite() && zc.is_finite() {
                filtered.extend_from_slice(chunk);
            }
        }
    }
    filtered
}

pub fn generate_full_indices(cols: usize, rows: usize) -> Vec<u32> {
    let mut indices = Vec::with_capacity(cols * rows * 6);
    for j in 0..rows {
        for i in 0..cols {
            let a = (j * (cols + 1) + i) as u32;
            let b = (j * (cols + 1) + i + 1) as u32;
            let c = ((j + 1) * (cols + 1) + i) as u32;
            let d = ((j + 1) * (cols + 1) + i + 1) as u32;
            indices.extend_from_slice(&[a, b, d, a, d, c]);
        }
    }
    indices
}
// ================================================================
// 统一后处理结果结构体
// ================================================================
pub struct SurfaceSampleResult {
    pub positions: Vec<f32>,
    pub valid_indices: Vec<u32>,
    pub normals: Vec<f32>,
    pub z_min: f64,
    pub z_max: f64,
}
// ================================================================
// 采样/索引过滤和法线计算
// ================================================================

/// 曲面网格采样.
///
/// 返回 `(positions, z_vals, z_min, z_max)`.该函数只负责数值采样,
/// 不再掺杂索引过滤或法线计算.
#[allow(clippy::too_many_arguments)]
fn sample_surface_values(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    cols: u32,
    rows: u32,
) -> Result<(Vec<f32>, Vec<f64>, f64, f64), String> {
    let z_vals = math_rs::sampling_core::sample_surface_values(
        expr,
        coeff_names,
        coeff_values,
        x_min,
        x_max,
        y_min,
        y_max,
        cols as usize,
        rows as usize,
    )?;

    let total = z_vals.len();
    let mut positions = Vec::with_capacity(total * 3);
    let mut z_min = f64::INFINITY;
    let mut z_max = f64::NEG_INFINITY;

    for j in 0..=rows {
        let y = y_min + (y_max - y_min) * (j as f64 / rows as f64);
        for i in 0..=cols {
            let x = x_min + (x_max - x_min) * (i as f64 / cols as f64);
            let z = z_vals[(j * (cols + 1) + i) as usize];

            positions.push(x as f32);
            positions.push(y as f32);
            positions.push(z as f32);

            if z.is_finite() {
                z_min = z_min.min(z);
                z_max = z_max.max(z);
            }
        }
    }

    if !z_min.is_finite() || !z_max.is_finite() {
        z_min = DEGENERATE_Z_MIN;
        z_max = DEGENERATE_Z_MAX;
    }

    Ok((positions, z_vals, z_min, z_max))
}

/// 统一编排采样与后处理,保持对 WASM/Worker 的旧入口签名不变.
///
/// 注意:顶点配色(HSL 伪彩色)已移出 CPU 路径,改由渲染侧顶点着色器
/// 依据 `position.z` 与 `(z_min, z_max)` 实时计算,因此这里不再产出 colors.
#[allow(clippy::too_many_arguments)]
pub fn sample_and_process_surface(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    cols: u32,
    rows: u32,
) -> Result<SurfaceSampleResult, String> {
    let (positions, z_vals, z_min, z_max) = sample_surface_values(
        expr,
        coeff_names,
        coeff_values,
        x_min,
        x_max,
        y_min,
        y_max,
        cols,
        rows,
    )?;

    let full_indices = generate_full_indices(cols as usize, rows as usize);
    let valid_indices = filter_nan_triangles(&full_indices, &z_vals);
    let normals = compute_vertex_normals(&positions, &valid_indices);

    Ok(SurfaceSampleResult {
        positions,
        valid_indices,
        normals,
        z_min,
        z_max,
    })
}

// ================================================================
// 顶点法线计算
// ================================================================

/// 根据有效三角形索引计算平滑顶点法线
///
/// 与 Three.js `BufferGeometry.computeVertexNormals()` 的思路一致:
/// 对共享同一顶点的所有三角形面法线做累加,最后归一化
/// 放在 Rust/WASM 中计算,可以避免主线程做 O(顶点数) 的 CPU 遍历
pub fn compute_vertex_normals(positions: &[f32], valid_indices: &[u32]) -> Vec<f32> {
    let mut normals = vec![0.0f32; positions.len()];

    // 第一遍:累加每个三角形对三个顶点的贡献
    for triangle in valid_indices.as_chunks::<3>().0 {
        let ia = triangle[0] as usize;
        let ib = triangle[1] as usize;
        let ic = triangle[2] as usize;

        // 索引理论上都在合法范围内,这里做防御性检查
        if ia >= positions.len() / 3 || ib >= positions.len() / 3 || ic >= positions.len() / 3 {
            continue;
        }

        let a = (
            positions[ia * 3],
            positions[ia * 3 + 1],
            positions[ia * 3 + 2],
        );
        let b = (
            positions[ib * 3],
            positions[ib * 3 + 1],
            positions[ib * 3 + 2],
        );
        let c = (
            positions[ic * 3],
            positions[ic * 3 + 1],
            positions[ic * 3 + 2],
        );

        let abx = b.0 - a.0;
        let aby = b.1 - a.1;
        let abz = b.2 - a.2;
        let acx = c.0 - a.0;
        let acy = c.1 - a.1;
        let acz = c.2 - a.2;

        let nx = aby * acz - abz * acy;
        let ny = abz * acx - abx * acz;
        let nz = abx * acy - aby * acx;

        normals[ia * 3] += nx;
        normals[ia * 3 + 1] += ny;
        normals[ia * 3 + 2] += nz;
        normals[ib * 3] += nx;
        normals[ib * 3 + 1] += ny;
        normals[ib * 3 + 2] += nz;
        normals[ic * 3] += nx;
        normals[ic * 3 + 1] += ny;
        normals[ic * 3 + 2] += nz;
    }

    // 第二遍:归一化,零向量保留为零
    for normal in normals.as_chunks_mut::<3>().0 {
        let x = normal[0];
        let y = normal[1];
        let z = normal[2];
        let length = (x * x + y * y + z * z).sqrt();
        if length > 1e-8 {
            normal[0] = x / length;
            normal[1] = y / length;
            normal[2] = z / length;
        }
    }

    normals
}
