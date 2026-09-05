use std::collections::HashMap;

use crate::symbolic::{compile_runtime_expr, evaluate_runtime_expr, RuntimeExpr};

/// 构建包含自由系数和内置函数的求值上下文.
///
/// 该上下文不包含 `x`/`y`/`z` 等采样坐标;坐标由调用方在每次求值前
/// 通过 [`set_variable`] 显式写入.这样可以让采样循环只解析一次表达式,
/// 同时避免每个调用点各自维护一套 context 初始化逻辑.
pub(crate) fn build_base_context(
    coeff_names: &[String],
    coeff_values: &[f64],
) -> Result<HashMap<String, f64>, String> {
    let mut ctx = HashMap::new();

    for (name, &value) in coeff_names.iter().zip(coeff_values.iter()) {
        set_variable(&mut ctx, name, value)?;
    }

    Ok(ctx)
}

/// 把表达式字符串编译为符号引擎的求值树.
pub(crate) fn compile_expression(expr: &str) -> Result<RuntimeExpr, String> {
    compile_runtime_expr(expr).map_err(|e| format!("表达式解析失败: {}", e))
}

/// 向求值上下文写入一个浮点变量.
pub(crate) fn set_variable(
    ctx: &mut HashMap<String, f64>,
    name: &str,
    value: f64,
) -> Result<(), String> {
    ctx.insert(name.to_string(), value);
    Ok(())
}

/// 对已编译节点求值.
///
/// 有限数值返回 `Ok(Some(value))`;非有限浮点结果返回 `Ok(None)`;
/// 解析/求值错误返回 `Err`.这样调用方可以显式决定"跳过""置零"还是报错,
/// 不再把错误和非有限值都混成 `NaN`.
pub(crate) fn evaluate_node_opt(
    node: &RuntimeExpr,
    ctx: &HashMap<String, f64>,
) -> Result<Option<f64>, String> {
    evaluate_runtime_expr(node, ctx).map_err(|e| format!("表达式求值失败: {}", e))
}

/// 已编译表达式 + 可复用求值上下文.
///
/// 采样/求交/场分析都要做大量逐点求值;把它们各自的"compile + 建 context
/// + 每次写入坐标"收口到这里,避免每个调用点重复这套初始化逻辑.
pub(crate) struct CompiledEvaluator {
    node: RuntimeExpr,
    context: HashMap<String, f64>,
}

impl CompiledEvaluator {
    pub(crate) fn new(
        expr: &str,
        coeff_names: &[String],
        coeff_values: &[f64],
    ) -> Result<Self, String> {
        let node = compile_expression(expr)?;
        let context = build_base_context(coeff_names, coeff_values)?;
        Ok(Self { node, context })
    }

    /// 在给定三维坐标处求值;不参与该表达式的坐标传 NaN 即可.
    pub(crate) fn eval_at(&mut self, x: f64, y: f64, z: f64) -> Result<Option<f64>, String> {
        set_variable(&mut self.context, "x", x)?;
        set_variable(&mut self.context, "y", y)?;
        set_variable(&mut self.context, "z", z)?;
        evaluate_node_opt(&self.node, &self.context)
    }

    /// 一元函数求值: y = f(x).
    pub(crate) fn eval_1d(&mut self, x: f64) -> Result<Option<f64>, String> {
        set_variable(&mut self.context, "x", x)?;
        evaluate_node_opt(&self.node, &self.context)
    }

    /// 二元函数求值: z = f(x, y).
    pub(crate) fn eval_2d(&mut self, x: f64, y: f64) -> Result<Option<f64>, String> {
        set_variable(&mut self.context, "x", x)?;
        set_variable(&mut self.context, "y", y)?;
        evaluate_node_opt(&self.node, &self.context)
    }

    /// 在给定坐标处严格求值:非有限结果同样视为错误.
    pub(crate) fn eval_at_strict(&mut self, x: f64, y: f64, z: f64) -> Result<f64, String> {
        match self.eval_at(x, y, z)? {
            Some(value) => Ok(value),
            None => Err("表达式结果为非有限数值".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::{E, PI};

    fn coeff(values: &[f64]) -> (Vec<String>, Vec<f64>) {
        (
            (0..values.len()).map(|index| format!("a{index}")).collect(),
            values.to_vec(),
        )
    }

    #[test]
    fn evaluates_coefficients_coordinates_and_builtins() {
        let (names, values) = coeff(&[PI / 6.0]);
        let mut evaluator =
            CompiledEvaluator::new("sin(a0 * x) + sqrt(4)", &names, &values).unwrap();

        let result = evaluator.eval_at(1.0, f64::NAN, f64::NAN).unwrap().unwrap();
        assert!((result - 2.5).abs() < 1e-12);
    }

    #[test]
    fn rewrites_aliases_before_runtime_evaluation() {
        let mut evaluator = CompiledEvaluator::new("log(x) + pow(x, 2)", &[], &[]).unwrap();
        let result = evaluator.eval_1d(std::f64::consts::E).unwrap().unwrap();
        assert!((result - 1.0 - E * E).abs() < 1e-12);
    }

    #[test]
    fn nonfinite_results_are_none_instead_of_errors() {
        let mut evaluator = CompiledEvaluator::new("1 / (x - 1)", &[], &[]).unwrap();
        assert!(evaluator.eval_1d(1.0).unwrap().is_none());
    }

    #[test]
    fn missing_variables_report_errors() {
        let mut evaluator = CompiledEvaluator::new("x + y", &[], &[]).unwrap();
        assert!(evaluator.eval_1d(1.0).is_err());
    }

    #[test]
    fn negative_base_rational_power_and_cbrt_evaluate_to_real_values() {
        // P2.2:负底 + 奇数分母有理指数给出实值,不再是静默 NaN.
        let mut evaluator = CompiledEvaluator::new("pow(x, 1 / 3)", &[], &[]).unwrap();
        let value = evaluator.eval_1d(-8.0).unwrap().unwrap();
        assert!((value - -2.0).abs() < 1e-12, "(-8)^(1/3) = {value}");

        let mut evaluator = CompiledEvaluator::new("cbrt(x)", &[], &[]).unwrap();
        let value = evaluator.eval_1d(-27.0).unwrap().unwrap();
        assert!((value - -3.0).abs() < 1e-12, "cbrt(-27) = {value}");

        // 偶数分母(平方根)依旧无实值 -> Ok(None),与既有一致.
        let mut evaluator = CompiledEvaluator::new("pow(x, 0.5)", &[], &[]).unwrap();
        assert!(evaluator.eval_1d(-4.0).unwrap().is_none());
    }

    #[test]
    fn sign_is_explicit_nan_at_zero_not_ieee_accident() {
        // P2.1:sign(u) = u/|u|;0 处显式 NaN(而非 0/0 的 IEEE 撞大运).
        let mut evaluator = CompiledEvaluator::new("sign(x)", &[], &[]).unwrap();
        assert_eq!(evaluator.eval_1d(2.0).unwrap(), Some(1.0));
        assert_eq!(evaluator.eval_1d(-2.0).unwrap(), Some(-1.0));
        assert!(evaluator.eval_1d(0.0).unwrap().is_none());

        // |x| 的导数 = sign(x),同样在 0 处显式无定义.
        let mut evaluator = CompiledEvaluator::new("sign(x)", &[], &[]).unwrap();
        assert!(evaluator.eval_1d(0.0).unwrap().is_none());
    }
}
