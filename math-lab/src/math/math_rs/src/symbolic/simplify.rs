//! 常量求值(用于 matrix 条目)与代数化简(折叠,去幺元/零元,乘积因子).

use std::f64::consts::{E, PI};

use super::eval::real_pow;
use super::{BinOp, Expr, UnaryOp};
use crate::builtins;

pub(crate) fn evaluate_constant(expr: &Expr) -> Result<f64, String> {
    match expr {
        Expr::Num(value) => Ok(*value),
        Expr::Sym(name) if name == "pi" || name == "PI" => Ok(PI),
        Expr::Sym(name) if name == "e" || name == "E" => Ok(E),
        Expr::Sym(name) => Err(format!("矩阵条目包含未绑定变量 {name}")),
        Expr::Unary(UnaryOp::Neg, operand) => Ok(-evaluate_constant(operand)?),
        Expr::Binary(op, left, right) => {
            let lhs = evaluate_constant(left)?;
            let rhs = evaluate_constant(right)?;
            match op {
                BinOp::Add => Ok(lhs + rhs),
                BinOp::Sub => Ok(lhs - rhs),
                BinOp::Mul => Ok(lhs * rhs),
                BinOp::Div => Ok(lhs / rhs),
                BinOp::Pow => Ok(real_pow(lhs, rhs)),
            }
        }
        Expr::Call(name, args) => {
            let values = args
                .iter()
                .map(evaluate_constant)
                .collect::<Result<Vec<_>, _>>()?;
            if values.len() != 1 {
                return Err(format!("矩阵条目包含不支持的函数 {name}"));
            }
            builtins::apply_unary(name, values[0])
                .map_err(|_| format!("矩阵条目包含不支持的函数 {name}"))
        }
        Expr::List(_) => Err("矩阵条目中不能包含嵌套数组".to_string()),
    }
}

// ============================================================
// 化简
// ============================================================

pub(crate) fn simplify(expr: Expr) -> Expr {
    match expr {
        Expr::Unary(UnaryOp::Neg, operand) => {
            let operand = simplify(*operand);
            match operand {
                Expr::Num(value) => Expr::Num(-value),
                Expr::Unary(UnaryOp::Neg, inner) => *inner,
                other => Expr::Unary(UnaryOp::Neg, Box::new(other)),
            }
        }
        Expr::Binary(op, left, right) => {
            let left = simplify(*left);
            let right = simplify(*right);
            simplify_binary(op, left, right)
        }
        Expr::Call(name, args) => {
            let args = args.into_iter().map(simplify).collect();
            simplify_call(&name, args)
        }
        Expr::List(items) => Expr::List(items.into_iter().map(simplify).collect()),
        other => other,
    }
}

fn simplify_binary(op: BinOp, left: Expr, right: Expr) -> Expr {
    if let (Expr::Num(lhs), Expr::Num(rhs)) = (&left, &right) {
        let value = match op {
            BinOp::Add => lhs + rhs,
            BinOp::Sub => lhs - rhs,
            BinOp::Mul => lhs * rhs,
            BinOp::Div => lhs / rhs,
            BinOp::Pow => real_pow(*lhs, *rhs),
        };
        if value.is_finite() {
            return Expr::Num(value);
        }
    }

    match op {
        BinOp::Add => {
            if is_zero(&left) {
                return right;
            }
            if is_zero(&right) {
                return left;
            }
        }
        BinOp::Sub => {
            if is_zero(&right) {
                return left;
            }
            if is_zero(&left) {
                return Expr::Unary(UnaryOp::Neg, Box::new(right));
            }
        }
        BinOp::Mul => {
            if is_zero(&left) || is_zero(&right) {
                return Expr::Num(0.0);
            }
            if is_one(&left) {
                return right;
            }
            if is_one(&right) {
                return left;
            }
            return simplify_mul(left, right);
        }
        BinOp::Div => {
            if is_zero(&left) {
                return Expr::Num(0.0);
            }
            if is_one(&right) {
                return left;
            }
        }
        BinOp::Pow => {
            if is_zero(&right) {
                return Expr::Num(1.0);
            }
            if is_one(&right) {
                return left;
            }
        }
    }

    Expr::Binary(op, Box::new(left), Box::new(right))
}

fn simplify_call(name: &str, args: Vec<Expr>) -> Expr {
    if args.iter().all(|arg| matches!(arg, Expr::Num(_))) {
        if let Ok(value) = evaluate_constant(&Expr::Call(name.to_string(), args.clone())) {
            if value.is_finite() {
                return Expr::Num(value);
            }
        }
    }
    Expr::Call(name.to_string(), args)
}

fn is_zero(expr: &Expr) -> bool {
    matches!(expr, Expr::Num(value) if *value == 0.0)
}

fn is_one(expr: &Expr) -> bool {
    matches!(expr, Expr::Num(value) if *value == 1.0)
}

fn simplify_mul(left: Expr, right: Expr) -> Expr {
    let mut factors = Vec::new();
    collect_mul_factors(left, &mut factors);
    collect_mul_factors(right, &mut factors);

    let mut negative = false;
    let mut clean_factors: Vec<Expr> = Vec::new();
    for factor in factors {
        if let Expr::Unary(UnaryOp::Neg, inner) = factor {
            negative = !negative;
            if !matches!(*inner, Expr::Num(_)) {
                clean_factors.push(*inner);
            }
        } else {
            clean_factors.push(factor);
        }
    }

    let mut product = Expr::Num(1.0);
    for factor in clean_factors {
        if is_one(&factor) {
            continue;
        }
        if is_zero(&factor) {
            return Expr::Num(0.0);
        }
        product = if matches!(product, Expr::Num(value) if value == 1.0) {
            factor
        } else if let Expr::Num(value) = factor {
            if let Expr::Num(acc) = product {
                Expr::Num(acc * value)
            } else {
                Expr::Binary(BinOp::Mul, Box::new(Expr::Num(value)), Box::new(product))
            }
        } else {
            Expr::Binary(BinOp::Mul, Box::new(product), Box::new(factor))
        };
    }

    if negative {
        product = Expr::Unary(UnaryOp::Neg, Box::new(product));
    }
    product
}

fn collect_mul_factors(expr: Expr, out: &mut Vec<Expr>) {
    match expr {
        Expr::Binary(BinOp::Mul, left, right) => {
            collect_mul_factors(*left, out);
            collect_mul_factors(*right, out);
        }
        Expr::Num(1.0) => {}
        other => out.push(other),
    }
}
