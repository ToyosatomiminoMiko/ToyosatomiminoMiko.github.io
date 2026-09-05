//! 运行时数值求值:把编译后的 `Expr` 树按变量上下文逐点解释;
//! 负底数 + 有理指数的实值幂(`real_pow`)也在这里统一实现.

use std::collections::HashMap;

use super::parser::{parse_expr, rewrite_aliases, validate_supported};
use super::{BinOp, Expr, RuntimeExpr, UnaryOp};
use crate::builtins;

pub(crate) fn compile_runtime_expr(source: &str) -> Result<RuntimeExpr, String> {
    let parsed = parse_expr(source)?;
    let rewritten = rewrite_aliases(&parsed)?;
    validate_supported(&rewritten)?;
    Ok(rewritten)
}

fn finite_value(value: f64) -> Option<f64> {
    if value.is_finite() {
        Some(value)
    } else {
        None
    }
}

/// 实数幂语义:负底数的非整数次幂只在指数是"约分后分母为奇数"的有理数
/// m/n 时有实值((−x)^(m/n) = (−1)^m·|x|^(m/n));否则返回 NaN.
/// 避免 `(-8)^(1/3)` 之类数学上可定义的实值运算被 `powf` 一律给 NaN
/// (见 prompt/review_report.md P2.2).正底/整数指数仍直接走 `powf`.
pub(crate) fn real_pow(base: f64, exp: f64) -> f64 {
    if base >= 0.0 || !exp.is_finite() || exp.fract() == 0.0 || !base.is_finite() {
        return base.powf(exp);
    }
    match odd_denominator_rational(exp) {
        Some((num, _)) => {
            let magnitude = base.abs().powf(exp);
            if num % 2 == 0 {
                magnitude
            } else {
                -magnitude
            }
        }
        None => f64::NAN,
    }
}

fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let rest = a % b;
        a = b;
        b = rest;
    }
    a
}

/// 把指数识别为约分后分母为奇数的有理数 `m/n`.
///
/// 只在 |exp − m/n| 足够小(相对 1e-9)时判定成立,避免把任意浮点小数
/// 误认成"奇数分母有理数"(如 0.5 不应命中任何奇数分母).
fn odd_denominator_rational(x: f64) -> Option<(i64, u64)> {
    if !x.is_finite() {
        return None;
    }
    if x == 0.0 {
        return Some((0, 1));
    }
    let scale = x.abs().max(1.0);
    for n in (1u64..=1023).step_by(2) {
        let m = (x * n as f64).round();
        if !m.is_finite() {
            continue;
        }
        if (x - m / n as f64).abs() > 1e-9 * scale {
            continue;
        }
        let g = gcd(m.abs() as u64, n);
        let reduced_den = n / g;
        if reduced_den % 2 == 1 {
            return Some((m as i64 / g as i64, reduced_den));
        }
    }
    None
}

fn evaluate_expr_inner(
    expr: &Expr,
    variables: &HashMap<String, f64>,
) -> Result<Option<f64>, String> {
    match expr {
        Expr::Num(value) => Ok(finite_value(*value)),
        Expr::Sym(name) => {
            // 数值常量名单收口在 builtins;其余名字按变量解析.
            let value = match builtins::constant_value(name) {
                Some(value) => value,
                None => variables
                    .get(name)
                    .copied()
                    .ok_or_else(|| format!("变量 '{}' 未定义", name))?,
            };
            Ok(finite_value(value))
        }
        Expr::Unary(UnaryOp::Neg, operand) => {
            Ok(evaluate_expr_inner(operand, variables)?.map(|value| -value))
        }
        Expr::Binary(op, left, right) => {
            let left = evaluate_expr_inner(left, variables)?;
            let right = evaluate_expr_inner(right, variables)?;
            match (left, right) {
                (Some(left), Some(right)) => {
                    let value = match op {
                        BinOp::Add => left + right,
                        BinOp::Sub => left - right,
                        BinOp::Mul => left * right,
                        BinOp::Div => left / right,
                        BinOp::Pow => real_pow(left, right),
                    };
                    Ok(finite_value(value))
                }
                _ => Ok(None),
            }
        }
        Expr::Call(name, args) => {
            let mut values = Vec::with_capacity(args.len());
            for arg in args {
                let Some(value) = evaluate_expr_inner(arg, variables)? else {
                    return Ok(None);
                };
                values.push(value);
            }
            if args.len() != 1 {
                return Err(format!("函数 {name} 只接受 1 个参数"));
            }
            let value = builtins::apply_unary(name, values[0])?;
            Ok(finite_value(value))
        }
        Expr::List(_) => Err("不能直接对数组表达式求值".to_string()),
    }
}

pub(crate) fn evaluate_runtime_expr(
    expr: &RuntimeExpr,
    variables: &HashMap<String, f64>,
) -> Result<Option<f64>, String> {
    evaluate_expr_inner(expr, variables)
}

// ============================================================
// 字符串输出
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn odd_denominator_rational_recognition() {
        assert_eq!(odd_denominator_rational(1.0 / 3.0), Some((1, 3)));
        assert_eq!(odd_denominator_rational(-2.0 / 3.0), Some((-2, 3)));
        assert_eq!(odd_denominator_rational(2.0 / 5.0), Some((2, 5)));
        // 0.5 = 1/2:约分后分母为偶,不应被识别为可实值化的有理指数.
        assert_eq!(odd_denominator_rational(0.5), None);
        // 无理数/一般小数不被误认.
        assert_eq!(odd_denominator_rational(std::f64::consts::SQRT_2), None);
    }

    #[test]
    fn real_power_returns_real_values_for_odd_denominators() {
        assert!((real_pow(-8.0, 1.0 / 3.0) - -2.0).abs() < 1e-12);
        assert!((real_pow(-8.0, 2.0 / 3.0) - 4.0).abs() < 1e-12);
        assert!((real_pow(-8.0, -1.0 / 3.0) - -0.5).abs() < 1e-12);
        assert!((real_pow(-1.0, 0.5)).is_nan(), "(-1)^0.5 无实值");
        assert!((real_pow(2.0, 1.0 / 3.0) - 2.0f64.powf(1.0 / 3.0)).abs() < 1e-12);
    }
}
