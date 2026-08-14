use evalexpr::{
    build_operator_tree, ContextWithMutableVariables, HashMapContext, Value,
};

use crate::surface_utils::register_builtins;

fn build_context(
    coeff_names: &[String],
    coeff_values: &[f64],
) -> Result<HashMapContext, String> {
    let mut ctx = HashMapContext::new();

    for (name, &value) in coeff_names.iter().zip(coeff_values.iter()) {
        ctx.set_value(name.clone(), Value::Float(value))
            .map_err(|e| format!("设置系数'{}'失败: {}", name, e))?;
    }

    register_builtins(&mut ctx);
    Ok(ctx)
}

fn eval_f64(node: &evalexpr::Node, ctx: &HashMapContext) -> f64 {
    match node.eval_with_context(ctx) {
        Ok(Value::Float(value)) if value.is_finite() => value,
        Ok(Value::Int(value)) => value as f64,
        _ => f64::NAN,
    }
}

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

    let node = build_operator_tree(expr).map_err(|e| format!("表达式解析失败: {}", e))?;
    let mut ctx = build_context(coeff_names, coeff_values)?;

    let mut points = Vec::with_capacity((steps + 1) * 3);
    for i in 0..=steps {
        let x = x_min + (x_max - x_min) * (i as f64 / steps as f64);
        ctx.set_value("x".to_string(), Value::Float(x))
            .map_err(|e| format!("设置 x 失败: {}", e))?;

        let y = eval_f64(&node, &ctx);
        if y.is_finite() {
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

    let p_node = build_operator_tree(p_expr).map_err(|e| format!("P 分量解析失败: {}", e))?;
    let q_node = build_operator_tree(q_expr).map_err(|e| format!("Q 分量解析失败: {}", e))?;
    let r_node = build_operator_tree(r_expr).map_err(|e| format!("R 分量解析失败: {}", e))?;
    let mut ctx = build_context(coeff_names, coeff_values)?;

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
        ctx.set_value("z".to_string(), Value::Float(z))
            .map_err(|e| format!("设置 z 失败: {}", e))?;

        for iy in 0..ny {
            let y = y_min + iy as f64 * step_y;
            ctx.set_value("y".to_string(), Value::Float(y))
                .map_err(|e| format!("设置 y 失败: {}", e))?;

            for ix in 0..nx {
                let x = x_min + ix as f64 * step_x;
                ctx.set_value("x".to_string(), Value::Float(x))
                    .map_err(|e| format!("设置 x 失败: {}", e))?;

                let vx = eval_f64(&p_node, &ctx);
                let vy = eval_f64(&q_node, &ctx);
                let vz = eval_f64(&r_node, &ctx);

                vectors.push(if vx.is_finite() { vx as f32 } else { 0.0 });
                vectors.push(if vy.is_finite() { vy as f32 } else { 0.0 });
                vectors.push(if vz.is_finite() { vz as f32 } else { 0.0 });
            }
        }
    }

    Ok(vectors)
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
            "x", "y", "z", &[], &[], -1.0, 1.0, -1.0, 1.0, -1.0, 1.0, 2, 2, 2,
        )
        .unwrap();

        assert_eq!(vectors.len(), 24);
        assert_eq!(vectors[0], -1.0);
        assert_eq!(vectors[1], -1.0);
        assert_eq!(vectors[2], -1.0);
    }
}
