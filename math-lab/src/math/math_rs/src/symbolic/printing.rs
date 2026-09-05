//! 文本/LaTeX 统一打印器:优先级与加括号规则只写一份(用 `PrintMode`
//! 区分两种渲染),LaTeX 的函数/乘积等具体排版在 `latex` 子模块.
//!
//! 文本模式生成归一化后可执行的字符串;LaTeX 模式生成 UI 排版字符串.

use std::f64::consts::{E, PI};

use super::latex::{latex_call, latex_number, latex_pow_base, latex_product, latex_symbol};
use super::{BinOp, Expr, UnaryOp};

fn is_atomic(expr: &Expr) -> bool {
    matches!(expr, Expr::Num(_) | Expr::Sym(_))
}

pub(crate) fn parenthesize(inner: &str, needed: bool) -> String {
    if needed {
        format!("({inner})")
    } else {
        inner.to_string()
    }
}

pub(crate) fn format_number(value: f64) -> String {
    if value == PI {
        "3.141592653589793".to_string()
    } else if value == E {
        "2.718281828459045".to_string()
    } else if value == value.trunc() && value.abs() < 1e15 {
        format!("{}", value as i64)
    } else {
        let mut text = format!("{value:.15}");
        while text.contains('.') && text.ends_with('0') {
            text.pop();
        }
        if text.ends_with('.') {
            text.pop();
        }
        text
    }
}

#[derive(Clone, Copy)]
pub(crate) enum PrintMode {
    Text,
    Latex,
}

fn expr_prec(expr: &Expr) -> u8 {
    match expr {
        Expr::Num(_) | Expr::Sym(_) | Expr::Call(_, _) | Expr::List(_) => 100,
        Expr::Unary(_, _) => 60,
        Expr::Binary(op, _, _) => op.prec(),
    }
}

fn binary_child(expr: &Expr, mode: PrintMode, op: BinOp, is_right: bool) -> String {
    let child_prec = expr_prec(expr);
    let needs_parentheses = child_prec < op.prec()
        || (is_right
            && child_prec == op.prec()
            && matches!(op, BinOp::Sub | BinOp::Div | BinOp::Pow));
    parenthesize(&format_expr(expr, mode, 0), needs_parentheses)
}

/// 唯一树打印入口.
///
/// 文本模式生成归一化后可执行的字符串;LaTeX 模式生成 UI 排版字符串.
/// 优先级与加括号规则在这里只写一份,两种模式只保留叶子/运算符渲染差异.
pub(crate) fn format_expr(expr: &Expr, mode: PrintMode, parent_prec: u8) -> String {
    match expr {
        Expr::Num(value) => match mode {
            PrintMode::Text => format_number(*value),
            PrintMode::Latex => latex_number(*value),
        },
        Expr::Sym(name) => match mode {
            PrintMode::Text => name.clone(),
            PrintMode::Latex => latex_symbol(name),
        },
        Expr::List(items) => {
            let separator = match mode {
                PrintMode::Text => ", ",
                PrintMode::Latex => ",\\ ",
            };
            let body = items
                .iter()
                .map(|item| format_expr(item, mode, 0))
                .collect::<Vec<_>>()
                .join(separator);
            format!("[{body}]")
        }
        Expr::Unary(UnaryOp::Neg, operand) => {
            let body = format_expr(operand, mode, 0);
            let text = match mode {
                PrintMode::Text => {
                    if is_atomic(operand) || matches!(operand.as_ref(), Expr::Call(_, _)) {
                        format!("-{body}")
                    } else {
                        format!("-({body})")
                    }
                }
                PrintMode::Latex => {
                    let needs_parentheses = matches!(
                        operand.as_ref(),
                        Expr::Binary(op, _, _) if matches!(op, BinOp::Add | BinOp::Sub)
                    );
                    if needs_parentheses {
                        format!("-({body})")
                    } else {
                        format!("-{body}")
                    }
                }
            };
            parenthesize(&text, 60 < parent_prec)
        }
        Expr::Call(name, args) => {
            let separator = match mode {
                PrintMode::Text => ", ",
                PrintMode::Latex => ",\\ ",
            };
            let arg_texts: Vec<String> = args.iter().map(|arg| format_expr(arg, mode, 0)).collect();
            let body = arg_texts.join(separator);
            match mode {
                PrintMode::Text => format!("{name}({body})"),
                PrintMode::Latex => latex_call(name, args, &arg_texts),
            }
        }
        Expr::Binary(op, left, right) => {
            let prec = op.prec();
            let text = match op {
                BinOp::Add | BinOp::Sub => format!(
                    "{} {} {}",
                    binary_child(left, mode, *op, false),
                    op.text(),
                    binary_child(right, mode, *op, true),
                ),
                BinOp::Mul | BinOp::Div | BinOp::Pow => match mode {
                    PrintMode::Text => format!(
                        "{} {} {}",
                        binary_child(left, mode, *op, false),
                        op.text(),
                        binary_child(right, mode, *op, true),
                    ),
                    PrintMode::Latex => match op {
                        BinOp::Mul => latex_product(expr),
                        BinOp::Div => format!(
                            "\\frac{{{}}}{{{}}}",
                            format_expr(left, PrintMode::Latex, 0),
                            format_expr(right, PrintMode::Latex, 0),
                        ),
                        BinOp::Pow => format!(
                            "{}^{{{}}}",
                            latex_pow_base(left),
                            format_expr(right, PrintMode::Latex, 0),
                        ),
                        _ => unreachable!(),
                    },
                },
            };
            parenthesize(&text, prec < parent_prec)
        }
    }
}

impl Expr {
    fn to_string_with_prec(&self, parent_prec: u8) -> String {
        format_expr(self, PrintMode::Text, parent_prec)
    }
}

impl std::fmt::Display for Expr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.to_string_with_prec(0))
    }
}
