//! 采样层:曲线/曲面/向量场的网格求值,以及积分域的采样形状.
//!
//! 行为契约:
//! - 采样是"求值层",不做掩码决策:非有限值一律写成 `NaN` 占位(曲面/网格),
//!   或按调用方约定跳过(曲线,返回变长数组).积分消费核把 NaN 解释为
//!   "该点不贡献测度"(掩码语义,见 integral_core 头契约),渲染层把它当
//!   "无数据格"--两种消费方共用同一份 NaN 占位;
//! - 布局:二维/三维数组一律行主序(外层 y / 外层 z 中层 y,内层 x);
//!   含端点整格 (n+1)(m+1) 与单元端 n×m 两种形态见 SampleShape,
//!   由 integral_method::sample_shape_* 决定,采样侧不自行发明形状;
//! - 坐标都是世界坐标,系数名与坐标名冲突防护在 eval_core::build_base_context
//!   (1D 允许 y/z 作系数,2D 允许 z,因为对应维度不会覆写它们);
//! - 规模护栏:每个入口先过 config 的上限(MAX_GRID_N / MAX_CURVE_SAMPLES /
//!   MAX_VECTOR_FIELD_POINTS),在分配前报错.
//!
//! 编码注意:单元端点坐标用 integral_method::cell_end_at;线性插值用
//! uniform_nodes,不要在文件里手写第三句 `lo + (hi-lo)*i/n`.

use crate::config::{MAX_CURVE_SAMPLES, MAX_GRID_N, MAX_VECTOR_FIELD_POINTS};
use crate::eval_core::CompiledEvaluator;
use crate::integral_core::{validate_1d_interval, validate_2d_interval};
use crate::integral_method::SampleShape;

/// 均匀网格节点:`lo + (hi-lo)·(i/steps)`,i = 0..=steps(含两端).
///
/// 曲线/求交/求根的"世界坐标采样"都该走这里,别再各自手写同一句线性插值.
pub(crate) fn uniform_nodes(lo: f64, hi: f64, steps: usize) -> impl Iterator<Item = f64> {
    (0..=steps).map(move |i| lo + (hi - lo) * (i as f64 / steps as f64))
}

/// 采样一元函数 y = f(x).
///
/// 返回扁平数组 `[x0, y0, 0, x1, y1, 0, ...]`,
/// 非有限值会跳过,因此返回长度可能小于 `(steps + 1) * 3`.
pub fn sample_curve(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    x_min: f64,
    x_max: f64,
    steps: usize,
) -> Result<Vec<f32>, String> {
    validate_1d_interval(x_min, x_max)?;
    if steps == 0 {
        return Err("曲线采样需要 steps > 0".to_string());
    }
    if steps > MAX_CURVE_SAMPLES {
        return Err(format!("曲线采样 steps 超过上限 {MAX_CURVE_SAMPLES}"));
    }

    let mut evaluator: CompiledEvaluator = CompiledEvaluator::new(expr, coeff_names, coeff_values)?;

    let mut points: Vec<f32> = Vec::with_capacity((steps + 1) * 3);
    for x in uniform_nodes(x_min, x_max, steps) {
        if let Some(y) = evaluator.eval_1d(x)? {
            points.push(x as f32);
            points.push(y as f32);
            points.push(0.0);
        }
    }

    Ok(points)
}

/// 行优先遍历二维网格并逐点求值(外层 y,内层 x).
///
/// `include_end` 为 `true` 时包含右/上边界,共 `(nx + 1) * (ny + 1)` 个点;
/// 为 `false` 时只取前 `nx * ny` 个格点(黎曼左端点等"恰好 n×m 个采样点"
/// 的形态).两种形态共用同一条遍历/求值循环,避免同一段"外 y 内 x +
/// 非有限填 NaN"逻辑被复制多份.
#[allow(clippy::too_many_arguments)]
fn sample_surface_grid(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    nx: usize,
    ny: usize,
    include_end: bool,
    count_error: &str,
) -> Result<Vec<f64>, String> {
    validate_2d_interval((xa, xb), (ya, yb))?;
    if nx == 0 || ny == 0 {
        return Err(count_error.to_string());
    }
    if nx > MAX_GRID_N || ny > MAX_GRID_N {
        return Err(format!("采样网格每轴步数超过上限 {MAX_GRID_N}"));
    }

    let mut evaluator: CompiledEvaluator = CompiledEvaluator::new(expr, coeff_names, coeff_values)?;

    let cols = if include_end { nx + 1 } else { nx };
    let rows = if include_end { ny + 1 } else { ny };
    let mut values: Vec<f64> = Vec::with_capacity(cols * rows);
    for j in 0..rows {
        let y = ya + (yb - ya) * (j as f64 / ny as f64);
        for i in 0..cols {
            let x = xa + (xb - xa) * (i as f64 / nx as f64);
            values.push(evaluator.eval_2d(x, y)?.unwrap_or(f64::NAN));
        }
    }
    Ok(values)
}

/// 在二维网格上采样曲面 z = f(x, y).
///
/// 返回行优先数组 `[f(x0,y0), f(x1,y0), ..., f(xn,ym)]`,长度为
/// `(nx + 1) * (ny + 1)`;非有限值会写成 `NaN`,由调用方决定跳过还是报错.
/// 求交功能需要把两个曲面/一个曲面的隐式差放到同一张网格上做等值线追踪,
/// 因此这里提供批量采样,避免每个网格点重复编译表达式.
#[allow(clippy::too_many_arguments)]
pub fn sample_surface_values(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    nx: usize,
    ny: usize,
) -> Result<Vec<f64>, String> {
    sample_surface_grid(
        expr,
        coeff_names,
        coeff_values,
        xa,
        xb,
        ya,
        yb,
        nx,
        ny,
        true,
        "曲面采样需要 nx/ny 均大于 0",
    )
}

/// 采样"每个网格单元的采样端"上的函数值(黎曼端点法的 2D 推广).
///
/// 返回 n×m 行优先数组(外层 y,内层 x);`fx/fy` 是采样端在单元内的
/// 位置(单元边长 = 1):左端 (0,0),右端 (1,1),中点 (0.5,0.5).
/// 非有限值写为 NaN.
#[allow(clippy::too_many_arguments)]
fn sample_cell_ends(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    nx: usize,
    ny: usize,
    fx: f64,
    fy: f64,
) -> Result<Vec<f64>, String> {
    validate_2d_interval((xa, xb), (ya, yb))?;
    if nx == 0 || ny == 0 {
        return Err("积分采样需要 n 和 m 均大于 0".to_string());
    }
    if nx > MAX_GRID_N || ny > MAX_GRID_N {
        return Err(format!("采样网格每轴步数超过上限 {MAX_GRID_N}"));
    }
    let mut evaluator: CompiledEvaluator = CompiledEvaluator::new(expr, coeff_names, coeff_values)?;
    let hx = (xb - xa) / nx as f64;
    let hy = (yb - ya) / ny as f64;
    let mut values = Vec::with_capacity(nx * ny);
    for j in 0..ny {
        let y = ya + (j as f64 + fy) * hy;
        for i in 0..nx {
            let x = xa + (i as f64 + fx) * hx;
            values.push(evaluator.eval_2d(x, y)?.unwrap_or(f64::NAN));
        }
    }
    Ok(values)
}

/// 在三维网格上采样向量场 F(x, y, z) = [P, Q, R].
///
/// 返回扁平数组 `[vx, vy, vz, vx, vy, vz, ...]`,长度为 `nx * ny * nz * 3`.
/// 单个分量非有限值时按 0 处理,便于渲染层隐藏零向量箭头.
#[allow(clippy::too_many_arguments)]
pub fn sample_vector_field(
    p_expr: &str,
    q_expr: &str,
    r_expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    z_min: f64,
    z_max: f64,
    nx: usize,
    ny: usize,
    nz: usize,
) -> Result<Vec<f32>, String> {
    validate_1d_interval(x_min, x_max)?;
    validate_1d_interval(y_min, y_max)?;
    validate_1d_interval(z_min, z_max)?;
    if nx == 0 || ny == 0 || nz == 0 {
        return Err("向量场采样需要 nx/ny/nz 均大于 0".to_string());
    }
    if nx > MAX_GRID_N || ny > MAX_GRID_N || nz > MAX_GRID_N {
        return Err(format!("向量场采样每轴格数超过上限 {MAX_GRID_N}"));
    }
    let total_points = nx as u64 * ny as u64 * nz as u64;
    if total_points > MAX_VECTOR_FIELD_POINTS as u64 {
        return Err(format!(
            "向量场采样总点数 {total_points} 超过上限 {MAX_VECTOR_FIELD_POINTS}"
        ));
    }

    let mut p_evaluator: CompiledEvaluator =
        CompiledEvaluator::new(p_expr, coeff_names, coeff_values)?;
    let mut q_evaluator: CompiledEvaluator =
        CompiledEvaluator::new(q_expr, coeff_names, coeff_values)?;
    let mut r_evaluator: CompiledEvaluator =
        CompiledEvaluator::new(r_expr, coeff_names, coeff_values)?;

    let step_x = if nx > 1 {
        (x_max - x_min) / (nx - 1) as f64
    } else {
        0.0
    };
    let step_y = if ny > 1 {
        (y_max - y_min) / (ny - 1) as f64
    } else {
        0.0
    };
    let step_z = if nz > 1 {
        (z_max - z_min) / (nz - 1) as f64
    } else {
        0.0
    };

    let mut vectors = Vec::with_capacity(nx * ny * nz * 3);
    for iz in 0..nz {
        let z = z_min + iz as f64 * step_z;

        for iy in 0..ny {
            let y = y_min + iy as f64 * step_y;

            for ix in 0..nx {
                let x = x_min + ix as f64 * step_x;

                let vx = p_evaluator.eval_at(x, y, z)?.unwrap_or(0.0);
                let vy = q_evaluator.eval_at(x, y, z)?.unwrap_or(0.0);
                let vz = r_evaluator.eval_at(x, y, z)?.unwrap_or(0.0);

                vectors.push(vx as f32);
                vectors.push(vy as f32);
                vectors.push(vz as f32);
            }
        }
    }

    Ok(vectors)
}

pub fn sample_function_1d(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    a: f64,
    b: f64,
    n: usize,
    sample_shape: SampleShape,
) -> Result<Vec<f64>, String> {
    validate_1d_interval(a, b)?;
    if n == 0 {
        return Err("积分采样需要 n > 0".to_string());
    }
    if n > MAX_GRID_N {
        return Err(format!("积分采样 n 超过上限 {MAX_GRID_N}"));
    }

    let mut evaluator = CompiledEvaluator::new(expr, coeff_names, coeff_values)?;

    match sample_shape {
        SampleShape::MidCell => {
            let h = (b - a) / n as f64;
            let mut values = Vec::with_capacity(n);
            for i in 0..n {
                let x = a + (i as f64 + 0.5) * h;
                values.push(evaluator.eval_1d(x)?.unwrap_or(f64::NAN));
            }
            Ok(values)
        }
        // 1D 的梯形/辛普森/黎曼端点/勒贝格统一取含端点整格 n+1 个点,
        // 由 from-values 核按方法消费(左端点/右端点/全部/分层).
        SampleShape::Grid => {
            let mut values = Vec::with_capacity(n + 1);
            for i in 0..=n {
                let x = a + (b - a) * (i as f64 / n as f64);
                values.push(evaluator.eval_1d(x)?.unwrap_or(f64::NAN));
            }
            Ok(values)
        }
        SampleShape::LeftCell | SampleShape::RightCell => {
            Err("左/右单元端采样是二维端点黎曼形态,一维由整格采样 + 核取端点实现".to_string())
        }
    }
}

/// 2D 矩形域采样核心.参数保持扁平是为了与 domain_integral/核函数的
/// 分组保持一致;wasm 边界的多参问题已由 lib.rs 的 JSON 请求结构
/// (`wasm_payloads`)收口,这里不需要请求结构体.
#[allow(clippy::too_many_arguments)]
pub fn sample_function_2d(
    expr: &str,
    coeff_names: &[String],
    coeff_values: &[f64],
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    n: usize,
    m: usize,
    sample_shape: SampleShape,
) -> Result<Vec<f64>, String> {
    match sample_shape {
        // 单元端采样:每个网格单元取"采样端 = 方法端"的单个采样点.
        // 左端复用 sample_surface_grid 的左端点形态,右/中走 sample_cell_ends,
        // 三者在数值与可视化上同源.
        SampleShape::LeftCell => sample_surface_grid(
            expr,
            coeff_names,
            coeff_values,
            xa,
            xb,
            ya,
            yb,
            n,
            m,
            false,
            "积分采样需要 n 和 m 均大于 0",
        ),
        SampleShape::RightCell => sample_cell_ends(
            expr,
            coeff_names,
            coeff_values,
            xa,
            xb,
            ya,
            yb,
            n,
            m,
            1.0,
            1.0,
        ),
        SampleShape::MidCell => sample_cell_ends(
            expr,
            coeff_names,
            coeff_values,
            xa,
            xb,
            ya,
            yb,
            n,
            m,
            0.5,
            0.5,
        ),
        SampleShape::Grid => {
            sample_surface_values(expr, coeff_names, coeff_values, xa, xb, ya, yb, n, m)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curve_samples_known_linear_function() {
        let points = sample_curve("2 * x + 1", &[], &[], 0.0, 4.0, 4).unwrap();

        assert_eq!(points.len(), 15);
        assert_eq!(points[0], 0.0);
        assert_eq!(points[1], 1.0);
        assert_eq!(points[12], 4.0);
        assert_eq!(points[13], 9.0);
    }

    #[test]
    fn curve_keeps_coefficients_named_like_other_axes() {
        // y/z 在这里是系数而不是采样坐标;一元采样不能覆盖它们.
        let names: Vec<String> = vec!["y".to_string(), "z".to_string()];
        let values: Vec<f64> = vec![2.0, 3.0];
        let points: Vec<f32> = sample_curve("y * x + z", &names, &values, 0.0, 1.0, 1).unwrap();

        assert_eq!(points[1], 3.0);
        assert_eq!(points[4], 5.0);
    }

    #[test]
    fn vector_field_uses_zero_for_nonfinite_values() {
        let vectors = sample_vector_field(
            "x",
            "y",
            "z",
            &[],
            &[],
            -1.0,
            1.0,
            -1.0,
            1.0,
            -1.0,
            1.0,
            2,
            2,
            2,
        )
        .unwrap();

        assert_eq!(vectors.len(), 24);
        assert_eq!(vectors[0], -1.0);
        assert_eq!(vectors[1], -1.0);
        assert_eq!(vectors[2], -1.0);
    }

    #[test]
    fn surface_values_sample_row_major_grid() {
        let values = sample_surface_values("x + y", &[], &[], 0.0, 2.0, 0.0, 1.0, 2, 1).unwrap();

        assert_eq!(values.len(), 6);
        assert_eq!(values[0], 0.0); // (0, 0)
        assert_eq!(values[1], 1.0); // (1, 0)
        assert_eq!(values[2], 2.0); // (2, 0)
        assert_eq!(values[3], 1.0); // (0, 1)
        assert_eq!(values[4], 2.0); // (1, 1)
        assert_eq!(values[5], 3.0); // (2, 1)
    }
}
