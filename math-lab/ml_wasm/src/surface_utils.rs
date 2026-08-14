use evalexpr::{
    build_operator_tree, ContextWithMutableFunctions, ContextWithMutableVariables, Function,
    HashMapContext, Value,
};

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

    for chunk in full_indices.chunks_exact(3) {
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
// HSL -> RGB 辅助函数 (标准算法, 对齐 Three.js Color.setHSL)
// ================================================================

// h, s, l 均在 [0, 1] 范围, 返回 (r, g, b) 各分量 ∈ [0, 1]
fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    if s == 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    let r = hue_to_rgb(p, q, h + 1.0 / 3.0);
    let g = hue_to_rgb(p, q, h);
    let b = hue_to_rgb(p, q, h - 1.0 / 3.0);
    (r, g, b)
}

fn hue_to_rgb(p: f64, q: f64, t: f64) -> f64 {
    let mut t = t;
    if t < 0.0 {
        t += 1.0;
    }
    if t > 1.0 {
        t -= 1.0;
    }
    if t < 1.0 / 6.0 {
        return p + (q - p) * 6.0 * t;
    }
    if t < 1.0 / 2.0 {
        return q;
    }
    if t < 2.0 / 3.0 {
        return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    }
    p
}

// ================================================================
// 统一后处理结果结构体
// ================================================================
pub struct SurfaceSampleResult {
    pub positions: Vec<f32>,
    pub colors: Vec<f32>,
    pub valid_indices: Vec<u32>,
    pub normals: Vec<f32>,
    pub z_min: f64,
    pub z_max: f64,
}
// ================================================================
// 统一后处理: 极值扫描 + HSL颜色映射 + NaN三角形剔除
// ================================================================

// 向 context 中注册 evalexpr 默认不包含的常用数学函数
// HashMapContext 内置只有基础算术,sin/cos/exp 等需要手动注册
pub(crate) fn register_builtins(ctx: &mut HashMapContext) {
    let funcs: &[(&str, fn(f64) -> f64)] = &[
        ("sin", f64::sin),
        ("cos", f64::cos),
        ("tan", f64::tan),
        ("asin", f64::asin),
        ("acos", f64::acos),
        ("atan", f64::atan),
        ("sinh", f64::sinh),
        ("cosh", f64::cosh),
        ("tanh", f64::tanh),
        ("exp", f64::exp),
        ("ln", f64::ln),
        ("log10", f64::log10),
        ("log2", f64::log2),
        ("sqrt", f64::sqrt),
        ("abs", f64::abs),
    ];

    for &(name, f) in funcs {
        ctx.set_function(
            name.to_string(),
            Function::new(move |arg: &Value| Ok(Value::Float(f(arg.as_float()?)))),
        )
        .unwrap(); // <- 这里必须接 .unwrap();
    }
}
/*
输入采样后的扁平坐标数组 positions ([x0,y0,z0, x1,y1,z1, ...])
以及完整三角索引 full_indices, 一次调用完成:
1. 提取所有 z 值 + 全局极值
2. HSL 彩虹颜色映射
3. 剔除含 NaN 的三角形
*/
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
    // 预编译 AST
    let node = build_operator_tree(expr).map_err(|e| format!("表达式解析失败: {}", e))?;

    // 构建 context
    let mut ctx = HashMapContext::new();
    // 注入系数常量
    for (name, &val) in coeff_names.iter().zip(coeff_values.iter()) {
        ctx.set_value(name.clone(), Value::Float(val))
            .map_err(|e| format!("设置系数'{}'失败: {}", name, e))?;
    }
    register_builtins(&mut ctx);

    // 采样循环
    let total = ((cols + 1) * (rows + 1)) as usize;
    let mut positions = Vec::with_capacity(total * 3);
    let mut z_vals = Vec::with_capacity(total);
    let mut z_min = f64::INFINITY;
    let mut z_max = f64::NEG_INFINITY;

    for j in 0..=rows {
        let y = y_min + (y_max - y_min) * (j as f64 / rows as f64);
        for i in 0..=cols {
            let x = x_min + (x_max - x_min) * (i as f64 / cols as f64);

            // 这里每次循环都更新同一个变量 x / y。
            // evalexpr 的 set_value 会返回 Result：
            //   - 变量不存在时，插入新值；
            //   - 变量已存在且类型相同（我们都是 Float），直接覆盖；
            //   - 类型不同才会报错。
            //
            // 本函数已经通过 Result<String> 向 WASM 边界传递错误，
            // 所以采样热路径里不能 unwrap：一旦未来代码改了变量类型，
            // unwrap 会让整个 WASM 模块直接 panic；改成 `?` 则把错误
            // 沿调用链返回给前端诊断，而不是炸掉模块。
            ctx.set_value("x".to_string(), Value::Float(x))
                .map_err(|e| format!("设置采样变量 x 失败: {}", e))?;
            ctx.set_value("y".to_string(), Value::Float(y))
                .map_err(|e| format!("设置采样变量 y 失败: {}", e))?;

            let z: f64 = match node.eval_with_context(&ctx) {
                Ok(Value::Float(v)) if v.is_finite() => v,
                Ok(Value::Int(v)) => v as f64,
                _ => f64::NAN,
            };

            positions.push(x as f32);
            positions.push(y as f32);
            positions.push(z as f32);
            z_vals.push(z);

            if z.is_finite() {
                z_min = z_min.min(z);
                z_max = z_max.max(z);
            }
        }
    }

    // 退化处理
    if !z_min.is_finite() || !z_max.is_finite() {
        z_min = 0.0;
        z_max = 1.0;
    }

    // 后处理(颜色映射 + NaN 三角形剔除)
    let range = z_max - z_min;
    let vertex_count = z_vals.len();
    let mut colors = Vec::with_capacity(vertex_count * 3);

    for &z in &z_vals {
        if z.is_finite() {
            let t = if range > 0.0 {
                (z - z_min) / range
            } else {
                0.5
            };
            let hue = 0.66 - t * 0.66;
            let (r, g, b) = hsl_to_rgb(hue, 0.9, 0.5 + t * 0.3);
            colors.push(r as f32);
            colors.push(g as f32);
            colors.push(b as f32);
        } else {
            colors.push(0.0);
            colors.push(0.0);
            colors.push(0.0);
        }
    }

    let full_indices = generate_full_indices(cols as usize, rows as usize);
    let valid_indices = filter_nan_triangles(&full_indices, &z_vals);
    let normals = compute_vertex_normals(&positions, &valid_indices);

    Ok(SurfaceSampleResult {
        positions,
        colors,
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
    for triangle in valid_indices.chunks_exact(3) {
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
    for normal in normals.chunks_exact_mut(3) {
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
