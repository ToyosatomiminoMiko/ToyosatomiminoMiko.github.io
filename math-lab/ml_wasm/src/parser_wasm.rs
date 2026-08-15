use pest::iterators::Pair;
use pest::Parser;
use pest_derive::Parser;
use serde::Serialize;

#[derive(Parser)]
#[grammar = "miko.pest"]
pub struct MikoParser;

#[derive(Serialize)]
struct SourceSpan {
    start: usize,
    end: usize,
}

#[derive(Serialize)]
struct OptionPair {
    name: String,
    value: String,
}

#[derive(Serialize)]
struct ParamUi {
    min: String,
    max: String,
    step: String,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum AstStatement {
    Param {
        name: String,
        value: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        ui: Option<ParamUi>,
        span: SourceSpan,
    },
    Tensor {
        kind: String,
        name: String,
        expr: String,
        span: SourceSpan,
    },
    Object {
        kind: String,
        name: String,
        expr: String,
        options: Vec<OptionPair>,
        span: SourceSpan,
    },
    Analysis {
        op: String,
        name: String,
        call: String,
        source: String,
        at: Option<Vec<String>>,
        options: Vec<OptionPair>,
        span: SourceSpan,
    },
    Integral {
        name: String,
        source: String,
        options: Vec<OptionPair>,
        span: SourceSpan,
    },
}

#[derive(Serialize)]
struct AstProgram {
    statements: Vec<AstStatement>,
}

fn span_of(pair: &Pair<'_, Rule>) -> SourceSpan {
    let span = pair.as_span();
    SourceSpan {
        start: span.start(),
        end: span.end(),
    }
}

fn pair_ident(pair: &Pair<'_, Rule>) -> String {
    pair.clone()
        .into_inner()
        .find(|child| child.as_rule() == Rule::ident)
        .map(|child| child.as_str().to_string())
        .unwrap_or_default()
}

fn option_pairs(pair: &Pair<'_, Rule>) -> Vec<OptionPair> {
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
            OptionPair { name, value }
        })
        .collect()
}

fn param_ui(pair: &Pair<'_, Rule>) -> Option<ParamUi> {
    pair.clone()
        .into_inner()
        .find(|child| child.as_rule() == Rule::param_ui)
        .map(|ui| {
            let nums: Vec<String> = ui
                .into_inner()
                .filter(|child| child.as_rule() == Rule::number)
                .map(|child| child.as_str().to_string())
                .collect();
            ParamUi {
                min: nums.get(0).cloned().unwrap_or_default(),
                max: nums.get(1).cloned().unwrap_or_default(),
                step: nums.get(2).cloned().unwrap_or_default(),
            }
        })
}

fn param_to_stmt(pair: &Pair<'_, Rule>) -> AstStatement {
    let name = pair_ident(pair);
    let value = pair
        .clone()
        .into_inner()
        .find(|child| child.as_rule() == Rule::param_value)
        .map(|child| child.as_str().trim().to_string())
        .unwrap_or_default();

    AstStatement::Param {
        name,
        value,
        ui: param_ui(pair),
        span: span_of(pair),
    }
}

fn tensor_to_stmt(pair: &Pair<'_, Rule>) -> AstStatement {
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

    AstStatement::Tensor {
        kind,
        name,
        expr,
        span: span_of(pair),
    }
}

fn object_to_stmt(pair: &Pair<'_, Rule>) -> AstStatement {
    let mut kind = String::new();
    let mut name = String::new();
    let mut expr = String::new();
    let mut options: Vec<OptionPair> = Vec::new();

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

    AstStatement::Object {
        kind,
        name,
        expr,
        options,
        span: span_of(pair),
    }
}

fn analysis_to_stmt(pair: &Pair<'_, Rule>) -> AstStatement {
    let mut op = String::new();
    let mut name = String::new();
    let mut call = String::new();
    let mut source = String::new();
    let mut at: Option<Vec<String>> = None;
    let mut options: Vec<OptionPair> = Vec::new();

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

    AstStatement::Analysis {
        op,
        name,
        call,
        source,
        at,
        options,
        span: span_of(pair),
    }
}

fn integral_to_stmt(pair: &Pair<'_, Rule>) -> AstStatement {
    let mut name = String::new();
    let mut source = String::new();
    let mut options: Vec<OptionPair> = Vec::new();

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

    AstStatement::Integral {
        name,
        source,
        options,
        span: span_of(pair),
    }
}

fn statement_to_ast(pair: Pair<'_, Rule>) -> Result<AstStatement, String> {
    match pair.as_rule() {
        Rule::param_stmt => Ok(param_to_stmt(&pair)),
        Rule::tensor_stmt => Ok(tensor_to_stmt(&pair)),
        Rule::object_stmt => Ok(object_to_stmt(&pair)),
        Rule::analysis_stmt => Ok(analysis_to_stmt(&pair)),
        Rule::integral_stmt => Ok(integral_to_stmt(&pair)),
        _ => Err(format!("未知语句规则: {:?}", pair.as_rule())),
    }
}

/// 解析 `.miko` 源码，返回 JSON 格式的 AST.
pub fn parse_to_json(source: &str) -> Result<String, String> {
    let mut pairs = MikoParser::parse(Rule::program, source).map_err(|err| err.to_string())?;
    let program = pairs.next().ok_or_else(|| "空的解析结果".to_string())?;

    let statements = program
        .into_inner()
        .filter(|child| child.as_rule() != Rule::EOI)
        .map(statement_to_ast)
        .collect::<Result<Vec<_>, _>>()?;

    serde_json::to_string(&AstProgram { statements }).map_err(|err| err.to_string())
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
