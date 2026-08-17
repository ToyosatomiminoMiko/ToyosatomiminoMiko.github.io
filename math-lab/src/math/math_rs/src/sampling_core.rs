use crate::eval_core::{build_base_context, compile_expression, evaluate_node_opt, set_variable};

/// 采样一元函数 y = f(x).
///
/// 返回扁平数组 `[x0, y0, 0, x1, y1, 0, ...]`,
/// 非有限值会跳过,因此返回长度可能小于 `(steps + 1) * 3`.
pub fn sample_curve(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    x_min: f64,
    x_max: f64,
    steps: usize,
) -> Result<Vec<f32>, String> {
    if x_min >= x_max {
        return Err("曲线采样需要有效的 x 区间 x_min < x_max".to_string());
    }
    if steps == 0 {
        return Err("曲线采样需要 steps > 0".to_string());
    }

    let node = compile_expression(expr)?;
    let mut ctx = build_base_context(coeff_names, coeff_values)?;

    let mut points = Vec::with_capacity((steps + 1) * 3);
    for i in 0..=steps {
        let x = x_min + (x_max - x_min) * (i as f64 / steps as f64);
        set_variable(&mut ctx, "x", x)?;

        if let Some(y) = evaluate_node_opt(&node, &ctx)? {
            points.push(x as f32);
            points.push(y as f32);
            points.push(0.0);
        }
    }

    Ok(points)
}

/// 在三维网格上采样向量场 F(x, y, z) = [P, Q, R].
///
/// 返回扁平数组 `[vx, vy, vz, vx, vy, vz, ...]`,长度为 `nx * ny * nz * 3`.
/// 单个分量非有限值时按 0 处理,便于渲染层隐藏零向量箭头.
#[allow(clippy::too_many_arguments)]
pub fn sample_vector_field(
    p_expr: &str,
    q_expr: &str,
    r_expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    z_min: f64,
    z_max: f64,
    nx: usize,
    ny: usize,
    nz: usize,
) -> Result<Vec<f32>, String> {
    if x_min >= x_max || y_min >= y_max || z_min >= z_max {
        return Err("向量场采样需要每个轴都有有效的 min < max 区间".to_string());
    }
    if nx == 0 || ny == 0 || nz == 0 {
        return Err("向量场采样需要 nx、ny、nz 均大于 0".to_string());
    }

    let p_node = compile_expression(p_expr)?;
    let q_node = compile_expression(q_expr)?;
    let r_node = compile_expression(r_expr)?;
    let mut ctx = build_base_context(coeff_names, coeff_values)?;

    let step_x = if nx > 1 {
        (x_max - x_min) / (nx - 1) as f64
    } else {
        0.0
    };
    let step_y = if ny > 1 {
        (y_max - y_min) / (ny - 1) as f64
    } else {
        0.0
    };
    let step_z = if nz > 1 {
        (z_max - z_min) / (nz - 1) as f64
    } else {
        0.0
    };

    let mut vectors = Vec::with_capacity(nx * ny * nz * 3);
    for iz in 0..nz {
        let z = z_min + iz as f64 * step_z;
        set_variable(&mut ctx, "z", z)?;

        for iy in 0..ny {
            let y = y_min + iy as f64 * step_y;
            set_variable(&mut ctx, "y", y)?;

            for ix in 0..nx {
                let x = x_min + ix as f64 * step_x;
                set_variable(&mut ctx, "x", x)?;

                let vx = evaluate_node_opt(&p_node, &ctx)?.unwrap_or(0.0);
                let vy = evaluate_node_opt(&q_node, &ctx)?.unwrap_or(0.0);
                let vz = evaluate_node_opt(&r_node, &ctx)?.unwrap_or(0.0);

                vectors.push(vx as f32);
                vectors.push(vy as f32);
                vectors.push(vz as f32);
            }
        }
    }

    Ok(vectors)
}

pub fn sample_function_1d(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    a: f64,
    b: f64,
    n: usize,
    sample_shape: &str,
) -> Result<Vec<f64>, String> {
    if a >= b {
        return Err("积分采样需要有效的区间 a < b".to_string());
    }
    if n == 0 {
        return Err("积分采样需要 n > 0".to_string());
    }

    let node = compile_expression(expr)?;
    let mut ctx = build_base_context(coeff_names, coeff_values)?;

    match sample_shape {
        "mid" => {
            let h = (b - a) / n as f64;
            let mut values = Vec::with_capacity(n);
            for i in 0..n {
                let x = a + (i as f64 + 0.5) * h;
                set_variable(&mut ctx, "x", x)?;
                values.push(evaluate_node_opt(&node, &ctx)?.unwrap_or(f64::NAN));
            }
            Ok(values)
        }
        _ => {
            let mut values = Vec::with_capacity(n + 1);
            for i in 0..=n {
                let x = a + (b - a) * (i as f64 / n as f64);
                set_variable(&mut ctx, "x", x)?;
                values.push(evaluate_node_opt(&node, &ctx)?.unwrap_or(f64::NAN));
            }
            Ok(values)
        }
    }
}

/// 参数较多是因为这是纯函数采样核心；当前不引入请求结构体，
/// 保持与 WASM 边界的扁平参数一一对应，便于定位 FFI 问题。
#[allow(clippy::too_many_arguments)]
pub fn sample_function_2d(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    n: usize,
    m: usize,
    sample_shape: &str,
) -> Result<Vec<f64>, String> {
    if xa >= xb || ya >= yb {
        return Err("积分采样需要有效的二维区间".to_string());
    }
    if n == 0 || m == 0 {
        return Err("积分采样需要 n 和 m 均大于 0".to_string());
    }

    let node = compile_expression(expr)?;
    let mut ctx = build_base_context(coeff_names, coeff_values)?;

    if sample_shape == "corner" {
        let hx = (xb - xa) / n as f64;
        let hy = (yb - ya) / m as f64;
        let mut values = Vec::with_capacity(n * m);
        for j in 0..m {
            let y = ya + j as f64 * hy;
            set_variable(&mut ctx, "y", y)?;
            for i in 0..n {
                let x = xa + i as f64 * hx;
                set_variable(&mut ctx, "x", x)?;
                values.push(evaluate_node_opt(&node, &ctx)?.unwrap_or(f64::NAN));
            }
        }
        return Ok(values);
    }

    let mut values = Vec::with_capacity((n + 1) * (m + 1));
    for j in 0..=m {
        let y = ya + (yb - ya) * (j as f64 / m as f64);
        set_variable(&mut ctx, "y", y)?;
        for i in 0..=n {
            let x = xa + (xb - xa) * (i as f64 / n as f64);
            set_variable(&mut ctx, "x", x)?;
            values.push(evaluate_node_opt(&node, &ctx)?.unwrap_or(f64::NAN));
        }
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curve_samples_known_linear_function() {
        let points = sample_curve("2 * x + 1", &[], &[], 0.0, 4.0, 4).unwrap();

        assert_eq!(points.len(), 15);
        assert_eq!(points[0], 0.0);
        assert_eq!(points[1], 1.0);
        assert_eq!(points[12], 4.0);
        assert_eq!(points[13], 9.0);
    }

    #[test]
    fn vector_field_uses_zero_for_nonfinite_values() {
        let vectors = sample_vector_field(
            "x",
            "y",
            "z",
            &[],
            &[],
            -1.0,
            1.0,
            -1.0,
            1.0,
            -1.0,
            1.0,
            2,
            2,
            2,
        )
        .unwrap();

        assert_eq!(vectors.len(), 24);
        assert_eq!(vectors[0], -1.0);
        assert_eq!(vectors[1], -1.0);
        assert_eq!(vectors[2], -1.0);
    }
}
