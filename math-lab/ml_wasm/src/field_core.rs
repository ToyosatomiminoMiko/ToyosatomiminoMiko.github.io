use evalexpr::{build_operator_tree, ContextWithMutableVariables, HashMapContext, Value};

use crate::surface_utils::register_builtins;

// ================================================================
// field_core — 标量场 / 向量场的梯度\散度\旋度数值核心
//
// 架构流程:
//   mathjs 负责解析表达式并生成符号偏导表达式
//     -> Rust 负责在给定点和系数下做数值求值
//     -> wasm-bindgen 暴露给 Worker / 主线程
//
// 这里只做数值计算,不处理 UI,也不重复实现符号微分.
// ================================================================

/// 构建带系数和坐标的求值上下文.
fn build_context(
    coeff_names: &[String],
    coeff_values: &[f64],
    x: f64,
    y: f64,
    z: f64,
) -> Result<HashMapContext, String> {
    let mut ctx = HashMapContext::new();

    for (name, &value) in coeff_names.iter().zip(coeff_values.iter()) {
        ctx.set_value(name.clone(), Value::Float(value))
            .map_err(|e| format!("设置系数'{}'失败: {}", name, e))?;
    }

    ctx.set_value("x".to_string(), Value::Float(x))
        .map_err(|e| format!("设置 x 失败: {}", e))?;
    ctx.set_value("y".to_string(), Value::Float(y))
        .map_err(|e| format!("设置 y 失败: {}", e))?;
    ctx.set_value("z".to_string(), Value::Float(z))
        .map_err(|e| format!("设置 z 失败: {}", e))?;

    register_builtins(&mut ctx);
    Ok(ctx)
}

/// 求值一个标量表达式.
fn eval_scalar(expr: &str, ctx: &HashMapContext) -> Result<f64, String> {
    let node = build_operator_tree(expr).map_err(|e| format!("表达式解析失败: {}", e))?;

    match node.eval_with_context(ctx) {
        Ok(Value::Float(value)) if value.is_finite() => Ok(value),
        Ok(Value::Int(value)) => Ok(value as f64),
        Ok(_) => Err("表达式结果不是数值".to_string()),
        Err(e) => Err(format!("表达式求值失败: {}", e)),
    }
}

// ================================================================
// 梯度
// ================================================================

/// 标量场 f(x, y) 在 (x, y) 处的梯度:
///   ∇f = (∂f/∂x, ∂f/∂y)
pub fn evaluate_gradient_point(
    surface_expr: &str,
    fx_expr: &str,
    fy_expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    x: f64,
    y: f64,
) -> Result<(f64, f64, f64), String> {
    let ctx = build_context(coeff_names, coeff_values, x, y, 0.0)?;

    let f0 = eval_scalar(surface_expr, &ctx)?;
    let fx = eval_scalar(fx_expr, &ctx)?;
    let fy = eval_scalar(fy_expr, &ctx)?;

    Ok((f0, fx, fy))
}

// ================================================================
// 散度
// ================================================================

/// 向量场 F(x, y, z) = (P, Q, R) 的散度:
///   ∇·F = ∂P/∂x + ∂Q/∂y + ∂R/∂z
pub fn evaluate_divergence_point(
    dpx_expr: &str,
    dqy_expr: &str,
    drz_expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    x: f64,
    y: f64,
    z: f64,
) -> Result<f64, String> {
    let ctx = build_context(coeff_names, coeff_values, x, y, z)?;

    let dpx = eval_scalar(dpx_expr, &ctx)?;
    let dqy = eval_scalar(dqy_expr, &ctx)?;
    let drz = eval_scalar(drz_expr, &ctx)?;

    Ok(dpx + dqy + drz)
}

// ================================================================
// 旋度
// ================================================================

/// 向量场 F(x, y, z) = (P, Q, R) 的旋度:
///   ∇×F = (∂R/∂y - ∂Q/∂z,
///           ∂P/∂z - ∂R/∂x,
///           ∂Q/∂x - ∂P/∂y)
pub fn evaluate_curl_point(
    dr_dy_expr: &str,
    dq_dz_expr: &str,
    dp_dz_expr: &str,
    dr_dx_expr: &str,
    dq_dx_expr: &str,
    dp_dy_expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    x: f64,
    y: f64,
    z: f64,
) -> Result<(f64, f64, f64), String> {
    let ctx = build_context(coeff_names, coeff_values, x, y, z)?;

    let dr_dy = eval_scalar(dr_dy_expr, &ctx)?;
    let dq_dz = eval_scalar(dq_dz_expr, &ctx)?;
    let dp_dz = eval_scalar(dp_dz_expr, &ctx)?;
    let dr_dx = eval_scalar(dr_dx_expr, &ctx)?;
    let dq_dx = eval_scalar(dq_dx_expr, &ctx)?;
    let dp_dy = eval_scalar(dp_dy_expr, &ctx)?;

    Ok((dr_dy - dq_dz, dp_dz - dr_dx, dq_dx - dp_dy))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_coeffs() -> (Vec<String>, Vec<f64>) {
        (Vec::new(), Vec::new())
    }

    #[test]
    fn gradient_of_quadratic_surface() {
        let (names, values) = no_coeffs();
        let (f0, fx, fy) =
            evaluate_gradient_point("x^2 + y^2", "2 * x", "2 * y", &names, &values, 3.0, 4.0)
                .unwrap();

        assert!((f0 - 25.0).abs() < 1e-9);
        assert!((fx - 6.0).abs() < 1e-9);
        assert!((fy - 8.0).abs() < 1e-9);
    }

    #[test]
    fn divergence_of_identity_field() {
        let (names, values) = no_coeffs();
        let value =
            evaluate_divergence_point("1", "1", "1", &names, &values, 2.0, -3.0, 7.0).unwrap();

        assert!((value - 3.0).abs() < 1e-9);
    }

    #[test]
    fn curl_of_rotational_field() {
        let (names, values) = no_coeffs();
        let (cx, cy, cz) = evaluate_curl_point(
            "0", "0", "0", "0", "1", "-1", &names, &values, 1.0, 2.0, 3.0,
        )
        .unwrap();

        assert!(cx.abs() < 1e-9);
        assert!(cy.abs() < 1e-9);
        assert!((cz - 2.0).abs() < 1e-9);
    }
}
