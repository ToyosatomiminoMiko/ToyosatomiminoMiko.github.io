use crate::config::{DEGENERATE_Z_MAX, DEGENERATE_Z_MIN};

/*
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
