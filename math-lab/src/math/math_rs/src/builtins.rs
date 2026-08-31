use evalexpr::{ContextWithMutableFunctions, Function, HashMapContext, Value};

/// 当前 WASM 数值求值只暴露单参数/单返回值函数.
/// 单独起一个类型别名,既便于扩展,也避免 clippy 把函数指针表误报为复杂类型.
type UnaryMathFunction = fn(f64) -> f64;

/// 向 evalexpr 上下文注册当前 DSL 数值求值依赖的内置函数.
pub fn register_builtins(ctx: &mut HashMapContext) {
    let funcs: &[(&str, UnaryMathFunction)] = &[
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
