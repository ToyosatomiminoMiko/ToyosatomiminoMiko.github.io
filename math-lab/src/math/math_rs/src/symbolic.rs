use std::collections::HashSet;
use std::f64::consts::{E, PI};

// ============================================================
// 轻量符号表达式引擎。
//
// 目标不是复刻完整的外部数学库，而是把项目中实际依赖的符号能力
// （解析、别名归一化、符号求导、自由变量提取、数组解析、常量矩阵求值）
// 迁到 Rust/WASM，使 TS 编译层和数值层不再依赖外部 JS 数学库。
// ============================================================

#[derive(Debug, Clone, PartialEq)]
enum Expr {
    Num(f64),
    Sym(String),
    Unary(UnaryOp, Box<Expr>),
    Binary(BinOp, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
    List(Vec<Expr>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UnaryOp {
    Neg,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BinOp {
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

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Num(f64),
    Ident(String),
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    LParen,
    RParen,
    LBracket,
    RBracket,
    Comma,
    End,
}

struct Lexer {
    chars: Vec<char>,
    pos: usize,
}

impl Lexer {
    fn new(source: &str) -> Self {
        Self {
            chars: source.chars().collect(),
            pos: 0,
        }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn peek_next(&self) -> Option<char> {
        self.chars.get(self.pos + 1).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let ch = self.peek();
        if ch.is_some() {
            self.pos += 1;
        }
        ch
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(ch) if ch.is_whitespace()) {
            self.bump();
        }
    }

    fn lex(mut self) -> Result<Vec<Token>, String> {
        let mut tokens = Vec::new();
        loop {
            self.skip_whitespace();
            let Some(ch) = self.peek() else {
                tokens.push(Token::End);
                return Ok(tokens);
            };

            match ch {
                '+' => {
                    self.bump();
                    tokens.push(Token::Plus);
                }
                '-' => {
                    self.bump();
                    tokens.push(Token::Minus);
                }
                '*' => {
                    self.bump();
                    tokens.push(Token::Star);
                }
                '/' => {
                    self.bump();
                    tokens.push(Token::Slash);
                }
                '^' => {
                    self.bump();
                    tokens.push(Token::Caret);
                }
                '(' => {
                    self.bump();
                    tokens.push(Token::LParen);
                }
                ')' => {
                    self.bump();
                    tokens.push(Token::RParen);
                }
                '[' => {
                    self.bump();
                    tokens.push(Token::LBracket);
                }
                ']' => {
                    self.bump();
                    tokens.push(Token::RBracket);
                }
                ',' => {
                    self.bump();
                    tokens.push(Token::Comma);
                }
                _ if ch.is_ascii_digit() || ch == '.' => {
                    tokens.push(self.lex_number()?);
                }
                _ if ch.is_alphabetic() || ch == '_' => {
                    tokens.push(Token::Ident(self.lex_ident()));
                }
                _ => {
                    return Err(format!("表达式包含无法识别的字符: {ch:?}"));
                }
            }
        }
    }

    fn lex_number(&mut self) -> Result<Token, String> {
        let start = self.pos;
        let mut saw_dot = false;
        while let Some(ch) = self.peek() {
            if ch.is_ascii_digit() {
                self.bump();
            } else if ch == '.' && !saw_dot {
                saw_dot = true;
                self.bump();
            } else {
                break;
            }
        }

        if matches!(self.peek(), Some('e' | 'E')) {
            let exponent_sign = matches!(self.peek_next(), Some('+' | '-'));
            if exponent_sign || matches!(self.peek_next(), Some(ch) if ch.is_ascii_digit()) {
                self.bump();
                if matches!(self.peek(), Some('+' | '-')) {
                    self.bump();
                }
                while matches!(self.peek(), Some(ch) if ch.is_ascii_digit()) {
                    self.bump();
                }
            }
        }

        let text: String = self.chars[start..self.pos].iter().collect();
        let value: f64 = text.parse().map_err(|_| format!("无法解析数字: {text}"))?;
        Ok(Token::Num(value))
    }

    fn lex_ident(&mut self) -> String {
        let start = self.pos;
        while matches!(
            self.peek(),
            Some(ch) if ch.is_ascii_alphanumeric() || ch == '_'
        ) {
            self.bump();
        }
        self.chars[start..self.pos].iter().collect()
    }
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, pos: 0 }
    }

    fn peek(&self) -> &Token {
        &self.tokens[self.pos]
    }

    fn bump(&mut self) -> Token {
        let token = self.tokens[self.pos].clone();
        if !matches!(token, Token::End) {
            self.pos += 1;
        }
        token
    }

    fn is_atom(&self) -> bool {
        matches!(
            self.peek(),
            Token::Num(_) | Token::Ident(_) | Token::LParen | Token::LBracket
        )
    }

    fn parse(mut self) -> Result<Expr, String> {
        let expr = self.parse_expr(0)?;
        if !matches!(self.peek(), Token::End) {
            return Err(format!(
                "表达式末尾存在无法解析的内容: {}",
                self.token_desc(self.peek())
            ));
        }
        Ok(expr)
    }

    fn token_desc(&self, token: &Token) -> String {
        match token {
            Token::Num(value) => format!("数字 {value}"),
            Token::Ident(name) => name.clone(),
            Token::Plus => "+".to_string(),
            Token::Minus => "-".to_string(),
            Token::Star => "*".to_string(),
            Token::Slash => "/".to_string(),
            Token::Caret => "^".to_string(),
            Token::LParen => "(".to_string(),
            Token::RParen => ")".to_string(),
            Token::LBracket => "[".to_string(),
            Token::RBracket => "]".to_string(),
            Token::Comma => ",".to_string(),
            Token::End => "表达式末尾".to_string(),
        }
    }

    fn parse_expr(&mut self, min_prec: u8) -> Result<Expr, String> {
        let mut lhs = self.parse_prefix()?;

        loop {
            let (op, left_prec, right_prec) = if matches!(self.peek(), Token::Plus) {
                (Some(BinOp::Add), 20, 21)
            } else if matches!(self.peek(), Token::Minus) {
                (Some(BinOp::Sub), 20, 21)
            } else if matches!(self.peek(), Token::Star) {
                (Some(BinOp::Mul), 40, 41)
            } else if matches!(self.peek(), Token::Slash) {
                (Some(BinOp::Div), 40, 41)
            } else if matches!(self.peek(), Token::Caret) {
                // 幂运算右结合。
                (Some(BinOp::Pow), 70, 70)
            } else if self.is_atom() {
                // 2x、2 sin(x)、(x+1)(x-1) 等隐式乘法。
                (Some(BinOp::Mul), 50, 51)
            } else {
                (None, 0, 0)
            };

            let Some(op) = op else {
                break;
            };
            if left_prec < min_prec {
                break;
            }

            if !matches!(
                self.peek(),
                Token::Plus | Token::Minus | Token::Star | Token::Slash | Token::Caret
            ) {
                // 隐式乘法：当前 token 是右操作数的开始，不能先消费。
            } else {
                self.bump();
            }
            let rhs = self.parse_expr(right_prec)?;
            lhs = Expr::Binary(op, Box::new(lhs), Box::new(rhs));
        }

        Ok(lhs)
    }

    fn parse_prefix(&mut self) -> Result<Expr, String> {
        if matches!(self.peek(), Token::Plus) {
            self.bump();
            return self.parse_expr(60);
        }
        if matches!(self.peek(), Token::Minus) {
            self.bump();
            let operand = self.parse_expr(60)?;
            return Ok(Expr::Unary(UnaryOp::Neg, Box::new(operand)));
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Result<Expr, String> {
        match self.peek().clone() {
            Token::Num(value) => {
                self.bump();
                Ok(Expr::Num(value))
            }
            Token::Ident(name) => {
                self.bump();
                if matches!(self.peek(), Token::LParen) {
                    self.bump();
                    let mut args = Vec::new();
                    if matches!(self.peek(), Token::RParen) {
                        self.bump();
                        return Ok(Expr::Call(name, args));
                    }
                    loop {
                        args.push(self.parse_expr(0)?);
                        match self.peek() {
                            Token::Comma => {
                                self.bump();
                                if matches!(self.peek(), Token::RParen) {
                                    self.bump();
                                    break;
                                }
                            }
                            Token::RParen => {
                                self.bump();
                                break;
                            }
                            _ => return Err("函数参数列表缺少右括号或逗号".to_string()),
                        }
                    }
                    Ok(Expr::Call(name, args))
                } else {
                    Ok(Expr::Sym(name))
                }
            }
            Token::LParen => {
                self.bump();
                let expr = self.parse_expr(0)?;
                if !matches!(self.peek(), Token::RParen) {
                    return Err("表达式缺少右括号".to_string());
                }
                self.bump();
                Ok(expr)
            }
            Token::LBracket => self.parse_list(),
            other => Err(format!(
                "期望数字、变量、函数或括号，但得到: {}",
                self.token_desc(&other)
            )),
        }
    }

    fn parse_list(&mut self) -> Result<Expr, String> {
        debug_assert!(matches!(self.peek(), Token::LBracket));
        self.bump();
        let mut items = Vec::new();
        if matches!(self.peek(), Token::RBracket) {
            self.bump();
            return Ok(Expr::List(items));
        }

        loop {
            items.push(self.parse_expr(0)?);
            match self.peek() {
                Token::Comma => {
                    self.bump();
                    if matches!(self.peek(), Token::RBracket) {
                        self.bump();
                        break;
                    }
                }
                Token::RBracket => {
                    self.bump();
                    break;
                }
                _ => return Err("数组缺少右方括号或逗号".to_string()),
            }
        }
        Ok(Expr::List(items))
    }
}

fn parse_expr(source: &str) -> Result<Expr, String> {
    if source.trim().is_empty() {
        return Err("表达式不能为空".to_string());
    }
    let tokens = Lexer::new(source).lex()?;
    Parser::new(tokens).parse()
}

// ============================================================
// 别名归一化
// ============================================================

fn rewrite_aliases(expr: &Expr) -> Result<Expr, String> {
    let mut expr = expr.clone();
    rewrite_aliases_inner(&mut expr)?;
    Ok(expr)
}

fn rewrite_aliases_inner(expr: &mut Expr) -> Result<(), String> {
    match expr {
        Expr::Unary(_, operand) => rewrite_aliases_inner(operand),
        Expr::Binary(_, left, right) => {
            rewrite_aliases_inner(left)?;
            rewrite_aliases_inner(right)
        }
        Expr::List(items) => {
            for item in items {
                rewrite_aliases_inner(item)?;
            }
            Ok(())
        }
        Expr::Call(name, args) => {
            for arg in args.iter_mut() {
                rewrite_aliases_inner(arg)?;
            }
            match name.as_str() {
                "log" => {
                    if args.len() != 1 {
                        return Err("Rust 数值后端只支持单参数的自然对数 log(x)".to_string());
                    }
                    *expr = Expr::Call("ln".to_string(), args.clone());
                }
                "pow" => {
                    if args.len() != 2 {
                        return Err("Rust 数值后端只支持双参数的 pow(a, b)".to_string());
                    }
                    *expr = Expr::Binary(
                        BinOp::Pow,
                        Box::new(args[0].clone()),
                        Box::new(args[1].clone()),
                    );
                }
                "sec" => {
                    if args.len() != 1 {
                        return Err("sec 只接受一个参数".to_string());
                    }
                    *expr = Expr::Binary(
                        BinOp::Div,
                        Box::new(Expr::Num(1.0)),
                        Box::new(Expr::Call("cos".to_string(), args.clone())),
                    );
                }
                "csc" => {
                    if args.len() != 1 {
                        return Err("csc 只接受一个参数".to_string());
                    }
                    *expr = Expr::Binary(
                        BinOp::Div,
                        Box::new(Expr::Num(1.0)),
                        Box::new(Expr::Call("sin".to_string(), args.clone())),
                    );
                }
                "cot" => {
                    if args.len() != 1 {
                        return Err("cot 只接受一个参数".to_string());
                    }
                    *expr = Expr::Binary(
                        BinOp::Div,
                        Box::new(Expr::Call("cos".to_string(), args.clone())),
                        Box::new(Expr::Call("sin".to_string(), args.clone())),
                    );
                }
                "deg" => {
                    // 角度统一用弧度计算；DSL 里的角度写法通过 deg(180)
                    // 转换成 180 * pi / 180，避免再引入一套角度单位分支。
                    if args.len() != 1 {
                        return Err("deg 只接受一个参数".to_string());
                    }
                    *expr = Expr::Binary(
                        BinOp::Mul,
                        Box::new(args[0].clone()),
                        Box::new(Expr::Num(PI / 180.0)),
                    );
                }
                _ => {}
            }
            Ok(())
        }
        Expr::Sym(name) => {
            match name.as_str() {
                "pi" | "PI" => *expr = Expr::Num(PI),
                "e" | "E" => *expr = Expr::Num(E),
                _ => {}
            }
            Ok(())
        }
        Expr::Num(_) => Ok(()),
    }
}

fn is_supported_function(name: &str) -> bool {
    matches!(
        name,
        "sin"
            | "cos"
            | "tan"
            | "asin"
            | "acos"
            | "atan"
            | "sinh"
            | "cosh"
            | "tanh"
            | "exp"
            | "ln"
            | "log10"
            | "log2"
            | "sqrt"
            | "abs"
    )
}

fn validate_supported(expr: &Expr) -> Result<(), String> {
    match expr {
        Expr::Call(name, args) => {
            if !is_supported_function(name) {
                return Err(format!(
                    "表达式暂不支持函数 {name}，无法交给 Rust/WASM 数值求值"
                ));
            }
            for arg in args {
                validate_supported(arg)?;
            }
            Ok(())
        }
        Expr::Unary(_, operand) => validate_supported(operand),
        Expr::Binary(_, left, right) => {
            validate_supported(left)?;
            validate_supported(right)
        }
        Expr::List(items) => {
            for item in items {
                validate_supported(item)?;
            }
            Ok(())
        }
        Expr::Num(_) | Expr::Sym(_) => Ok(()),
    }
}

// ============================================================
// 字符串输出
// ============================================================

fn is_atomic(expr: &Expr) -> bool {
    matches!(expr, Expr::Num(_) | Expr::Sym(_))
}

fn parenthesize(inner: &str, needed: bool) -> String {
    if needed {
        format!("({inner})")
    } else {
        inner.to_string()
    }
}

fn format_number(value: f64) -> String {
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

impl Expr {
    fn to_string_with_prec(&self, parent_prec: u8) -> String {
        match self {
            Expr::Num(value) => format_number(*value),
            Expr::Sym(name) => name.clone(),
            Expr::List(items) => {
                let body = items
                    .iter()
                    .map(Expr::to_string)
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("[{body}]")
            }
            Expr::Unary(UnaryOp::Neg, operand) => {
                let body = operand.to_string_with_prec(0);
                let text = if is_atomic(operand) || matches!(operand.as_ref(), Expr::Call(_, _)) {
                    format!("-{body}")
                } else {
                    format!("-({body})")
                };
                if 60 < parent_prec {
                    format!("({text})")
                } else {
                    text
                }
            }
            Expr::Call(name, args) => {
                let body = args
                    .iter()
                    .map(Expr::to_string)
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("{name}({body})")
            }
            Expr::Binary(op, left, right) => {
                let prec = op.prec();
                let left_prec = expr_prec(left);
                let right_prec = expr_prec(right);
                let left_needs = left_prec < prec;
                let right_needs = right_prec < prec
                    || (right_prec == prec && matches!(op, BinOp::Sub | BinOp::Div | BinOp::Pow));
                let left = parenthesize(&left.to_string_with_prec(prec), left_needs);
                let right = parenthesize(&right.to_string_with_prec(prec), right_needs);
                let text = format!("{left} {} {right}", op.text());
                if prec < parent_prec {
                    format!("({text})")
                } else {
                    text
                }
            }
        }
    }
}

impl std::fmt::Display for Expr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.to_string_with_prec(0))
    }
}

fn expr_prec(expr: &Expr) -> u8 {
    match expr {
        Expr::Num(_) | Expr::Sym(_) | Expr::Call(_, _) | Expr::List(_) => 100,
        Expr::Unary(_, _) => 60,
        Expr::Binary(op, _, _) => op.prec(),
    }
}

// ============================================================
// 常量求值（用于 matrix 表达式）
// ============================================================

fn evaluate_constant(expr: &Expr) -> Result<f64, String> {
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
                BinOp::Pow => Ok(lhs.powf(rhs)),
            }
        }
        Expr::Call(name, args) => {
            let values = args
                .iter()
                .map(evaluate_constant)
                .collect::<Result<Vec<_>, _>>()?;
            match (name.as_str(), values.as_slice()) {
                ("sin", [x]) => Ok(x.sin()),
                ("cos", [x]) => Ok(x.cos()),
                ("tan", [x]) => Ok(x.tan()),
                ("asin", [x]) => Ok(x.asin()),
                ("acos", [x]) => Ok(x.acos()),
                ("atan", [x]) => Ok(x.atan()),
                ("sinh", [x]) => Ok(x.sinh()),
                ("cosh", [x]) => Ok(x.cosh()),
                ("tanh", [x]) => Ok(x.tanh()),
                ("exp", [x]) => Ok(x.exp()),
                ("ln", [x]) => Ok(x.ln()),
                ("log10", [x]) => Ok(x.log10()),
                ("log2", [x]) => Ok(x.log2()),
                ("sqrt", [x]) => Ok(x.sqrt()),
                ("abs", [x]) => Ok(x.abs()),
                _ => Err(format!("矩阵条目包含不支持的函数 {name}")),
            }
        }
        Expr::List(_) => Err("矩阵条目中不能包含嵌套数组".to_string()),
    }
}

// ============================================================
// 化简
// ============================================================

fn simplify(expr: Expr) -> Expr {
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
            BinOp::Pow => lhs.powf(*rhs),
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

// ============================================================
// 符号求导
// ============================================================

fn is_const_except(expr: &Expr, variable: &str) -> bool {
    match expr {
        Expr::Num(_) => true,
        Expr::Sym(name) => name != variable,
        Expr::Unary(_, operand) => is_const_except(operand, variable),
        Expr::Binary(_, left, right) => {
            is_const_except(left, variable) && is_const_except(right, variable)
        }
        Expr::Call(_, args) => args.iter().all(|arg| is_const_except(arg, variable)),
        Expr::List(_) => false,
    }
}

fn derivative(expr: &Expr, variable: &str) -> Result<Expr, String> {
    let expr = rewrite_aliases(expr)?;
    validate_supported(&expr)?;
    Ok(simplify(derivative_inner(&expr, variable)?))
}

fn derivative_inner(expr: &Expr, variable: &str) -> Result<Expr, String> {
    match expr {
        Expr::Num(_) => Ok(Expr::Num(0.0)),
        Expr::Sym(name) => Ok(if name == variable {
            Expr::Num(1.0)
        } else {
            Expr::Num(0.0)
        }),
        Expr::Unary(UnaryOp::Neg, operand) => Ok(Expr::Unary(
            UnaryOp::Neg,
            Box::new(derivative_inner(operand, variable)?),
        )),
        Expr::Binary(op, left, right) => {
            if is_const_except(expr, variable) {
                return Ok(Expr::Num(0.0));
            }
            derivative_binary(*op, left, right, variable)
        }
        Expr::Call(name, args) => {
            if is_const_except(expr, variable) {
                return Ok(Expr::Num(0.0));
            }
            derivative_call(name, args, variable)
        }
        Expr::List(_) => Err("不能对数组表达式直接求导".to_string()),
    }
}

fn derivative_binary(op: BinOp, left: &Expr, right: &Expr, variable: &str) -> Result<Expr, String> {
    match op {
        BinOp::Add => Ok(Expr::Binary(
            BinOp::Add,
            Box::new(derivative_inner(left, variable)?),
            Box::new(derivative_inner(right, variable)?),
        )),
        BinOp::Sub => Ok(Expr::Binary(
            BinOp::Sub,
            Box::new(derivative_inner(left, variable)?),
            Box::new(derivative_inner(right, variable)?),
        )),
        BinOp::Mul => {
            if is_const_except(left, variable) {
                return Ok(Expr::Binary(
                    BinOp::Mul,
                    Box::new(left.clone()),
                    Box::new(derivative_inner(right, variable)?),
                ));
            }
            if is_const_except(right, variable) {
                return Ok(Expr::Binary(
                    BinOp::Mul,
                    Box::new(right.clone()),
                    Box::new(derivative_inner(left, variable)?),
                ));
            }
            Ok(Expr::Binary(
                BinOp::Add,
                Box::new(Expr::Binary(
                    BinOp::Mul,
                    Box::new(derivative_inner(left, variable)?),
                    Box::new(right.clone()),
                )),
                Box::new(Expr::Binary(
                    BinOp::Mul,
                    Box::new(left.clone()),
                    Box::new(derivative_inner(right, variable)?),
                )),
            ))
        }
        BinOp::Div => {
            if is_const_except(right, variable) {
                return Ok(Expr::Binary(
                    BinOp::Div,
                    Box::new(derivative_inner(left, variable)?),
                    Box::new(right.clone()),
                ));
            }
            if is_const_except(left, variable) {
                return Ok(Expr::Binary(
                    BinOp::Mul,
                    Box::new(Expr::Unary(UnaryOp::Neg, Box::new(left.clone()))),
                    Box::new(Expr::Binary(
                        BinOp::Div,
                        Box::new(derivative_inner(right, variable)?),
                        Box::new(Expr::Binary(
                            BinOp::Pow,
                            Box::new(right.clone()),
                            Box::new(Expr::Num(2.0)),
                        )),
                    )),
                ));
            }
            Ok(Expr::Binary(
                BinOp::Div,
                Box::new(Expr::Binary(
                    BinOp::Sub,
                    Box::new(Expr::Binary(
                        BinOp::Mul,
                        Box::new(derivative_inner(left, variable)?),
                        Box::new(right.clone()),
                    )),
                    Box::new(Expr::Binary(
                        BinOp::Mul,
                        Box::new(left.clone()),
                        Box::new(derivative_inner(right, variable)?),
                    )),
                )),
                Box::new(Expr::Binary(
                    BinOp::Pow,
                    Box::new(right.clone()),
                    Box::new(Expr::Num(2.0)),
                )),
            ))
        }
        BinOp::Pow => {
            if is_const_except(left, variable) {
                return Ok(Expr::Binary(
                    BinOp::Mul,
                    Box::new(Expr::Binary(
                        BinOp::Pow,
                        Box::new(left.clone()),
                        Box::new(right.clone()),
                    )),
                    Box::new(Expr::Binary(
                        BinOp::Mul,
                        Box::new(Expr::Call("ln".to_string(), vec![left.clone()])),
                        Box::new(derivative_inner(right, variable)?),
                    )),
                ));
            }
            if is_const_except(right, variable) {
                return Ok(Expr::Binary(
                    BinOp::Mul,
                    Box::new(right.clone()),
                    Box::new(Expr::Binary(
                        BinOp::Mul,
                        Box::new(derivative_inner(left, variable)?),
                        Box::new(Expr::Binary(
                            BinOp::Pow,
                            Box::new(left.clone()),
                            Box::new(Expr::Binary(
                                BinOp::Sub,
                                Box::new(right.clone()),
                                Box::new(Expr::Num(1.0)),
                            )),
                        )),
                    )),
                ));
            }
            Ok(Expr::Binary(
                BinOp::Mul,
                Box::new(Expr::Binary(
                    BinOp::Pow,
                    Box::new(left.clone()),
                    Box::new(right.clone()),
                )),
                Box::new(Expr::Binary(
                    BinOp::Add,
                    Box::new(Expr::Binary(
                        BinOp::Mul,
                        Box::new(derivative_inner(left, variable)?),
                        Box::new(Expr::Binary(
                            BinOp::Div,
                            Box::new(right.clone()),
                            Box::new(left.clone()),
                        )),
                    )),
                    Box::new(Expr::Binary(
                        BinOp::Mul,
                        Box::new(derivative_inner(right, variable)?),
                        Box::new(Expr::Call("ln".to_string(), vec![left.clone()])),
                    )),
                )),
            ))
        }
    }
}

fn derivative_call(name: &str, args: &[Expr], variable: &str) -> Result<Expr, String> {
    let arg = args
        .first()
        .ok_or_else(|| format!("函数 {name} 至少需要一个参数"))?;
    let darg = derivative_inner(arg, variable)?;

    let func = match name {
        "sin" => Expr::Call("cos".to_string(), vec![arg.clone()]),
        "cos" => Expr::Unary(
            UnaryOp::Neg,
            Box::new(Expr::Call("sin".to_string(), vec![arg.clone()])),
        ),
        "tan" => Expr::Binary(
            BinOp::Div,
            Box::new(Expr::Num(1.0)),
            Box::new(Expr::Binary(
                BinOp::Pow,
                Box::new(Expr::Call("cos".to_string(), vec![arg.clone()])),
                Box::new(Expr::Num(2.0)),
            )),
        ),
        "asin" => Expr::Binary(
            BinOp::Div,
            Box::new(Expr::Num(1.0)),
            Box::new(Expr::Call(
                "sqrt".to_string(),
                vec![Expr::Binary(
                    BinOp::Sub,
                    Box::new(Expr::Num(1.0)),
                    Box::new(Expr::Binary(
                        BinOp::Pow,
                        Box::new(arg.clone()),
                        Box::new(Expr::Num(2.0)),
                    )),
                )],
            )),
        ),
        "acos" => Expr::Unary(
            UnaryOp::Neg,
            Box::new(Expr::Binary(
                BinOp::Div,
                Box::new(Expr::Num(1.0)),
                Box::new(Expr::Call(
                    "sqrt".to_string(),
                    vec![Expr::Binary(
                        BinOp::Sub,
                        Box::new(Expr::Num(1.0)),
                        Box::new(Expr::Binary(
                            BinOp::Pow,
                            Box::new(arg.clone()),
                            Box::new(Expr::Num(2.0)),
                        )),
                    )],
                )),
            )),
        ),
        "atan" => Expr::Binary(
            BinOp::Div,
            Box::new(Expr::Num(1.0)),
            Box::new(Expr::Binary(
                BinOp::Add,
                Box::new(Expr::Binary(
                    BinOp::Pow,
                    Box::new(arg.clone()),
                    Box::new(Expr::Num(2.0)),
                )),
                Box::new(Expr::Num(1.0)),
            )),
        ),
        "sinh" => Expr::Call("cosh".to_string(), vec![arg.clone()]),
        "cosh" => Expr::Call("sinh".to_string(), vec![arg.clone()]),
        "tanh" => Expr::Binary(
            BinOp::Div,
            Box::new(Expr::Num(1.0)),
            Box::new(Expr::Binary(
                BinOp::Pow,
                Box::new(Expr::Call("cosh".to_string(), vec![arg.clone()])),
                Box::new(Expr::Num(2.0)),
            )),
        ),
        "exp" => Expr::Call("exp".to_string(), vec![arg.clone()]),
        "ln" => Expr::Binary(BinOp::Div, Box::new(Expr::Num(1.0)), Box::new(arg.clone())),
        "log10" => Expr::Binary(
            BinOp::Div,
            Box::new(Expr::Num(1.0)),
            Box::new(Expr::Binary(
                BinOp::Mul,
                Box::new(arg.clone()),
                Box::new(Expr::Call("ln".to_string(), vec![Expr::Num(10.0)])),
            )),
        ),
        "log2" => Expr::Binary(
            BinOp::Div,
            Box::new(Expr::Num(1.0)),
            Box::new(Expr::Binary(
                BinOp::Mul,
                Box::new(arg.clone()),
                Box::new(Expr::Call("ln".to_string(), vec![Expr::Num(2.0)])),
            )),
        ),
        "sqrt" => Expr::Binary(
            BinOp::Div,
            Box::new(Expr::Num(1.0)),
            Box::new(Expr::Binary(
                BinOp::Mul,
                Box::new(Expr::Num(2.0)),
                Box::new(Expr::Call("sqrt".to_string(), vec![arg.clone()])),
            )),
        ),
        "abs" => Expr::Binary(
            BinOp::Mul,
            Box::new(Expr::Call("abs".to_string(), vec![arg.clone()])),
            Box::new(Expr::Binary(
                BinOp::Div,
                Box::new(Expr::Num(1.0)),
                Box::new(arg.clone()),
            )),
        ),
        _ => return Err(format!("表达式暂不支持函数 {name} 的符号求导")),
    };

    Ok(Expr::Binary(BinOp::Mul, Box::new(darg), Box::new(func)))
}

// ============================================================
// 符号提取与数组解析
// ============================================================

fn builtin_symbol(name: &str) -> bool {
    matches!(
        name,
        "sin"
            | "cos"
            | "tan"
            | "asin"
            | "acos"
            | "atan"
            | "sinh"
            | "cosh"
            | "tanh"
            | "exp"
            | "log"
            | "ln"
            | "log10"
            | "log2"
            | "sqrt"
            | "abs"
            | "pow"
            | "sec"
            | "csc"
            | "cot"
            | "deg"
            | "pi"
            | "PI"
            | "e"
            | "E"
            | "i"
            | "Infinity"
            | "NaN"
            | "true"
            | "false"
            | "null"
    )
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

    #[test]
    fn extracts_free_symbols() {
        let mut vars = symbolic_variables("sin(a * x) + b^2", &["x".to_string()]).unwrap();
        vars.sort();
        assert_eq!(vars, vec!["a", "b"]);
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
