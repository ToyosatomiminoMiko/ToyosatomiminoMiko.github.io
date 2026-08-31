use evalexpr::{build_operator_tree, ContextWithMutableVariables, HashMapContext, Node, Value};

use crate::builtins::register_builtins;

/// 构建包含自由系数和内置函数的求值上下文.
///
/// 该上下文不包含 `x`/`y`/`z` 等采样坐标;坐标由调用方在每次求值前
/// 通过 [`set_variable`] 显式写入.这样可以让采样循环只解析一次表达式,
/// 同时避免每个调用点各自维护一套 context 初始化逻辑.
pub fn build_base_context(
    coeff_names: &[String],
    coeff_values: &[f64],
) -> Result<HashMapContext, String> {
    let mut ctx = HashMapContext::new();

    for (name, &value) in coeff_names.iter().zip(coeff_values.iter()) {
        set_variable(&mut ctx, name, value)?;
    }

    register_builtins(&mut ctx);
    Ok(ctx)
}

/// 把表达式字符串编译为 evalexpr 节点.
pub fn compile_expression(expr: &str) -> Result<Node, String> {
    build_operator_tree(expr).map_err(|e| format!("表达式解析失败: {}", e))
}

/// 向求值上下文写入一个浮点变量.
pub fn set_variable(ctx: &mut HashMapContext, name: &str, value: f64) -> Result<(), String> {
    ctx.set_value(name.to_string(), Value::Float(value))
        .map_err(|e| format!("设置变量 '{}' 失败: {}", name, e))
}

/// 对已编译节点求值.
///
/// 有限数值返回 `Ok(Some(value))`;非有限浮点结果返回 `Ok(None)`;
/// 解析/求值错误返回 `Err`.这样调用方可以显式决定"跳过""置零"还是报错,
/// 不再把错误和非有限值都混成 `NaN`.
pub fn evaluate_node_opt(node: &Node, ctx: &HashMapContext) -> Result<Option<f64>, String> {
    match node.eval_with_context(ctx) {
        Ok(Value::Float(value)) if value.is_finite() => Ok(Some(value)),
        Ok(Value::Float(_)) => Ok(None),
        Ok(Value::Int(value)) => Ok(Some(value as f64)),
        Ok(_) => Err("表达式结果不是数值".to_string()),
        Err(e) => Err(format!("表达式求值失败: {}", e)),
    }
}

/// 对已编译节点求值,并把非有限结果也视为错误.
pub fn evaluate_node(node: &Node, ctx: &HashMapContext) -> Result<f64, String> {
    match evaluate_node_opt(node, ctx)? {
        Some(value) => Ok(value),
        None => Err("表达式结果为非有限数值".to_string()),
    }
}

/// 一次调用完成"编译 + 构建上下文 + 求值",供单个标量求值场景复用.
pub fn evaluate_expr(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
) -> Result<f64, String> {
    let node = compile_expression(expr)?;
    let ctx = build_base_context(coeff_names, coeff_values)?;
    evaluate_node(&node, &ctx)
}
