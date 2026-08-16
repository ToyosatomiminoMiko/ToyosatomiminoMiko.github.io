use evalexpr::HashMapContext;

use crate::eval_core::{build_base_context, compile_expression, evaluate_node, set_variable};

// ================================================================
// field_core — 标量场 / 向量场的梯度\散度\旋度数值核心
//
// 架构流程:
//   mathjs 负责解析表达式并生成符号偏导表达式
//     -> Rust 负责在给定点和系数下做数值求值
//     -> wasm-bindgen 暴露给 Worker / 主线程
//
// 这里只做数值计算,不处理 UI,也不重复实现符号微分.
// evaluate(求值方法)
//
// ∇(Nabla)的定义:
// ∇ = ∂/∂x + ∂/∂y + ∂/∂z
// ================================================================

/// 构建带系数和坐标的求值上下文。
fn build_context_with_point(
    coeff_names: &[String],
    coeff_values: &[f64],
    x: f64,
    y: f64,
    z: f64,
) -> Result<HashMapContext, String> {
    let mut ctx = build_base_context(coeff_names, coeff_values)?;
    set_variable(&mut ctx, "x", x)?;
    set_variable(&mut ctx, "y", y)?;
    set_variable(&mut ctx, "z", z)?;
    Ok(ctx)
}

/// 在给定系数和坐标下求值一个标量表达式.
///
/// 该接口供编译期仍然需要在 TS 侧完成的 point / vector 坐标、transform
/// 参数以及 analysis `at` 坐标使用,避免这些数值求值继续走 mathjs.
pub fn evaluate_scalar(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    x: f64,
    y: f64,
    z: f64,
) -> Result<f64, String> {
    let node = compile_expression(expr)?;
    let ctx = build_context_with_point(coeff_names, coeff_values, x, y, z)?;
    evaluate_node(&node, &ctx)
}

// ================================================================
// 梯度
// ================================================================

/// 计算二维标量场 `f(x, y)` 在点 `(x, y)` 处的梯度值
///
/// # 公式
/// ∇f = (∂f/∂x, ∂f/∂y)
///
/// # 参数
/// * `surface_expr` - 标量场 `f` 的表达式（用于求 `f0 = f(x,y)`）
/// * `fx_expr`    - ∂f/∂x 的表达式
/// * `fy_expr`    - ∂f/∂y 的表达式
/// * `coeff_names` - 系数变量名列表
/// * `coeff_values` - 对应的系数值
/// * `x`           - 点的 x 坐标
/// * `y`           - 点的 y 坐标
///
/// # 返回
/// `(f0, fx, fy)`,其中：
/// - `f0` = f(x, y)
/// - `fx` = ∂f/∂x (x, y)
/// - `fy` = ∂f/∂y (x, y)
pub fn evaluate_gradient_point(
    surface_expr: &str,
    fx_expr: &str,
    fy_expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    x: f64,
    y: f64,
) -> Result<(f64, f64, f64), String> {
    let surface_node = compile_expression(surface_expr)?;
    let fx_node = compile_expression(fx_expr)?;
    let fy_node = compile_expression(fy_expr)?;
    let ctx = build_context_with_point(coeff_names, coeff_values, x, y, 0.0)?;

    let f0 = evaluate_node(&surface_node, &ctx)?;
    let fx = evaluate_node(&fx_node, &ctx)?;
    let fy = evaluate_node(&fy_node, &ctx)?;

    Ok((f0, fx, fy))
}

// ================================================================
// 散度
// ================================================================

/// 计算三维向量场 `F(x, y, z) = (P, Q, R)` 在点 `(x, y, z)` 处的散度
///
/// # 公式
/// ∇·F = ∂P/∂x + ∂Q/∂y + ∂R/∂z
///
/// # 参数
/// * `dpx_expr` - ∂P/∂x 的表达式
/// * `dqy_expr` - ∂Q/∂y 的表达式
/// * `drz_expr` - ∂R/∂z 的表达式
/// * `coeff_names` - 系数变量名列表
/// * `coeff_values` - 对应的系数值
/// * `x`, `y`, `z` - 点的坐标
///
/// # 返回
/// 散度值 `∇·F`
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
    let dpx_node = compile_expression(dpx_expr)?;
    let dqy_node = compile_expression(dqy_expr)?;
    let drz_node = compile_expression(drz_expr)?;
    let ctx = build_context_with_point(coeff_names, coeff_values, x, y, z)?;

    let dpx = evaluate_node(&dpx_node, &ctx)?;
    let dqy = evaluate_node(&dqy_node, &ctx)?;
    let drz = evaluate_node(&drz_node, &ctx)?;

    Ok(dpx + dqy + drz)
}

// ================================================================
// 旋度
// ================================================================

/// 计算三维向量场 `F(x, y, z) = (P, Q, R)` 在点 `(x, y, z)` 处的旋度
///
/// # 公式
/// ∇×F = ( ∂R/∂y - ∂Q/∂z,
///          ∂P/∂z - ∂R/∂x,
///          ∂Q/∂x - ∂P/∂y )
///
/// # 参数
/// * `dr_dy_expr` - ∂R/∂y 的表达式
/// * `dq_dz_expr` - ∂Q/∂z 的表达式
/// * `dp_dz_expr` - ∂P/∂z 的表达式
/// * `dr_dx_expr` - ∂R/∂x 的表达式
/// * `dq_dx_expr` - ∂Q/∂x 的表达式
/// * `dp_dy_expr` - ∂P/∂y 的表达式
/// * `coeff_names` - 系数变量名列表
/// * `coeff_values` - 对应的系数值
/// * `x`, `y`, `z` - 点的坐标
///
/// # 返回
/// `(curl_x, curl_y, curl_z)`,即旋度的三个分量
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
    let dr_dy_node = compile_expression(dr_dy_expr)?;
    let dq_dz_node = compile_expression(dq_dz_expr)?;
    let dp_dz_node = compile_expression(dp_dz_expr)?;
    let dr_dx_node = compile_expression(dr_dx_expr)?;
    let dq_dx_node = compile_expression(dq_dx_expr)?;
    let dp_dy_node = compile_expression(dp_dy_expr)?;
    let ctx = build_context_with_point(coeff_names, coeff_values, x, y, z)?;

    let dr_dy = evaluate_node(&dr_dy_node, &ctx)?;
    let dq_dz = evaluate_node(&dq_dz_node, &ctx)?;
    let dp_dz = evaluate_node(&dp_dz_node, &ctx)?;
    let dr_dx = evaluate_node(&dr_dx_node, &ctx)?;
    let dq_dx = evaluate_node(&dq_dx_node, &ctx)?;
    let dp_dy = evaluate_node(&dp_dy_node, &ctx)?;

    Ok((dr_dy - dq_dz, dp_dz - dr_dx, dq_dx - dp_dy))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_coeffs() -> (Vec<String>, Vec<f64>) {
        (Vec::new(), Vec::new())
    }

    #[test]
    fn scalar_evaluation_uses_coefficients_and_coordinates() {
        let names = vec!["a".to_string()];
        let values = vec![2.0];
        let value = evaluate_scalar("a * x + 1", &names, &values, 3.0, 0.0, 0.0).unwrap();

        assert!((value - 7.0).abs() < 1e-12);
        assert!(evaluate_scalar("unknown_symbol", &names, &values, 0.0, 0.0, 0.0).is_err());
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
