//! LaTeX 输出(仅用于 UI 公式展示).
//!
//! 注意:这里不复用 `rewrite_aliases` + `to_string` 的数值归一化路径,
//! 因为那条路径会把 `pi` / `e` / `deg(180)` 展开成小数.LaTeX 打印器
//! 直接从同一棵 Expr 树生成排版字符串,保留符号形式,并处理函数名,
//! 隐式乘法与分数的 LaTeX 记法.

use std::f64::consts::{E, PI};

use super::parser::parse_expr;
use super::printing::{format_expr, format_number, parenthesize, PrintMode};
use super::{BinOp, Expr, UnaryOp};
use crate::builtins;

pub(crate) fn latex_number(value: f64) -> String {
    if value == PI {
        "\\pi".to_string()
    } else if value == E {
        "e".to_string()
    } else {
        format_number(value)
    }
}

fn latex_greek(name: &str) -> Option<&'static str> {
    Some(match name {
        "alpha" => "\\alpha",
        "beta" => "\\beta",
        "gamma" => "\\gamma",
        "delta" => "\\delta",
        "epsilon" => "\\epsilon",
        "zeta" => "\\zeta",
        "eta" => "\\eta",
        "theta" => "\\theta",
        "iota" => "\\iota",
        "kappa" => "\\kappa",
        "lambda" => "\\lambda",
        "mu" => "\\mu",
        "nu" => "\\nu",
        "xi" => "\\xi",
        "omicron" => "\\omicron",
        "rho" => "\\rho",
        "sigma" => "\\sigma",
        "tau" => "\\tau",
        "upsilon" => "\\upsilon",
        "phi" => "\\phi",
        "chi" => "\\chi",
        "psi" => "\\psi",
        "omega" => "\\omega",
        "Gamma" => "\\Gamma",
        "Delta" => "\\Delta",
        "Theta" => "\\Theta",
        "Lambda" => "\\Lambda",
        "Xi" => "\\Xi",
        "Pi" => "\\Pi",
        "Sigma" => "\\Sigma",
        "Upsilon" => "\\Upsilon",
        "Phi" => "\\Phi",
        "Psi" => "\\Psi",
        "Omega" => "\\Omega",
        _ => return None,
    })
}

pub(crate) fn latex_symbol(name: &str) -> String {
    if let Some(rendered) = builtins::constant_latex(name) {
        return rendered.to_string();
    }

    if let Some((head, tail)) = name.split_once('_') {
        return format!("{}_{{{}}}", latex_symbol(head), tail.replace('_', "\\_"));
    }
    if let Some(greek) = latex_greek(name) {
        return greek.to_string();
    }
    if name.len() == 1 {
        return name.to_string();
    }
    format!("\\mathit{{{name}}}")
}

fn latex_join_args(arg_texts: &[String]) -> String {
    arg_texts.join(",\\ ")
}

/// 幂运算底数:只有原子/函数调用可以直接跟随上标,其余需要括号.
pub(crate) fn latex_pow_base(expr: &Expr) -> String {
    let text = to_latex(expr, 0);
    match expr {
        Expr::Num(_) | Expr::Sym(_) | Expr::Call(_, _) | Expr::List(_) => text,
        _ => parenthesize(&text, true),
    }
}

pub(crate) fn latex_call(name: &str, args: &[Expr], arg_texts: &[String]) -> String {
    match builtins::alias_latex_kind(name) {
        Some(builtins::AliasLatexKind::SuperscriptPower) if args.len() == 2 => {
            format!("{}^{{{}}}", latex_pow_base(&args[0]), arg_texts[1])
        }
        Some(builtins::AliasLatexKind::Degree) if args.len() == 1 => {
            format!("{}^{{\\circ}}", latex_pow_base(&args[0]))
        }
        Some(builtins::AliasLatexKind::NaturalLog) if args.len() == 1 => {
            format!("\\ln\\left({}\\right)", arg_texts[0])
        }
        _ => match builtins::latex_style(name) {
            Some(builtins::LatexStyle::Named(function)) => {
                format!("{function}\\left({}\\right)", latex_join_args(arg_texts))
            }
            Some(builtins::LatexStyle::Exp) => format!("e^{{{}}}", arg_texts[0]),
            Some(builtins::LatexStyle::Sqrt) => format!("\\sqrt{{{}}}", arg_texts[0]),
            Some(builtins::LatexStyle::NthRoot(degree)) => {
                format!("\\sqrt[{degree}]{{{}}}", arg_texts[0])
            }
            Some(builtins::LatexStyle::Abs) => format!("\\left|{}\\right|", arg_texts[0]),
            Some(builtins::LatexStyle::LogBase(base)) => {
                format!("\\log_{{{base}}}\\left({}\\right)", arg_texts[0])
            }
            None => format!(
                "\\operatorname{{{name}}}\\left({}\\right)",
                latex_join_args(arg_texts)
            ),
        },
    }
}

fn latex_product_factor(expr: &Expr) -> String {
    match expr {
        Expr::Binary(BinOp::Add | BinOp::Sub, _, _) => parenthesize(&to_latex(expr, 0), true),
        Expr::Unary(UnaryOp::Neg, _) => parenthesize(&to_latex(expr, 0), true),
        _ => to_latex(expr, 0),
    }
}

fn collect_latex_factors(expr: &Expr, negative: &mut bool, factors: &mut Vec<Expr>) {
    match expr {
        Expr::Binary(BinOp::Mul, left, right) => {
            collect_latex_factors(left, negative, factors);
            collect_latex_factors(right, negative, factors);
        }
        Expr::Unary(UnaryOp::Neg, operand) => {
            *negative = !*negative;
            collect_latex_factors(operand, negative, factors);
        }
        Expr::Num(value) if *value < 0.0 => {
            *negative = !*negative;
            factors.push(Expr::Num(-value));
        }
        other => factors.push(other.clone()),
    }
}

pub(crate) fn latex_product(expr: &Expr) -> String {
    let mut negative = false;
    let mut factors = Vec::new();
    collect_latex_factors(expr, &mut negative, &mut factors);

    let mut body = String::new();
    for (index, factor) in factors.iter().enumerate() {
        if index > 0 {
            let previous_is_number = matches!(factors[index - 1], Expr::Num(_));
            let current_is_number = matches!(factor, Expr::Num(_));
            body.push_str(if previous_is_number && current_is_number {
                " \\cdot "
            } else {
                "\\,"
            });
        }
        body.push_str(&latex_product_factor(factor));
    }
    if negative {
        format!("-{body}")
    } else {
        body
    }
}

fn to_latex(expr: &Expr, parent_prec: u8) -> String {
    format_expr(expr, PrintMode::Latex, parent_prec)
}

pub fn latex_expression(expr: &str) -> Result<String, String> {
    let parsed = parse_expr(expr)?;
    Ok(to_latex(&parsed, 0))
}
