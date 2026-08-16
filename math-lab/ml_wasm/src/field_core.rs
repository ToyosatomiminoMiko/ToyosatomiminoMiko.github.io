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
// evaluate(求值方法)
//
// ∇(Nabla)的定义:
// ∇ = ∂/∂x + ∂/∂y + ∂/∂z
// ================================================================

/// 构建带系数和坐标的求值上下文
///
/// # 参数
/// * `coeff_names` - 系数变量名列表
/// * `coeff_values` - 对应的系数值（与 `coeff_names` 长度一致）
/// * `x`, `y`, `z` - 当前点的坐标值
///
/// # 返回
/// 一个配置好的 `HashMapContext`,其中包含所有系数和坐标变量,并注册了内置函数
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

/// 在给定上下文中求值一个标量表达式
///
/// # 参数
/// * `expr` - 表达式字符串
/// * `ctx` - 已含变量值的上下文
///
/// # 返回
/// 表达式计算得到的有限浮点数,若不是数值则返回错误
fn eval_scalar(expr: &str, ctx: &HashMapContext) -> Result<f64, String> {
    let node = build_operator_tree(expr).map_err(|e| format!("表达式解析失败: {}", e))?;

    match node.eval_with_context(ctx) {
        Ok(Value::Float(value)) if value.is_finite() => Ok(value),
        Ok(Value::Int(value)) => Ok(value as f64),
        Ok(_) => Err("表达式结果不是数值".to_string()),
        Err(e) => Err(format!("表达式求值失败: {}", e)),
    }
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
    let ctx = build_context(coeff_names, coeff_values, x, y, z)?;
    eval_scalar(expr, &ctx)
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
    let ctx = build_context(coeff_names, coeff_values, x, y, 0.0)?;

    let f0 = eval_scalar(surface_expr, &ctx)?;
    let fx = eval_scalar(fx_expr, &ctx)?;
    let fy = eval_scalar(fy_expr, &ctx)?;

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
    let ctx = build_context(coeff_names, coeff_values, x, y, z)?;

    let dpx = eval_scalar(dpx_expr, &ctx)?;
    let dqy = eval_scalar(dqy_expr, &ctx)?;
    let drz = eval_scalar(drz_expr, &ctx)?;

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
