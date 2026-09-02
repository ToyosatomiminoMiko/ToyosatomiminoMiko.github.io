use crate::eval_core::CompiledEvaluator;

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

    let mut evaluator: CompiledEvaluator = CompiledEvaluator::new(expr, coeff_names, coeff_values)?;

    let mut points: Vec<f32> = Vec::with_capacity((steps + 1) * 3);
    for i in 0..=steps {
        let x = x_min + (x_max - x_min) * (i as f64 / steps as f64);

        if let Some(y) = evaluator.eval_1d(x)? {
            points.push(x as f32);
            points.push(y as f32);
            points.push(0.0);
        }
    }

    Ok(points)
}

/// 在二维网格上采样曲面 z = f(x, y).
///
/// 返回行优先数组 `[f(x0,y0), f(x1,y0), ..., f(xn,ym)]`,长度为
/// `(nx + 1) * (ny + 1)`;非有限值会写成 `NaN`,由调用方决定跳过还是报错.
/// 求交功能需要把两个曲面/一个曲面的隐式差放到同一张网格上做等值线追踪,
/// 因此这里提供批量采样,避免每个网格点重复编译表达式.
#[allow(clippy::too_many_arguments)]
pub fn sample_surface_values(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    nx: usize,
    ny: usize,
) -> Result<Vec<f64>, String> {
    if xa >= xb || ya >= yb {
        return Err("曲面采样需要有效的二维区间".to_string());
    }
    if nx == 0 || ny == 0 {
        return Err("曲面采样需要 nx/ny 均大于 0".to_string());
    }

    let mut evaluator: CompiledEvaluator = CompiledEvaluator::new(expr, coeff_names, coeff_values)?;

    let mut values: Vec<f64> = Vec::with_capacity((nx + 1) * (ny + 1));
    for j in 0..=ny {
        let y = ya + (yb - ya) * (j as f64 / ny as f64);
        for i in 0..=nx {
            let x = xa + (xb - xa) * (i as f64 / nx as f64);
            values.push(evaluator.eval_2d(x, y)?.unwrap_or(f64::NAN));
        }
    }
    Ok(values)
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
        return Err("向量场采样需要 nx/ny/nz 均大于 0".to_string());
    }

    let mut p_evaluator: CompiledEvaluator =
        CompiledEvaluator::new(p_expr, coeff_names, coeff_values)?;
    let mut q_evaluator: CompiledEvaluator =
        CompiledEvaluator::new(q_expr, coeff_names, coeff_values)?;
    let mut r_evaluator: CompiledEvaluator =
        CompiledEvaluator::new(r_expr, coeff_names, coeff_values)?;

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

        for iy in 0..ny {
            let y = y_min + iy as f64 * step_y;

            for ix in 0..nx {
                let x = x_min + ix as f64 * step_x;

                let vx = p_evaluator.eval_at(x, y, z)?.unwrap_or(0.0);
                let vy = q_evaluator.eval_at(x, y, z)?.unwrap_or(0.0);
                let vz = r_evaluator.eval_at(x, y, z)?.unwrap_or(0.0);

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

    let mut evaluator = CompiledEvaluator::new(expr, coeff_names, coeff_values)?;

    match sample_shape {
        "mid" => {
            let h = (b - a) / n as f64;
            let mut values = Vec::with_capacity(n);
            for i in 0..n {
                let x = a + (i as f64 + 0.5) * h;
                values.push(evaluator.eval_1d(x)?.unwrap_or(f64::NAN));
            }
            Ok(values)
        }
        _ => {
            let mut values = Vec::with_capacity(n + 1);
            for i in 0..=n {
                let x = a + (b - a) * (i as f64 / n as f64);
                values.push(evaluator.eval_1d(x)?.unwrap_or(f64::NAN));
            }
            Ok(values)
        }
    }
}

/// 参数较多是因为这是纯函数采样核心;当前不引入请求结构体,
/// 保持与 WASM 边界的扁平参数一一对应,便于定位 FFI 问题.
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

    if sample_shape == "corner" {
        let hx = (xb - xa) / n as f64;
        let hy = (yb - ya) / m as f64;
        let mut values = Vec::with_capacity(n * m);
        let mut evaluator = CompiledEvaluator::new(expr, coeff_names, coeff_values)?;
        for j in 0..m {
            let y = ya + j as f64 * hy;
            for i in 0..n {
                let x = xa + i as f64 * hx;
                values.push(evaluator.eval_2d(x, y)?.unwrap_or(f64::NAN));
            }
        }
        return Ok(values);
    }

    sample_surface_values(expr, coeff_names, coeff_values, xa, xb, ya, yb, n, m)
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
    fn curve_keeps_coefficients_named_like_other_axes() {
        // y/z 在这里是系数而不是采样坐标;一元采样不能覆盖它们.
        let names: Vec<String> = vec!["y".to_string(), "z".to_string()];
        let values: Vec<f64> = vec![2.0, 3.0];
        let points: Vec<f32> = sample_curve("y * x + z", &names, &values, 0.0, 1.0, 1).unwrap();

        assert_eq!(points[1], 3.0);
        assert_eq!(points[4], 5.0);
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

    #[test]
    fn surface_values_sample_row_major_grid() {
        let values = sample_surface_values("x + y", &[], &[], 0.0, 2.0, 0.0, 1.0, 2, 1).unwrap();

        assert_eq!(values.len(), 6);
        assert_eq!(values[0], 0.0); // (0, 0)
        assert_eq!(values[1], 1.0); // (1, 0)
        assert_eq!(values[2], 2.0); // (2, 0)
        assert_eq!(values[3], 1.0); // (0, 1)
        assert_eq!(values[4], 2.0); // (1, 1)
        assert_eq!(values[5], 3.0); // (2, 1)
    }
}
