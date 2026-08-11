/// 按值域分层计算勒贝格积分(正部/负部通用)
pub(crate) fn lebesgue_layer_sum(
    layers: usize,
    y_range: f64,
    measure_fn: &dyn Fn(f64) -> f64,
    sign: f64,
) -> f64 {
    let dy: f64 = y_range / layers as f64;
    let mut sum = 0.0;
    for k in 0..layers {
        let threshold = k as f64 * dy;
        sum += sign * measure_fn(threshold) * dy;
    }
    sum
}

/// 辛普森法则的节点权重
pub(crate) fn simpson_weight(idx: usize, total: usize) -> f64 {
    if idx == 0 || idx == total {
        1.0
    } else if idx % 2 == 1 {
        4.0
    } else {
        2.0
    }
}

// ================================================================
// 基于预计算值数组的积分函数(零 FFI 回调)
// ================================================================

// 一维

pub fn trapz1d_from_values(values: &[f64], a: f64, b: f64) -> f64 {
    let n: usize = values.len() - 1;
    if n == 0 {
        return 0.0;
    }
    let h: f64 = (b - a) / n as f64;
    let mut sum: f64 = values[0] + values[n];
    for v in &values[1..n] {
        sum += 2.0 * v;
    }
    (h / 2.0) * sum
}

pub fn simpson1d_from_values(values: &[f64], a: f64, b: f64) -> Result<f64, String> {
    let n: usize = values.len() - 1;
    if n % 2 != 0 {
        return Err("辛普森法要求 N 必须为偶数!".to_string());
    }
    if n == 0 {
        return Ok(0.0);
    }
    let h: f64 = (b - a) / n as f64;
    let mut sum = values[0] + values[n];
    for i in 1..n {
        sum += simpson_weight(i, n) * values[i];
    }
    Ok((h / 3.0) * sum)
}

pub fn riemann1d_left_from_values(values: &[f64], a: f64, b: f64) -> f64 {
    let n: usize = values.len() - 1;
    if n == 0 {
        return 0.0;
    }
    let h = (b - a) / n as f64;
    let sum: f64 = values[..n].iter().sum();
    sum * h
}

pub fn riemann1d_right_from_values(values: &[f64], a: f64, b: f64) -> f64 {
    let n: usize = values.len() - 1;
    if n == 0 {
        return 0.0;
    }
    let h: f64 = (b - a) / n as f64;
    let sum: f64 = values[1..].iter().sum();
    sum * h
}

pub fn riemann1d_mid_from_values(values: &[f64], a: f64, b: f64) -> f64 {
    let n: usize = values.len();
    if n == 0 {
        return 0.0;
    }
    let h: f64 = (b - a) / n as f64;
    let sum: f64 = values.iter().sum();
    sum * h
}

// 二维

pub fn trapz2d_from_values(
    values: &[f64],
    x_range: (f64, f64),
    y_range: (f64, f64),
    n: usize,
    m: usize,
) -> f64 {
    assert_eq!(values.len(), (n + 1) * (m + 1));
    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx: f64 = (b - a) / n as f64;
    let hy: f64 = (d - c) / m as f64;
    let mut sum: f64 = 0.0;
    for j in 0..=m {
        let wy: f64 = if j == 0 || j == m { 1.0 } else { 2.0 };
        for i in 0..=n {
            let wx: f64 = if i == 0 || i == n { 1.0 } else { 2.0 };
            sum += wx * wy * values[j * (n + 1) + i];
        }
    }
    (hx * hy / 4.0) * sum
}

pub fn simpson2d_from_values(
    values: &[f64],
    x_range: (f64, f64),
    y_range: (f64, f64),
    n: usize,
    m: usize,
) -> Result<f64, String> {
    if n % 2 != 0 || m % 2 != 0 {
        return Err("辛普森法要求 N 和 M 必须为偶数!".to_string());
    }
    assert_eq!(values.len(), (n + 1) * (m + 1));
    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx: f64 = (b - a) / n as f64;
    let hy: f64 = (d - c) / m as f64;
    let mut sum = 0.0;
    for j in 0..=m {
        let wy = simpson_weight(j, m);
        for i in 0..=n {
            let wx: f64 = simpson_weight(i, n);
            sum += wx * wy * values[j * (n + 1) + i];
        }
    }
    Ok((hx * hy / 9.0) * sum)
}

pub fn riemann2d_left_from_values(
    values: &[f64],
    x_range: (f64, f64),
    y_range: (f64, f64),
    n: usize,
    m: usize,
) -> f64 {
    assert_eq!(values.len(), n * m);
    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx: f64 = (b - a) / n as f64;
    let hy: f64 = (d - c) / m as f64;
    let sum: f64 = values.iter().sum();
    sum * hx * hy
}

// 勒贝格(基于值数组,扫描在 Rust 内完成,零 FFI)

pub fn lebesgue1d_from_values(values: &[f64], a: f64, b: f64, layers: usize) -> f64 {
    let n: usize = values.len() - 1;
    if n == 0 {
        return 0.0;
    }
    let h: f64 = (b - a) / n as f64;

    let mut y_min: f64 = f64::INFINITY;
    let mut y_max: f64 = f64::NEG_INFINITY;
    for &y in values {
        if y.is_finite() {
            y_min = y_min.min(y);
            y_max = y_max.max(y);
        }
    }
    if !y_min.is_finite() || !y_max.is_finite() {
        return 0.0;
    }

    // 扫描连续满足条件的区间,累计区间总长度
    let scan_measure = |predicate: &dyn Fn(f64) -> bool| -> f64 {
        let mut total: f64 = 0.0;
        let mut in_interval: bool = false;
        for i in 0..values.len() {
            let y = values[i];
            let meets: bool = y.is_finite() && predicate(y);
            if meets && !in_interval {
                in_interval = true;
            } else if !meets && in_interval {
                total += h;
                in_interval = false;
            }
        }
        if in_interval {
            total += h;
        }
        total
    };

    let mut sum: f64 = 0.0;

    if y_max > 1e-12 {
        sum += lebesgue_layer_sum(layers, y_max, &|t| scan_measure(&|y| y > t), 1.0);
    }
    if y_min < -1e-12 {
        sum += lebesgue_layer_sum(layers, -y_min, &|t| scan_measure(&|y| y < -t), -1.0);
    }
    sum
}

pub fn lebesgue2d_from_values(
    values: &[f64],
    x_range: (f64, f64),
    y_range: (f64, f64),
    grid_size: usize,
    layers: usize,
) -> f64 {
    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx: f64 = (b - a) / grid_size as f64;
    let hy: f64 = (d - c) / grid_size as f64;
    let area = hx * hy;
    // values 是 (grid_size+1) × (grid_size+1) 的网格点值,行主序

    let mut z_min: f64 = f64::INFINITY;
    let mut z_max: f64 = f64::NEG_INFINITY;
    for &z in values {
        if z.is_finite() {
            z_min = z_min.min(z);
            z_max = z_max.max(z);
        }
    }
    if !z_min.is_finite() || !z_max.is_finite() {
        return 0.0;
    }

    // 以左下角点代表整个格子(与 1D 左端点法一致)
    let measure_fn = |predicate: &dyn Fn(f64) -> bool| -> f64 {
        let mut m: f64 = 0.0;
        for j in 0..grid_size {
            for i in 0..grid_size {
                let z = values[j * (grid_size + 1) + i];
                if z.is_finite() && predicate(z) {
                    m += area;
                }
            }
        }
        m
    };

    let mut sum: f64 = 0.0;

    if z_max > 1e-12 {
        sum += lebesgue_layer_sum(layers, z_max, &|t| measure_fn(&|z| z > t), 1.0);
    }
    if z_min < -1e-12 {
        sum += lebesgue_layer_sum(layers, -z_min, &|t| measure_fn(&|z| z < -t), -1.0);
    }
    sum
}
