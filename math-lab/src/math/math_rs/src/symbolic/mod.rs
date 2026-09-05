//! 轻量符号表达式引擎(模块根).
//!
//! 目标不是复刻完整的外部数学库,而是把项目中实际依赖的符号能力
//! (解析/别名归一化/符号求导/自由变量提取/数组解析/常量矩阵求值)
//! 迁到 Rust/WASM,使 TS 编译层和数值层不再依赖外部 JS 数学库.
//!
//! 按阶段拆成子模块,避免单一超长文件:
//! - `parser`    - 词法/Pratt 语法分析,别名归一化,函数支持校验;
//! - `eval`      - 已编译表达式的数值解释器与实数幂语义(`real_pow`);
//! - `printing`  - 文本打印(归一化字符串 / `Display`);
//! - `latex`     - UI 公式的 LaTeX 排版(仅展示用,不参与数值路径);
//! - `simplify`  - 常量求值(matrix 条目)与代数化简;
//! - `derivative`- 符号求导(链式法则 + simplify).

mod derivative;
mod eval;
mod latex;
mod parser;
mod printing;
mod simplify;

pub(crate) use eval::{compile_runtime_expr, evaluate_runtime_expr};
pub use latex::latex_expression;

use std::collections::HashSet;

use crate::builtins;

use derivative::derivative;
use parser::{parse_expr, rewrite_aliases, validate_supported};
use simplify::evaluate_constant;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Expr {
    Num(f64),
    Sym(String),
    Unary(UnaryOp, Box<Expr>),
    Binary(BinOp, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
    List(Vec<Expr>),
}

/// 供数值求值使用的已编译表达式.
///
/// 类型保持 crate 内部可见:外部仍通过表达式字符串与 WASM 入口交互.
pub(crate) type RuntimeExpr = Expr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UnaryOp {
    Neg,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
}

impl BinOp {
    fn prec(self) -> u8 {
        match self {
            Self::Add | Self::Sub => 20,
            Self::Mul | Self::Div => 40,
            Self::Pow => 70,
        }
    }

    fn text(self) -> &'static str {
        match self {
            Self::Add => "+",
            Self::Sub => "-",
            Self::Mul => "*",
            Self::Div => "/",
            Self::Pow => "^",
        }
    }
}

fn builtin_symbol(name: &str) -> bool {
    builtins::is_supported_function(name)
        || builtins::is_alias_name(name)
        || builtins::is_known_constant(name)
}

fn collect_symbols(expr: &Expr, out: &mut Vec<String>) {
    match expr {
        Expr::Sym(name) => {
            if !builtin_symbol(name) {
                out.push(name.clone());
            }
        }
        Expr::Unary(_, operand) => collect_symbols(operand, out),
        Expr::Binary(_, left, right) => {
            collect_symbols(left, out);
            collect_symbols(right, out);
        }
        Expr::Call(_, args) => {
            for arg in args {
                collect_symbols(arg, out);
            }
        }
        Expr::List(items) => {
            for item in items {
                collect_symbols(item, out);
            }
        }
        Expr::Num(_) => {}
    }
}

fn json_escape(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch => out.push(ch),
        }
    }
    out
}

fn expr_list_json(expr: &Expr) -> Result<String, String> {
    match expr {
        Expr::List(items) => {
            let body = items
                .iter()
                .map(expr_list_json)
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            Ok(format!("[{body}]"))
        }
        other => Ok(format!("\"{}\"", json_escape(&other.to_string()))),
    }
}

// ============================================================
// WASM 入口
// ============================================================

pub fn normalize_expression(expr: &str) -> Result<String, String> {
    let parsed = parse_expr(expr)?;
    let rewritten = rewrite_aliases(&parsed)?;
    validate_supported(&rewritten)?;
    Ok(rewritten.to_string())
}

pub fn symbolic_derivative(expr: &str, variable: &str) -> Result<String, String> {
    if variable.trim().is_empty() {
        return Err("求导变量不能为空".to_string());
    }
    let parsed = parse_expr(expr)?;
    let result = derivative(&parsed, variable.trim())?;
    Ok(result.to_string())
}

pub fn symbolic_variables(expr: &str, exclude: &[String]) -> Result<Vec<String>, String> {
    let parsed = parse_expr(expr)?;
    let rewritten = rewrite_aliases(&parsed)?;
    let excluded: HashSet<&str> = exclude.iter().map(String::as_str).collect();
    let mut names = Vec::new();
    collect_symbols(&rewritten, &mut names);

    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for name in names {
        if excluded.contains(name.as_str()) || !seen.insert(name.clone()) {
            continue;
        }
        result.push(name);
    }
    result.sort();
    Ok(result)
}

pub fn parse_array_strings(expr: &str) -> Result<String, String> {
    let parsed = parse_expr(expr)?;
    let rewritten = rewrite_aliases(&parsed)?;
    expr_list_json(&rewritten)
}

pub fn matrix4_from_expr(expr: &str) -> Result<Vec<f64>, String> {
    let parsed = parse_expr(expr)?;
    let rewritten = rewrite_aliases(&parsed)?;
    let rows = match rewritten {
        Expr::Call(name, args) if name == "matrix" && args.len() == 1 => match &args[0] {
            Expr::List(rows) => rows.clone(),
            _ => return Err("matrix() 参数必须是二维数组".to_string()),
        },
        Expr::List(rows) => rows,
        _ => return Err("矩阵必须是 [[...]] 或 matrix([[...]]) 形式".to_string()),
    };

    if rows.len() != 4 {
        return Err("矩阵必须为 4 行".to_string());
    }

    let mut out = Vec::with_capacity(16);
    for row in rows {
        match row {
            Expr::List(items) if items.len() == 4 => {
                for item in items {
                    out.push(evaluate_constant(&item)?);
                }
            }
            _ => return Err("矩阵每一行必须为 4 个元素".to_string()),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_implicit_multiplication() {
        assert_eq!(normalize_expression("sin(2x)").unwrap(), "sin(2 * x)");
        assert_eq!(normalize_expression("2 x").unwrap(), "2 * x");
        assert_eq!(normalize_expression("x y").unwrap(), "x * y");
    }

    #[test]
    fn rewrites_common_aliases() {
        assert_eq!(normalize_expression("log(x)").unwrap(), "ln(x)");
        assert_eq!(normalize_expression("pow(x, 2)").unwrap(), "x ^ 2");
        assert_eq!(normalize_expression("sec(x)").unwrap(), "1 / cos(x)");
        assert_eq!(normalize_expression("cot(x)").unwrap(), "cos(x) / sin(x)");
        assert_eq!(normalize_expression("pi").unwrap(), "3.141592653589793");
        assert_eq!(
            normalize_expression("deg(180)").unwrap(),
            "180 * 0.017453292519943"
        );
    }

    #[test]
    fn shared_printer_keeps_necessary_parentheses_once() {
        assert_eq!(normalize_expression("2 * (a + b)").unwrap(), "2 * (a + b)");
        assert_eq!(normalize_expression("a - (b - c)").unwrap(), "a - (b - c)");
        assert_eq!(normalize_expression("(a + b) / c").unwrap(), "(a + b) / c");
        assert_eq!(normalize_expression("x ^ (y ^ z)").unwrap(), "x ^ (y ^ z)");
    }

    #[test]
    fn differentiates_common_expressions() {
        assert_eq!(symbolic_derivative("x^2", "x").unwrap(), "2 * x");
        assert_eq!(
            symbolic_derivative("pi*x", "x").unwrap(),
            "3.141592653589793"
        );
        assert_eq!(
            symbolic_derivative("sin(x*a)", "x").unwrap(),
            "a * cos(x * a)"
        );
        assert_eq!(
            symbolic_derivative("sin(x)*cos(y)", "x").unwrap(),
            "cos(y) * cos(x)"
        );
        assert_eq!(
            symbolic_derivative("sin(x)*cos(y)", "y").unwrap(),
            "-(sin(x) * sin(y))"
        );
    }

    /// P2.1:|x| 的符号导数输出 sign 语义,而不是 0/0 形态的 |x|/x.
    #[test]
    fn derivative_of_abs_uses_sign_semantics() {
        assert_eq!(symbolic_derivative("abs(x)", "x").unwrap(), "sign(x)");
        assert_eq!(
            symbolic_derivative("abs(sin(x))", "x").unwrap(),
            "cos(x) * sign(sin(x))"
        );
        // cbrt 是登记过的一元函数,可求导.
        assert_eq!(
            symbolic_derivative("cbrt(x)", "x").unwrap(),
            "1 / (3 * cbrt(x) ^ 2)"
        );
    }

    #[test]
    fn extracts_free_symbols() {
        let mut vars = symbolic_variables("sin(a * x) + b^2", &["x".to_string()]).unwrap();
        vars.sort();
        assert_eq!(vars, vec!["a", "b"]);
    }

    #[test]
    fn renders_latex_expressions() {
        assert_eq!(
            latex_expression("sin(x * a) * cos(x * b)").unwrap(),
            "\\sin\\left(x\\,a\\right)\\,\\cos\\left(x\\,b\\right)"
        );
        assert_eq!(latex_expression("2x").unwrap(), "2\\,x");
        assert_eq!(latex_expression("2 * (a + b)").unwrap(), "2\\,(a + b)");
        assert_eq!(latex_expression("pow(x, 2)").unwrap(), "x^{2}");
        assert_eq!(latex_expression("-(a + b)").unwrap(), "-(a + b)");
        assert_eq!(
            latex_expression("sqrt(x^2 + y^2)").unwrap(),
            "\\sqrt{x^{2} + y^{2}}"
        );
        assert_eq!(latex_expression("cbrt(x)").unwrap(), "\\sqrt[3]{x}");
        assert_eq!(
            latex_expression("sign(x)").unwrap(),
            "\\operatorname{sgn}\\left(x\\right)"
        );
    }

    #[test]
    fn renders_latex_constants_symbolically() {
        assert_eq!(latex_expression("pi / 4").unwrap(), "\\frac{\\pi}{4}");
        // normalize_expression 会把 pi 展开成浮点数;LaTeX 打印器按精确值
        // 还原成 \pi,避免 UI 公式出现一长串小数.
        assert_eq!(
            latex_expression("3.141592653589793 / 4").unwrap(),
            "\\frac{\\pi}{4}"
        );
        assert_eq!(
            latex_expression("log10(x) + theta").unwrap(),
            "\\log_{10}\\left(x\\right) + \\theta"
        );
    }

    #[test]
    fn parses_nested_arrays() {
        assert_eq!(
            parse_array_strings("[x, [y, z]]").unwrap(),
            "[\"x\", [\"y\", \"z\"]]"
        );
        assert_eq!(parse_array_strings("[x, y,]").unwrap(), "[\"x\", \"y\"]");
    }

    #[test]
    fn evaluates_matrix_literals() {
        let identity =
            matrix4_from_expr("matrix([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]])").unwrap();
        assert_eq!(
            identity,
            vec![1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]
        );
        let trailing_comma =
            matrix4_from_expr("[[1, 0, 0, 2], [0, 1, 0, 3], [0, 0, 1, 4], [0, 0, 0, 1],]").unwrap();
        assert_eq!(
            trailing_comma,
            vec![1.0, 0.0, 0.0, 2.0, 0.0, 1.0, 0.0, 3.0, 0.0, 0.0, 1.0, 4.0, 0.0, 0.0, 0.0, 1.0]
        );
    }
}
