use evalexpr::{ContextWithMutableFunctions, Function, HashMapContext, Value};

/// 向 evalexpr 上下文注册当前 DSL 数值求值依赖的内置函数。
pub fn register_builtins(ctx: &mut HashMapContext) {
    let funcs: &[(&str, fn(f64) -> f64)] = &[
        ("sin", f64::sin),
        ("cos", f64::cos),
        ("tan", f64::tan),
        ("asin", f64::asin),
        ("acos", f64::acos),
        ("atan", f64::atan),
        ("sinh", f64::sinh),
        ("cosh", f64::cosh),
        ("tanh", f64::tanh),
        ("exp", f64::exp),
        ("ln", f64::ln),
        ("log10", f64::log10),
        ("log2", f64::log2),
        ("sqrt", f64::sqrt),
        ("abs", f64::abs),
    ];

    for &(name, f) in funcs {
        ctx.set_function(
            name.to_string(),
            Function::new(move |arg: &Value| Ok(Value::Float(f(arg.as_float()?)))),
        )
        .unwrap();
    }
}
