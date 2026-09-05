use crate::config::LEBESGUE_ZERO_EPSILON;

/// 辛普森法则节点权重,避免权重数字散落在多个函数里.
const SIMPSON_WEIGHT_EDGE: f64 = 1.0;
const SIMPSON_WEIGHT_ODD: f64 = 4.0;
const SIMPSON_WEIGHT_EVEN: f64 = 2.0;

fn validate_1d_interval(a: f64, b: f64) -> Result<(), String> {
    if !a.is_finite() || !b.is_finite() {
        return Err("一维积分区间必须为有限数值".to_string());
    }
    if a >= b {
        return Err("一维积分区间需要满足 a < b".to_string());
    }
    Ok(())
}

fn validate_2d_interval(x_range: (f64, f64), y_range: (f64, f64)) -> Result<(), String> {
    let (a, b) = x_range;
    let (c, d) = y_range;
    if !a.is_finite() || !b.is_finite() || !c.is_finite() || !d.is_finite() {
        return Err("二维积分区间必须为有限数值".to_string());
    }
    if a >= b || c >= d {
        return Err("二维积分区间需要满足 min < max".to_string());
    }
    Ok(())
}

fn require_finite_values(values: &[f64]) -> Result<(), String> {
    if values.iter().any(|value| !value.is_finite()) {
        return Err("积分输入包含非有限采样值".to_string());
    }
    Ok(())
}

/// 按值域分层计算勒贝格积分(正部/负部通用).
pub(crate) fn lebesgue_layer_sum(
    layers: usize,
    y_range: f64,
    measure_fn: &dyn Fn(f64) -> f64,
    sign: f64,
) -> Result<f64, String> {
    if layers == 0 {
        return Err("勒贝格积分 layers 必须大于 0".to_string());
    }
    if !y_range.is_finite() || y_range < 0.0 {
        return Err("勒贝格积分值域必须为非负有限数值".to_string());
    }
    if y_range == 0.0 {
        return Ok(0.0);
    }

    let dy = y_range / layers as f64;
    let mut sum = 0.0;
    for k in 0..layers {
        let threshold = k as f64 * dy;
        sum += sign * measure_fn(threshold) * dy;
    }
    Ok(sum)
}

/// 勒贝格层积分的公共骨架:正部测度 + 负部测度.
///
/// 1D/2D/region/solid 的勒贝格实现差异只在"测度怎么数"(左端点格子,
/// 区域带掩码,体元掩码),把"按值域分层 + 正/负部求和"收口到这里,
/// 各实现只需提供 `positive(t)`(测度 {z > t})与 `negative(t)`
/// (测度 {z < -t})两个测度函数.
pub(crate) fn lebesgue_layered_measure(
    layers: usize,
    z_min: f64,
    z_max: f64,
    positive: &dyn Fn(f64) -> f64,
    negative: &dyn Fn(f64) -> f64,
) -> Result<f64, String> {
    if layers == 0 {
        return Err("勒贝格积分 layers 必须大于 0".to_string());
    }
    if !z_min.is_finite() || !z_max.is_finite() {
        return Ok(0.0);
    }
    let mut sum = 0.0;
    if z_max > LEBESGUE_ZERO_EPSILON {
        sum += lebesgue_layer_sum(layers, z_max, &|t| positive(t), 1.0)?;
    }
    if z_min < -LEBESGUE_ZERO_EPSILON {
        sum += lebesgue_layer_sum(layers, -z_min, &|t| negative(t), -1.0)?;
    }
    Ok(sum)
}

/// 辛普森法则的节点权重.
pub(crate) fn simpson_weight(idx: usize, total: usize) -> f64 {
    if idx == 0 || idx == total {
        SIMPSON_WEIGHT_EDGE
    } else if idx % 2 == 1 {
        SIMPSON_WEIGHT_ODD
    } else {
        SIMPSON_WEIGHT_EVEN
    }
}

// ================================================================
// 基于预计算值数组的一维积分函数
// ================================================================

pub fn trapz1d_from_values(values: &[f64], a: f64, b: f64) -> Result<f64, String> {
    validate_1d_interval(a, b)?;
    if values.len() < 2 {
        return Err("梯形法至少需要 2 个采样值".to_string());
    }
    require_finite_values(values)?;

    let n = values.len() - 1;
    let h = (b - a) / n as f64;
    let mut sum = values[0] + values[n];
    for value in &values[1..n] {
        sum += 2.0 * value;
    }
    Ok((h / 2.0) * sum)
}

pub fn simpson1d_from_values(values: &[f64], a: f64, b: f64) -> Result<f64, String> {
    validate_1d_interval(a, b)?;
    if values.len() < 2 {
        return Err("辛普森法至少需要 2 个采样值".to_string());
    }
    require_finite_values(values)?;

    let n = values.len() - 1;
    if !n.is_multiple_of(2) {
        return Err("辛普森法要求 N 必须为偶数".to_string());
    }

    let h = (b - a) / n as f64;
    let mut sum = values[0] + values[n];
    for (i, value) in values.iter().enumerate().take(n).skip(1) {
        sum += simpson_weight(i, n) * value;
    }
    Ok((h / 3.0) * sum)
}

pub fn riemann1d_left_from_values(values: &[f64], a: f64, b: f64) -> Result<f64, String> {
    validate_1d_interval(a, b)?;
    if values.len() < 2 {
        return Err("左黎曼法至少需要 2 个采样值".to_string());
    }
    require_finite_values(values)?;

    let n = values.len() - 1;
    let h = (b - a) / n as f64;
    let sum: f64 = values[..n].iter().sum();
    Ok(sum * h)
}

pub fn riemann1d_right_from_values(values: &[f64], a: f64, b: f64) -> Result<f64, String> {
    validate_1d_interval(a, b)?;
    if values.len() < 2 {
        return Err("右黎曼法至少需要 2 个采样值".to_string());
    }
    require_finite_values(values)?;

    let n = values.len() - 1;
    let h = (b - a) / n as f64;
    let sum: f64 = values[1..].iter().sum();
    Ok(sum * h)
}

pub fn riemann1d_mid_from_values(values: &[f64], a: f64, b: f64) -> Result<f64, String> {
    validate_1d_interval(a, b)?;
    if values.is_empty() {
        return Err("中点黎曼法至少需要 1 个采样值".to_string());
    }
    require_finite_values(values)?;

    let n = values.len();
    let h = (b - a) / n as f64;
    let sum: f64 = values.iter().sum();
    Ok(sum * h)
}

// ================================================================
// 基于预计算值数组的二维积分函数
// ================================================================

pub fn trapz2d_from_values(
    values: &[f64],
    x_range: (f64, f64),
    y_range: (f64, f64),
    n: usize,
    m: usize,
) -> Result<f64, String> {
    validate_2d_interval(x_range, y_range)?;
    if n == 0 || m == 0 {
        return Err("二维梯形法要求 n 和 m 均大于 0".to_string());
    }
    let expected = (n + 1) * (m + 1);
    if values.len() != expected {
        return Err(format!(
            "二维梯形法输入长度错误: 期望 {expected},实际 {}",
            values.len()
        ));
    }
    require_finite_values(values)?;

    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx = (b - a) / n as f64;
    let hy = (d - c) / m as f64;
    let mut sum = 0.0;

    for j in 0..=m {
        let wy = if j == 0 || j == m { 1.0 } else { 2.0 };
        for i in 0..=n {
            let wx = if i == 0 || i == n { 1.0 } else { 2.0 };
            sum += wx * wy * values[j * (n + 1) + i];
        }
    }

    Ok((hx * hy / 4.0) * sum)
}

pub fn simpson2d_from_values(
    values: &[f64],
    x_range: (f64, f64),
    y_range: (f64, f64),
    n: usize,
    m: usize,
) -> Result<f64, String> {
    validate_2d_interval(x_range, y_range)?;
    if n == 0 || m == 0 {
        return Err("二维辛普森法要求 n 和 m 均大于 0".to_string());
    }
    if !n.is_multiple_of(2) || !m.is_multiple_of(2) {
        return Err("二维辛普森法要求 N 和 M 必须为偶数".to_string());
    }
    let expected = (n + 1) * (m + 1);
    if values.len() != expected {
        return Err(format!(
            "二维辛普森法输入长度错误: 期望 {expected},实际 {}",
            values.len()
        ));
    }
    require_finite_values(values)?;

    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx = (b - a) / n as f64;
    let hy = (d - c) / m as f64;
    let mut sum = 0.0;

    for j in 0..=m {
        let wy = simpson_weight(j, m);
        for i in 0..=n {
            let wx = simpson_weight(i, n);
            sum += wx * wy * values[j * (n + 1) + i];
        }
    }

    Ok((hx * hy / 9.0) * sum)
}

/// 二维端点黎曼(左/右/中点)共享实现:输入是 n×m 个"单元采样端"值,
/// 数值 = Σ 值 · hx · hy.左/右/中只差采样端的取法(采样在 sampling_core),
/// 求和公式完全一致,因此这里收敛成一个带方法名的私有实现.
fn riemann2d_endpoint_from_values(
    values: &[f64],
    x_range: (f64, f64),
    y_range: (f64, f64),
    n: usize,
    m: usize,
    label: &str,
) -> Result<f64, String> {
    validate_2d_interval(x_range, y_range)?;
    if n == 0 || m == 0 {
        return Err(format!("二维{label}黎曼法要求 n 和 m 均大于 0"));
    }
    let expected = n * m;
    if values.len() != expected {
        return Err(format!(
            "二维{label}黎曼法输入长度错误: 期望 {expected},实际 {}",
            values.len()
        ));
    }
    require_finite_values(values)?;

    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx = (b - a) / n as f64;
    let hy = (d - c) / m as f64;
    let sum: f64 = values.iter().sum();
    Ok(sum * hx * hy)
}

pub fn riemann2d_left_from_values(
    values: &[f64],
    x_range: (f64, f64),
    y_range: (f64, f64),
    n: usize,
    m: usize,
) -> Result<f64, String> {
    riemann2d_endpoint_from_values(values, x_range, y_range, n, m, "左")
}

pub fn riemann2d_right_from_values(
    values: &[f64],
    x_range: (f64, f64),
    y_range: (f64, f64),
    n: usize,
    m: usize,
) -> Result<f64, String> {
    riemann2d_endpoint_from_values(values, x_range, y_range, n, m, "右")
}

pub fn riemann2d_mid_from_values(
    values: &[f64],
    x_range: (f64, f64),
    y_range: (f64, f64),
    n: usize,
    m: usize,
) -> Result<f64, String> {
    riemann2d_endpoint_from_values(values, x_range, y_range, n, m, "中点")
}

// ================================================================
// 勒贝格积分(基于值数组,扫描在 Rust 内完成,零 FFI 回调)
// ================================================================

pub fn lebesgue1d_from_values(
    values: &[f64],
    a: f64,
    b: f64,
    layers: usize,
) -> Result<f64, String> {
    validate_1d_interval(a, b)?;
    if layers == 0 {
        return Err("勒贝格积分 layers 必须大于 0".to_string());
    }
    if values.len() < 2 {
        return Err("勒贝格积分至少需要 2 个采样值".to_string());
    }

    let n = values.len() - 1;
    let h = (b - a) / n as f64;

    let mut y_min = f64::INFINITY;
    let mut y_max = f64::NEG_INFINITY;
    for &y in values {
        if y.is_finite() {
            y_min = y_min.min(y);
            y_max = y_max.max(y);
        }
    }
    if !y_min.is_finite() || !y_max.is_finite() {
        return Ok(0.0);
    }

    // 一维测度采用与 2D 相同的"左端点代表格子"约定:
    // 每个满足条件的左端点样本贡献一段 h,右端点样本不单独贡献.
    // 旧实现按"连续满足的区间"每段只计一个 h,会把常数函数积分低估 n 倍.
    let scan_measure = |predicate: &dyn Fn(f64) -> bool| -> f64 {
        let mut total = 0.0;
        for &y in &values[..n] {
            if y.is_finite() && predicate(y) {
                total += h;
            }
        }
        total
    };

    lebesgue_layered_measure(layers, y_min, y_max, &|t| scan_measure(&|y| y > t), &|t| {
        scan_measure(&|y| y < -t)
    })
}

pub fn lebesgue2d_from_values(
    values: &[f64],
    x_range: (f64, f64),
    y_range: (f64, f64),
    grid_size: usize,
    layers: usize,
) -> Result<f64, String> {
    validate_2d_interval(x_range, y_range)?;
    if grid_size == 0 {
        return Err("勒贝格积分 grid_size 必须大于 0".to_string());
    }
    if layers == 0 {
        return Err("勒贝格积分 layers 必须大于 0".to_string());
    }

    // values 是 (grid_size + 1) × (grid_size + 1) 的网格点值,行主序.
    let expected = (grid_size + 1) * (grid_size + 1);
    if values.len() != expected {
        return Err(format!(
            "二维勒贝格输入长度错误: 期望 {expected},实际 {}",
            values.len()
        ));
    }

    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx = (b - a) / grid_size as f64;
    let hy = (d - c) / grid_size as f64;
    let area = hx * hy;

    let mut z_min = f64::INFINITY;
    let mut z_max = f64::NEG_INFINITY;
    for &z in values {
        if z.is_finite() {
            z_min = z_min.min(z);
            z_max = z_max.max(z);
        }
    }
    if !z_min.is_finite() || !z_max.is_finite() {
        return Ok(0.0);
    }

    // 以左下角点代表整个格子(与 1D 左端点法一致).
    let measure_fn = |predicate: &dyn Fn(f64) -> bool| -> f64 {
        let mut measure = 0.0;
        for j in 0..grid_size {
            for i in 0..grid_size {
                let z = values[j * (grid_size + 1) + i];
                if z.is_finite() && predicate(z) {
                    measure += area;
                }
            }
        }
        measure
    };

    lebesgue_layered_measure(layers, z_min, z_max, &|t| measure_fn(&|z| z > t), &|t| {
        measure_fn(&|z| z < -t)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trapezoid_integrates_linear_function() {
        let values = vec![0.0, 1.0, 2.0, 3.0];
        let value = trapz1d_from_values(&values, 0.0, 3.0).unwrap();

        assert!((value - 4.5).abs() < 1e-12);
    }

    #[test]
    fn riemann_left_right_mid_use_matching_endpoints() {
        // f(x)=x 在 [0,1] 上按 n=4 均匀采样:
        // 左端点 0.375,右端点 0.625,中点 0.5.
        let grid = vec![0.0, 0.25, 0.5, 0.75, 1.0];
        let mid = vec![0.125, 0.375, 0.625, 0.875];

        let left = riemann1d_left_from_values(&grid, 0.0, 1.0).unwrap();
        let right = riemann1d_right_from_values(&grid, 0.0, 1.0).unwrap();
        let middle = riemann1d_mid_from_values(&mid, 0.0, 1.0).unwrap();

        assert!((left - 0.375).abs() < 1e-12);
        assert!((right - 0.625).abs() < 1e-12);
        assert!((middle - 0.5).abs() < 1e-12);
    }

    #[test]
    fn empty_1d_values_return_error() {
        assert!(trapz1d_from_values(&[], 0.0, 1.0).is_err());
        assert!(lebesgue1d_from_values(&[], 0.0, 1.0, 8).is_err());
    }

    #[test]
    fn wrong_2d_length_returns_error_instead_of_panicking() {
        let values = vec![0.0; 3];
        assert!(trapz2d_from_values(&values, (0.0, 1.0), (0.0, 1.0), 1, 1).is_err());
    }

    #[test]
    fn lebesgue_rejects_zero_layers() {
        let values = vec![0.0, 1.0, 2.0];
        assert!(lebesgue1d_from_values(&values, 0.0, 2.0, 0).is_err());
    }

    #[test]
    fn lebesgue1d_of_constant_one_equals_interval_length() {
        // 回归:旧实现每个连续满足区间只计一个 h,常数函数被低估约 n 倍.
        let values = vec![1.0; 641];
        let value = lebesgue1d_from_values(&values, 0.0, 1.0, 16).unwrap();

        assert!((value - 1.0).abs() < 1e-9);
    }

    #[test]
    fn lebesgue1d_of_linear_function_approximates_half() {
        // f(x)=x 在 [0,1] 上,测度 {x: f(x) > t} 应约为 1-t;
        // 用左端点格子法近似,常数项允许端点采样带来的小误差.
        let n = 800usize;
        let values: Vec<f64> = (0..=n).map(|i| i as f64 / n as f64).collect();
        let value = lebesgue1d_from_values(&values, 0.0, 1.0, 64).unwrap();

        assert!((value - 0.5).abs() < 1e-2);
    }
}
