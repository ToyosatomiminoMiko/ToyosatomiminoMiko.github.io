use pest::iterators::Pair;
use pest::Parser;
use pest_derive::Parser;

#[derive(Parser)]
#[grammar = "miko.pest"]
pub struct MikoParser;

fn json_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch if ch.is_control() => out.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => out.push(ch),
        }
    }
    out
}

fn span_json(pair: &Pair<'_, Rule>) -> String {
    let span = pair.as_span();
    format!(
        "\"span\":{{\"start\":{},\"end\":{}}}",
        span.start(),
        span.end()
    )
}

fn pair_ident(pair: &Pair<'_, Rule>) -> String {
    pair.clone()
        .into_inner()
        .find(|child| child.as_rule() == Rule::ident)
        .map(|child| child.as_str().to_string())
        .unwrap_or_default()
}

fn option_pairs(pair: &Pair<'_, Rule>) -> Vec<(String, String)> {
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
            (name, value)
        })
        .collect()
}

fn options_json(options: &[(String, String)]) -> String {
    let items: Vec<String> = options
        .iter()
        .map(|(name, value)| {
            format!(
                "{{\"name\":\"{}\",\"value\":\"{}\"}}",
                json_escape(name),
                json_escape(value)
            )
        })
        .collect();
    format!("[{}]", items.join(","))
}

fn param_ui(pair: &Pair<'_, Rule>) -> Option<(String, String, String)> {
    pair.clone()
        .into_inner()
        .find(|child| child.as_rule() == Rule::param_ui)
        .map(|ui| {
            let nums: Vec<String> = ui
                .into_inner()
                .filter(|child| child.as_rule() == Rule::number)
                .map(|child| child.as_str().to_string())
                .collect();
            (
                nums.get(0).cloned().unwrap_or_default(),
                nums.get(1).cloned().unwrap_or_default(),
                nums.get(2).cloned().unwrap_or_default(),
            )
        })
}

fn param_to_json(pair: &Pair<'_, Rule>) -> String {
    let name = pair_ident(pair);
    let value = pair
        .clone()
        .into_inner()
        .find(|child| child.as_rule() == Rule::param_value)
        .map(|child| child.as_str().trim().to_string())
        .unwrap_or_default();

    let mut fields = vec![
        "\"type\":\"param\"".to_string(),
        format!("\"name\":\"{}\"", json_escape(&name)),
        format!("\"value\":\"{}\"", json_escape(&value)),
    ];

    if let Some((min, max, step)) = param_ui(pair) {
        fields.push(format!(
            "\"ui\":{{\"min\":\"{}\",\"max\":\"{}\",\"step\":\"{}\"}}",
            json_escape(&min),
            json_escape(&max),
            json_escape(&step)
        ));
    }

    fields.push(span_json(pair));
    format!("{{{}}}", fields.join(","))
}

fn tensor_to_json(pair: &Pair<'_, Rule>) -> String {
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

    format!(
        "{{\"type\":\"tensor\",\"kind\":\"{}\",\"name\":\"{}\",\"expr\":\"{}\",{}}}",
        json_escape(&kind),
        json_escape(&name),
        json_escape(&expr),
        span_json(pair)
    )
}

fn object_to_json(pair: &Pair<'_, Rule>) -> String {
    let mut kind = String::new();
    let mut name = String::new();
    let mut expr = String::new();
    let mut options: Vec<(String, String)> = Vec::new();

    for child in pair.clone().into_inner() {
        match child.as_rule() {
            Rule::object_kind => kind = child.as_str().to_string(),
            Rule::ident => name = child.as_str().to_string(),
            Rule::expr => expr = child.as_str().trim().to_string(),
            Rule::object_end => {
                if let Some(inner_options) =
                    child.into_inner().find(|p| p.as_rule() == Rule::options)
                {
                    options = option_pairs(&inner_options);
                }
            }
            _ => {}
        }
    }

    format!(
        "{{\"type\":\"object\",\"kind\":\"{}\",\"name\":\"{}\",\"expr\":\"{}\",\"options\":{},{}}}",
        json_escape(&kind),
        json_escape(&name),
        json_escape(&expr),
        options_json(&options),
        span_json(pair)
    )
}

fn analysis_to_json(pair: &Pair<'_, Rule>) -> String {
    let mut op = String::new();
    let mut name = String::new();
    let mut call = String::new();
    let mut source = String::new();
    let mut at: Option<Vec<String>> = None;
    let mut options: Vec<(String, String)> = Vec::new();

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
            Rule::analysis_end => {
                if let Some(inner_options) =
                    child.into_inner().find(|p| p.as_rule() == Rule::options)
                {
                    options = option_pairs(&inner_options);
                }
            }
            _ => {}
        }
    }

    let mut fields = vec![
        "\"type\":\"analysis\"".to_string(),
        format!("\"op\":\"{}\"", json_escape(&op)),
        format!("\"name\":\"{}\"", json_escape(&name)),
        format!("\"call\":\"{}\"", json_escape(&call)),
        format!("\"source\":\"{}\"", json_escape(&source)),
    ];

    match &at {
        Some(args) => {
            let items: Vec<String> = args
                .iter()
                .map(|value| format!("\"{}\"", json_escape(value)))
                .collect();
            fields.push(format!("\"at\":[{}]", items.join(",")));
        }
        None => fields.push("\"at\":null".to_string()),
    }

    fields.push(format!("\"options\":{}", options_json(&options)));
    fields.push(span_json(pair));
    format!("{{{}}}", fields.join(","))
}

fn integral_to_json(pair: &Pair<'_, Rule>) -> String {
    let mut name = String::new();
    let mut source = String::new();
    let mut options: Vec<(String, String)> = Vec::new();

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
            Rule::integral_end => {
                if let Some(inner_options) =
                    child.into_inner().find(|p| p.as_rule() == Rule::options)
                {
                    options = option_pairs(&inner_options);
                }
            }
            _ => {}
        }
    }

    format!(
        "{{\"type\":\"integral\",\"name\":\"{}\",\"source\":\"{}\",\"options\":{},{}}}",
        json_escape(&name),
        json_escape(&source),
        options_json(&options),
        span_json(pair)
    )
}

fn statement_to_json(pair: Pair<'_, Rule>) -> String {
    match pair.as_rule() {
        Rule::param_stmt => param_to_json(&pair),
        Rule::tensor_stmt => tensor_to_json(&pair),
        Rule::object_stmt => object_to_json(&pair),
        Rule::analysis_stmt => analysis_to_json(&pair),
        Rule::integral_stmt => integral_to_json(&pair),
        _ => String::new(),
    }
}

/// 解析 `.miko` 源码，返回 JSON 格式的 AST.
pub fn parse_to_json(source: &str) -> Result<String, String> {
    let mut pairs = MikoParser::parse(Rule::program, source).map_err(|err| err.to_string())?;
    let program = pairs.next().ok_or_else(|| "空的解析结果".to_string())?;

    let nodes: Vec<String> = program
        .into_inner()
        .map(statement_to_json)
        .filter(|node| !node.is_empty())
        .collect();

    Ok(format!("{{\"statements\":[{}]}}", nodes.join(",")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_param_tensor_object_and_integral() {
        let src = r##"
// 这是单行注释
param a = 2 in [-5, 5, 0.1];
scalar k = 2.5;
vector v = [1, 2, 3];
matrix M = [[1, 0], [0, 1]];
transform T = translate([1, 2, 3]) * rotate([0, 0, pi / 4]);
curve c1 = sin(x * a) {
    color = "#6dd5ff";
    range = [-8, 8];
    segments = 256;
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
"##;
        let json = parse_to_json(src).unwrap();
        assert!(json.contains("\"type\":\"param\""));
        assert!(json.contains("\"type\":\"tensor\""));
        assert!(json.contains("\"type\":\"object\""));
        assert!(json.contains("\"type\":\"analysis\""));
        assert!(json.contains("\"type\":\"integral\""));
    }
}
