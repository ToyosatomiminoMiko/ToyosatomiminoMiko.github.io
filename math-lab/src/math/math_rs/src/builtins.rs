use crate::symbolic::{BinOp, Expr, UnaryOp};

/// 当前 DSL 数值求值支持的内置函数.
///
/// 每个函数只在这里登记一次:求值、符号求导和 LaTeX 显示都从这一张表取.
/// 多参数/别名函数(pow、sec、log 等)在表达式归一化阶段改写为基础函数.
type UnaryMathFunction = fn(f64) -> f64;
type DerivativeFunction = fn(&Expr) -> Expr;

#[derive(Clone, Copy)]
pub(crate) enum LatexStyle {
    /// 普通函数名,例如 `\sin\left(...\right)`.
    Named(&'static str),
    /// 指数形式 `e^{...}`.
    Exp,
    /// 根号形式 `\sqrt{...}`.
    Sqrt,
    /// 绝对值形式 `\left|...\right|`.
    Abs,
    /// 指定底数的对数,例如 `\log_{10}\left(...\right)`.
    LogBase(u8),
}

struct MathBuiltin {
    name: &'static str,
    eval: UnaryMathFunction,
    derivative: DerivativeFunction,
    latex: LatexStyle,
}

fn num(value: f64) -> Expr {
    Expr::Num(value)
}

fn call(name: &str, args: Vec<Expr>) -> Expr {
    Expr::Call(name.to_string(), args)
}

fn bin(op: BinOp, left: Expr, right: Expr) -> Expr {
    Expr::Binary(op, Box::new(left), Box::new(right))
}

fn neg(expr: Expr) -> Expr {
    Expr::Unary(UnaryOp::Neg, Box::new(expr))
}

fn arg_sq(arg: &Expr) -> Expr {
    bin(BinOp::Pow, arg.clone(), num(2.0))
}

fn derivative_sin(arg: &Expr) -> Expr {
    call("cos", vec![arg.clone()])
}

fn derivative_cos(arg: &Expr) -> Expr {
    neg(call("sin", vec![arg.clone()]))
}

fn derivative_tan(arg: &Expr) -> Expr {
    bin(
        BinOp::Div,
        num(1.0),
        bin(BinOp::Pow, call("cos", vec![arg.clone()]), num(2.0)),
    )
}

fn inverse_sqrt_of_one_minus_square(arg: &Expr) -> Expr {
    bin(
        BinOp::Div,
        num(1.0),
        call("sqrt", vec![bin(BinOp::Sub, num(1.0), arg_sq(arg))]),
    )
}

fn derivative_asin(arg: &Expr) -> Expr {
    inverse_sqrt_of_one_minus_square(arg)
}

fn derivative_acos(arg: &Expr) -> Expr {
    neg(inverse_sqrt_of_one_minus_square(arg))
}

fn derivative_atan(arg: &Expr) -> Expr {
    bin(BinOp::Div, num(1.0), bin(BinOp::Add, arg_sq(arg), num(1.0)))
}

fn derivative_sinh(arg: &Expr) -> Expr {
    call("cosh", vec![arg.clone()])
}

fn derivative_cosh(arg: &Expr) -> Expr {
    call("sinh", vec![arg.clone()])
}

fn derivative_tanh(arg: &Expr) -> Expr {
    bin(
        BinOp::Div,
        num(1.0),
        bin(BinOp::Pow, call("cosh", vec![arg.clone()]), num(2.0)),
    )
}

fn derivative_exp(arg: &Expr) -> Expr {
    call("exp", vec![arg.clone()])
}

fn derivative_ln(arg: &Expr) -> Expr {
    bin(BinOp::Div, num(1.0), arg.clone())
}

fn derivative_log_base(arg: &Expr, base: f64) -> Expr {
    bin(
        BinOp::Div,
        num(1.0),
        bin(BinOp::Mul, arg.clone(), call("ln", vec![num(base)])),
    )
}

fn derivative_log10(arg: &Expr) -> Expr {
    derivative_log_base(arg, 10.0)
}

fn derivative_log2(arg: &Expr) -> Expr {
    derivative_log_base(arg, 2.0)
}

fn derivative_sqrt(arg: &Expr) -> Expr {
    bin(
        BinOp::Div,
        num(1.0),
        bin(BinOp::Mul, num(2.0), call("sqrt", vec![arg.clone()])),
    )
}

fn derivative_abs(arg: &Expr) -> Expr {
    bin(
        BinOp::Mul,
        call("abs", vec![arg.clone()]),
        bin(BinOp::Div, num(1.0), arg.clone()),
    )
}

const MATH_FUNCTIONS: &[MathBuiltin] = &[
    MathBuiltin {
        name: "sin",
        eval: f64::sin,
        derivative: derivative_sin,
        latex: LatexStyle::Named("\\sin"),
    },
    MathBuiltin {
        name: "cos",
        eval: f64::cos,
        derivative: derivative_cos,
        latex: LatexStyle::Named("\\cos"),
    },
    MathBuiltin {
        name: "tan",
        eval: f64::tan,
        derivative: derivative_tan,
        latex: LatexStyle::Named("\\tan"),
    },
    MathBuiltin {
        name: "asin",
        eval: f64::asin,
        derivative: derivative_asin,
        latex: LatexStyle::Named("\\arcsin"),
    },
    MathBuiltin {
        name: "acos",
        eval: f64::acos,
        derivative: derivative_acos,
        latex: LatexStyle::Named("\\arccos"),
    },
    MathBuiltin {
        name: "atan",
        eval: f64::atan,
        derivative: derivative_atan,
        latex: LatexStyle::Named("\\arctan"),
    },
    MathBuiltin {
        name: "sinh",
        eval: f64::sinh,
        derivative: derivative_sinh,
        latex: LatexStyle::Named("\\sinh"),
    },
    MathBuiltin {
        name: "cosh",
        eval: f64::cosh,
        derivative: derivative_cosh,
        latex: LatexStyle::Named("\\cosh"),
    },
    MathBuiltin {
        name: "tanh",
        eval: f64::tanh,
        derivative: derivative_tanh,
        latex: LatexStyle::Named("\\tanh"),
    },
    MathBuiltin {
        name: "exp",
        eval: f64::exp,
        derivative: derivative_exp,
        latex: LatexStyle::Exp,
    },
    MathBuiltin {
        name: "ln",
        eval: f64::ln,
        derivative: derivative_ln,
        latex: LatexStyle::Named("\\ln"),
    },
    MathBuiltin {
        name: "log10",
        eval: f64::log10,
        derivative: derivative_log10,
        latex: LatexStyle::LogBase(10),
    },
    MathBuiltin {
        name: "log2",
        eval: f64::log2,
        derivative: derivative_log2,
        latex: LatexStyle::LogBase(2),
    },
    MathBuiltin {
        name: "sqrt",
        eval: f64::sqrt,
        derivative: derivative_sqrt,
        latex: LatexStyle::Sqrt,
    },
    MathBuiltin {
        name: "abs",
        eval: f64::abs,
        derivative: derivative_abs,
        latex: LatexStyle::Abs,
    },
];

pub(crate) fn is_supported_function(name: &str) -> bool {
    MATH_FUNCTIONS.iter().any(|builtin| builtin.name == name)
}

/// 应用一元内置函数;函数不存在时返回 `Err`.
pub(crate) fn apply_unary(name: &str, value: f64) -> Result<f64, String> {
    MATH_FUNCTIONS
        .iter()
        .find(|builtin| builtin.name == name)
        .map(|builtin| (builtin.eval)(value))
        .ok_or_else(|| format!("表达式暂不支持函数 {name}"))
}

/// 返回函数对应的 LaTeX 样式;不属于基础函数时返回 `None`.
pub(crate) fn latex_style(name: &str) -> Option<LatexStyle> {
    MATH_FUNCTIONS
        .iter()
        .find(|builtin| builtin.name == name)
        .map(|builtin| builtin.latex)
}

/// 返回 `f'(arg)`,由调用方再乘上链式法则中的 `darg`.
pub(crate) fn derivative_unary(name: &str) -> Option<DerivativeFunction> {
    MATH_FUNCTIONS
        .iter()
        .find(|builtin| builtin.name == name)
        .map(|builtin| builtin.derivative)
}
