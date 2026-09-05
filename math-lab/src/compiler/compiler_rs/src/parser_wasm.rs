use pest::iterators::Pair;
use pest::Parser;
use pest_derive::Parser;
use serde_json::{json, Value};
// 本解析器将 `.miko` DSL 源码解析为抽象语法树(AST)

#[derive(Parser)]
#[grammar = "miko.pest"]
pub struct MikoParser;

// AST 的 TypeScript 形状以 `compiler/ast/types.ts` 为唯一 schema;
// 这里不再维护一套 Rust 镜像类型,而是直接构造 JSON,避免改 DSL 时
// 需要在 Rust enum 和 TS interface 两处同步.

/// 获取语法树节点的源码位置(起始和结束偏移),返回 JSON 对象
fn span_of(pair: &Pair<'_, Rule>) -> Value {
    let span = pair.as_span();
    json!({
        "start": span.start(),
        "end": span.end(),
    })
}

/// 从节点中提取标识符(ident)的内容.
/// 先获取该节点的内部子节点,然后查找规则为 `ident` 的子节点,
/// 取其字符串值,若不存在则返回空字符串.
fn pair_ident(pair: &Pair<'_, Rule>) -> String {
    pair.clone()
        .into_inner()
        .find(|child| child.as_rule() == Rule::ident)
        .map(|child| child.as_str().to_string())
        .unwrap_or_default()
}

/// 从 `option` 规则节点中提取所有选项(option)的 name-value 对.
/// 每个 option 由 ident 和 value 组成,返回 JSON 数组.
fn option_pairs(pair: &Pair<'_, Rule>) -> Vec<Value> {
    pair.clone()
        .into_inner()
        .filter(|child| child.as_rule() == Rule::option)
        .map(|child| {
            let mut name = String::new();
            let mut value = String::new();
            for inner in child.into_inner() {
                match inner.as_rule() {
                    Rule::ident => name = inner.as_str().to_string(),
                    Rule::value => value = inner.as_str().trim().to_string(),
                    _ => {}
                }
            }
            json!({
                "name": name,
                "value": value,
            })
        })
        .collect()
}

/// 从 `*_end` 子节点中提取统一的 `{ option = value; ... }` 列表.
/// 调用 `option_pairs` 将其转换为 JSON 数组.
/// 若没有 options,返回空数组.
fn options_from_end(end: &Pair<'_, Rule>) -> Vec<Value> {
    end.clone()
        .into_inner()
        .find(|child| child.as_rule() == Rule::options)
        .map(|options| option_pairs(&options))
        .unwrap_or_default()
}

/// 提取参数语句的可选 UI 约束(param_ui).
/// 如果存在,则提取三个数字(min, max, step)并返回 JSON 对象.
fn param_ui(pair: &Pair<'_, Rule>) -> Option<Value> {
    pair.clone()
        .into_inner()
        .find(|child| child.as_rule() == Rule::param_ui)
        .map(|ui| {
            let nums: Vec<String> = ui
                .into_inner()
                .filter(|child| child.as_rule() == Rule::number)
                .map(|child| child.as_str().to_string())
                .collect();
            json!({
                "min": nums.first().cloned().unwrap_or_default(),
                "max": nums.get(1).cloned().unwrap_or_default(),
                "step": nums.get(2).cloned().unwrap_or_default(),
            })
        })
}

/// 将参数语句(param_stmt)转换为 JSON AST 节点.
/// 包含类型,名称,值,位置,以及可选的 UI 约束.
fn param_to_stmt(pair: &Pair<'_, Rule>) -> Value {
    let name = pair_ident(pair);
    let value = pair
        .clone()
        .into_inner()
        .find(|child| child.as_rule() == Rule::param_value)
        .map(|child| child.as_str().trim().to_string())
        .unwrap_or_default();

    let mut statement = json!({
        "type": "param",
        "name": name,
        "value": value,
        "span": span_of(pair),
    });
    if let Some(ui) = param_ui(pair) {
        statement["ui"] = ui;
    }
    statement
}

/// 将张量语句(tensor_stmt)转换为 JSON AST 节点.
/// 包含 kind(如 buffer, texture 等),名称,表达式(expr)和位置.
fn tensor_to_stmt(pair: &Pair<'_, Rule>) -> Value {
    let mut kind = String::new();
    let mut name = String::new();
    let mut expr = String::new();

    for child in pair.clone().into_inner() {
        match child.as_rule() {
            Rule::tensor_kind => kind = child.as_str().to_string(),
            Rule::ident => name = child.as_str().to_string(),
            Rule::expr => expr = child.as_str().trim().to_string(),
            _ => {}
        }
    }

    json!({
        "type": "tensor",
        "kind": kind,
        "name": name,
        "expr": expr,
        "span": span_of(pair),
    })
}

/// 将动画语句(animation_stmt)转换为 JSON AST 节点.
/// 包含名称,表达式,选项列表和位置.
fn animation_to_stmt(pair: &Pair<'_, Rule>) -> Value {
    let mut name = String::new();
    let mut expr = String::new();
    let mut options: Vec<Value> = Vec::new();

    for child in pair.clone().into_inner() {
        match child.as_rule() {
            Rule::ident => name = child.as_str().to_string(),
            Rule::expr => expr = child.as_str().trim().to_string(),
            Rule::stmt_end => options = options_from_end(&child),
            _ => {}
        }
    }

    json!({
        "type": "animation",
        "name": name,
        "expr": expr,
        "options": options,
        "span": span_of(pair),
    })
}

/// 将对象语句(object_stmt)转换为 JSON AST 节点.
/// 包含 kind(如 mesh, light 等),名称,表达式,选项列表和位置.
fn object_to_stmt(pair: &Pair<'_, Rule>) -> Value {
    let mut kind = String::new();
    let mut name = String::new();
    let mut expr = String::new();
    let mut options: Vec<Value> = Vec::new();

    for child in pair.clone().into_inner() {
        match child.as_rule() {
            Rule::object_kind => kind = child.as_str().to_string(),
            Rule::ident => name = child.as_str().to_string(),
            Rule::expr => expr = child.as_str().trim().to_string(),
            Rule::stmt_end => options = options_from_end(&child),
            _ => {}
        }
    }

    json!({
        "type": "object",
        "kind": kind,
        "name": name,
        "expr": expr,
        "options": options,
        "span": span_of(pair),
    })
}

/// 将分析语句(analysis_stmt)转换为 JSON AST 节点.
/// 包含操作符(op),名称,调用(call),源(source),
/// 可选的 at 参数,选项列表和位置.
fn analysis_to_stmt(pair: &Pair<'_, Rule>) -> Value {
    let mut op = String::new();
    let mut name = String::new();
    let mut call = String::new();
    let mut source = String::new();
    let mut at: Option<Vec<String>> = None;
    let mut options: Vec<Value> = Vec::new();

    for child in pair.clone().into_inner() {
        match child.as_rule() {
            Rule::analysis_op => op = child.as_str().to_string(),
            Rule::ident => name = child.as_str().to_string(),
            Rule::op_call => {
                for inner in child.into_inner() {
                    match inner.as_rule() {
                        Rule::ident => call = inner.as_str().to_string(),
                        Rule::op_arg => source = inner.as_str().trim().to_string(),
                        Rule::at => {
                            let args: Vec<String> = inner
                                .into_inner()
                                .filter(|n| n.as_rule() == Rule::at_arg)
                                .map(|n| n.as_str().trim().to_string())
                                .collect();
                            at = Some(args);
                        }
                        _ => {}
                    }
                }
            }
            Rule::stmt_end => options = options_from_end(&child),
            _ => {}
        }
    }

    let mut statement = json!({
        "type": "analysis",
        "op": op,
        "name": name,
        "call": call,
        "source": source,
        "options": options,
        "span": span_of(pair),
    });
    if let Some(at) = at {
        statement["at"] = json!(at);
    }
    statement
}

/// 将积分语句(integral_stmt)转换为 JSON AST 节点.
/// 包含名称,源(source),选项列表和位置.
fn integral_to_stmt(pair: &Pair<'_, Rule>) -> Value {
    let mut name = String::new();
    let mut source = String::new();
    let mut options: Vec<Value> = Vec::new();

    for child in pair.clone().into_inner() {
        match child.as_rule() {
            Rule::ident => name = child.as_str().to_string(),
            Rule::integral_call => {
                if let Some(source_ident) = child
                    .into_inner()
                    .find(|inner| inner.as_rule() == Rule::ident)
                {
                    source = source_ident.as_str().to_string();
                }
            }
            Rule::stmt_end => options = options_from_end(&child),
            _ => {}
        }
    }

    json!({
        "type": "integral",
        "name": name,
        "source": source,
        "options": options,
        "span": span_of(pair),
    })
}

/// 将交集语句(intersection_stmt)转换为 JSON AST 节点.
/// 包含名称,两个操作数 a 和 b,选项列表和位置.
fn intersection_to_stmt(pair: &Pair<'_, Rule>) -> Value {
    let mut name = String::new();
    let mut a = String::new();
    let mut b = String::new();
    let mut options: Vec<Value> = Vec::new();

    for child in pair.clone().into_inner() {
        match child.as_rule() {
            Rule::ident => name = child.as_str().to_string(),
            Rule::intersection_call => {
                let mut args = child
                    .into_inner()
                    .filter(|inner| inner.as_rule() == Rule::ident);
                if let Some(first) = args.next() {
                    a = first.as_str().to_string();
                }
                if let Some(second) = args.next() {
                    b = second.as_str().to_string();
                }
            }
            Rule::stmt_end => options = options_from_end(&child),
            _ => {}
        }
    }

    json!({
        "type": "intersection",
        "name": name,
        "a": a,
        "b": b,
        "options": options,
        "span": span_of(pair),
    })
}

/// 根据语法规则将单个语句节点(Pair)转换为对应的 AST JSON 节点.
/// 若规则未知,则返回错误信息.
fn statement_to_ast(pair: Pair<'_, Rule>) -> Result<Value, String> {
    match pair.as_rule() {
        Rule::param_stmt => Ok(param_to_stmt(&pair)),
        Rule::tensor_stmt => Ok(tensor_to_stmt(&pair)),
        Rule::animation_stmt => Ok(animation_to_stmt(&pair)),
        Rule::object_stmt => Ok(object_to_stmt(&pair)),
        Rule::analysis_stmt => Ok(analysis_to_stmt(&pair)),
        Rule::integral_stmt => Ok(integral_to_stmt(&pair)),
        Rule::intersection_stmt => Ok(intersection_to_stmt(&pair)),
        _ => Err(format!("未知语句规则: {:?}", pair.as_rule())),
    }
}

/// -------------
/// 总入口
/// -------------
/// 接收 `.miko` 源码字符串,返回 JSON 格式的 AST 字符串
/// 内部先调用 pest 解析器得到程序根节点,再遍历子节点(语句)逐一转换,
/// 最后将所有语句打包成 `{ "statements": [...] }` 并序列化为 JSON.
pub fn parse_to_json(source: &str) -> Result<String, String> {
    let mut pairs: pest::iterators::Pairs<'_, Rule> =
        MikoParser::parse(Rule::program, source).map_err(|err| err.to_string())?;
    // 取出唯一一个程序节点
    let program: Pair<'_, Rule> = pairs.next().ok_or_else(|| "空的解析结果".to_string())?;
    // 遍历程序节点的内部子节点,过滤掉 EOI(结束符),对每个语句节点调用 statement_to_ast
    let statements: Vec<Value> = program
        .into_inner()
        .filter(|child| child.as_rule() != Rule::EOI)
        .map(statement_to_ast)
        .collect::<Result<Vec<_>, _>>()?;
    // 构建最终 JSON 并序列化
    serde_json::to_string(&json!({ "statements": statements })).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_param_tensor_object_analysis_and_integral() {
        let src = r##"
// 这是单行注释
param a = 2 in [-5, 5, 0.1];
scalar k = 2.5;
vector v = [1, 2, 3];
matrix M = [[1, 0], [0, 1]];
transform T = translate([1, 2, 3]) * rotate([0, 0, pi / 4]);
animation spin = rotate([0, 0, pi / 4]) {
    duration = 2;
};
curve c1 = sin(x * a) {
    color = "#6dd5ff";
    range = [-8, 8];
    segments = 256;
    animation = [spin];
}
region R = region(c1, c1_2) {
    color = "#6bffb8";
    opacity = 0.35;
    range = [-4, 4];
    segments = 256;
}
curve c1_2 = x * a {
    range = [-8, 8];
}
surface s1 = sin(x) * cos(y) {
    transform = T;
    range = [-6, 6, -6, 6];
    segments = 96;
}
vector_field F = [y, -x, 0] {
    range = [-4, 4, -4, 4, -4, 4];
    grid = [8, 8, 8];
    scale = 1.2;
}
point P = [1, 2, 3] {
    color = "#6dd5ff";
}
vector V = [[0, 0, 0], [1, 0, 0]] {
    color = "#ff6b8a";
}
sphere S = [0, 1, 0] {
    radius = 2;
    opacity = 0.6;
}
box B = [1, 2, 3] {
    size = [2, 1, 1];
}
cylinder C = [0, 0, 0] {
    base = 1;
    height = 2;
}
cone K = [0, 0, 1] {
    base = 2;
    height = 3;
}
frustum F = [0, 0, -1] {
    base = 2;
    height = 3;
    top = 1;
}
gradient g = grad(s1) at [a, b + 1] {
    show = [point, normal, tangent_plane];
}
curl c = curl(F) at [1, 2, 3];
integral I1 = integral(c1) {
    method = riemann;
    range = [-8, 8];
    segments = 32;
};
integral I2 = integral(s1) {
    method = lebesgue;
    range = [-6, 6, -6, 6];
    segments = 32;
    layers = 16;
};
integral I3 = integral(c1) {
    method = riemann:right;
    range = [-8, 8];
    segments = 32;
};
intersection X = intersection(c1, s1) {
    color = "#ffffff";
    segments = 96;
};
intersect Y = intersect(s1, S);
"##;
        let json = parse_to_json(src).unwrap();
        assert!(json.contains("\"type\":\"param\""));
        assert!(json.contains("\"type\":\"tensor\""));
        assert!(json.contains("\"type\":\"animation\""));
        assert!(json.contains("\"type\":\"object\""));
        assert!(json.contains("\"kind\":\"point\""));
        assert!(json.contains("\"kind\":\"vector\""));
        assert!(json.contains("\"kind\":\"sphere\""));
        assert!(json.contains("\"kind\":\"box\""));
        assert!(json.contains("\"kind\":\"cylinder\""));
        assert!(json.contains("\"kind\":\"cone\""));
        assert!(json.contains("\"kind\":\"frustum\""));
        assert!(json.contains("\"kind\":\"region\""));
        assert!(json.contains("region(c1, c1_2)"));
        assert!(json.contains("\"type\":\"analysis\""));
        assert!(json.contains("\"type\":\"integral\""));
        assert!(json.contains("riemann:right"));
        assert!(json.contains("\"type\":\"intersection\""));
        assert!(json.contains("\"a\":\"c1\""));
        assert!(json.contains("\"b\":\"s1\""));
        assert!(json.contains("\"type\":\"intersection\""));
        assert!(json.contains("\"name\":\"Y\""));
        assert!(json.contains("\"a\":\"s1\""));
        assert!(json.contains("\"b\":\"S\""));
    }

    #[test]
    fn rejects_unknown_statement_rules_instead_of_dropping_them() {
        let pair = MikoParser::parse(Rule::number, "1")
            .unwrap()
            .next()
            .unwrap();

        let result = statement_to_ast(pair);
        assert!(result.is_err());
        let error = result.err().unwrap();
        assert!(error.contains("未知语句规则"));
    }
}
