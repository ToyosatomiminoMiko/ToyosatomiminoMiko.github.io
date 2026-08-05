/// 按值域分层计算勒贝格积分（正部/负部通用）
pub(crate) fn lebesgue_layer_sum(
    layers: usize,
    y_range: f64,
    measure_fn: &dyn Fn(f64) -> f64,
    sign: f64,
) -> f64 {
    let dy = y_range / layers as f64;
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
// 一维数值积分（高精度）
// ================================================================

pub fn trapz1d<F: Fn(f64) -> f64>(f: F, a: f64, b: f64, n: usize) -> f64 {
    let h = (b - a) / n as f64;
    let mut sum = 0.0;
    for i in 0..=n {
        let x = a + i as f64 * h;
        let w = if i == 0 || i == n { 1.0 } else { 2.0 };
        sum += w * f(x);
    }
    (h / 2.0) * sum
}

pub fn simpson1d<F: Fn(f64) -> f64>(f: F, a: f64, b: f64, n: usize) -> f64 {
    assert!(n % 2 == 0, "辛普森法要求 N 必须为偶数!");
    let h = (b - a) / n as f64;
    let mut sum = 0.0;
    for i in 0..=n {
        let x = a + i as f64 * h;
        let w = simpson_weight(i, n);
        sum += w * f(x);
    }
    (h / 3.0) * sum
}

// ================================================================
// 二维数值积分（高精度）
// ================================================================

pub fn trapz2d<F: Fn(f64, f64) -> f64>(
    f: F,
    x_range: (f64, f64),
    y_range: (f64, f64),
    n: usize,
    m: usize,
) -> f64 {
    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx = (b - a) / n as f64;
    let hy = (d - c) / m as f64;
    let mut sum = 0.0;
    for j in 0..=m {
        let y = c + j as f64 * hy;
        let wy = if j == 0 || j == m { 1.0 } else { 2.0 };
        for i in 0..=n {
            let x = a + i as f64 * hx;
            let wx = if i == 0 || i == n { 1.0 } else { 2.0 };
            sum += wx * wy * f(x, y);
        }
    }
    (hx * hy / 4.0) * sum
}

pub fn simpson2d<F: Fn(f64, f64) -> f64>(
    f: F,
    x_range: (f64, f64),
    y_range: (f64, f64),
    n: usize,
    m: usize,
) -> f64 {
    assert!(n % 2 == 0 && m % 2 == 0, "辛普森法要求 N 和 M 必须为偶数!");

    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx = (b - a) / n as f64;
    let hy = (d - c) / m as f64;
    let mut sum = 0.0;
    for j in 0..=m {
        let y = c + j as f64 * hy;
        let wy = simpson_weight(j, m);
        for i in 0..=n {
            let x = a + i as f64 * hx;
            let wx = simpson_weight(i, n);
            sum += wx * wy * f(x, y);
        }
    }
    (hx * hy / 9.0) * sum
}

// ================================================================
// 黎曼和
// ================================================================

pub enum RiemannMode {
    Left,
    Right,
    Mid,
}

pub fn riemann1d<F: Fn(f64) -> f64>(f: F, a: f64, b: f64, n: usize, mode: RiemannMode) -> f64 {
    let h = (b - a) / n as f64;
    let mut sum = 0.0;
    match mode {
        RiemannMode::Left => {
            for i in 0..n {
                sum += f(a + i as f64 * h);
            }
        }
        RiemannMode::Right => {
            for i in 1..=n {
                sum += f(a + i as f64 * h);
            }
        }
        RiemannMode::Mid => {
            for i in 0..n {
                sum += f(a + (i as f64 + 0.5) * h);
            }
        }
    }
    sum * h
}

pub fn riemann2d_left<F: Fn(f64, f64) -> f64>(
    f: F,
    x_range: (f64, f64),
    y_range: (f64, f64),
    n: usize,
    m: usize,
) -> f64 {
    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx = (b - a) / n as f64;
    let hy = (d - c) / m as f64;
    let mut sum = 0.0;
    for j in 0..m {
        let y = c + j as f64 * hy;
        for i in 0..n {
            sum += f(a + i as f64 * hx, y);
        }
    }
    sum * hx * hy
}

// ================================================================
// 勒贝格积分
// ================================================================

pub fn lebesgue1d<F: Fn(f64) -> f64>(f: F, a: f64, b: f64, layers: usize, sample_n: usize) -> f64 {
    let h = (b - a) / sample_n as f64;
    let mut y_min = f64::INFINITY;
    let mut y_max = f64::NEG_INFINITY;
    let mut samples: Vec<(f64, f64)> = Vec::new();

    for i in 0..=sample_n {
        let x = a + i as f64 * h;
        let y = f(x);
        if y.is_finite() {
            samples.push((x, y));
            y_min = y_min.min(y);
            y_max = y_max.max(y);
        }
    }
    if samples.is_empty() {
        return 0.0;
    }

    let mut sum = 0.0;

    if y_max > 1e-12 {
        sum += lebesgue_layer_sum(
            layers,
            y_max,
            &|t| {
                let mut m = 0.0;
                for &(_, y) in &samples {
                    if y > t {
                        m += h;
                    }
                }
                m
            },
            1.0,
        );
    }
    if y_min < -1e-12 {
        sum += lebesgue_layer_sum(
            layers,
            -y_min,
            &|t| {
                let mut m = 0.0;
                for &(_, y) in &samples {
                    if y < -t {
                        m += h;
                    }
                }
                m
            },
            -1.0,
        );
    }
    sum
}

pub fn lebesgue2d<F: Fn(f64, f64) -> f64>(
    f: F,
    x_range: (f64, f64),
    y_range: (f64, f64),
    layers: usize,
    sample_n: usize,
) -> f64 {
    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx = (b - a) / sample_n as f64;
    let hy = (d - c) / sample_n as f64;

    let mut z_min = f64::INFINITY;
    let mut z_max = f64::NEG_INFINITY;
    let mut grid: Vec<Vec<f64>> = Vec::new();

    for j in 0..=sample_n {
        let y = c + j as f64 * hy;
        let mut row: Vec<f64> = Vec::new();
        for i in 0..=sample_n {
            let z = f(a + i as f64 * hx, y);
            if z.is_finite() {
                row.push(z);
                z_min = z_min.min(z);
                z_max = z_max.max(z);
            } else {
                row.push(f64::NAN);
            }
        }
        grid.push(row);
    }

    let mut sum = 0.0;

    if z_max > 1e-12 {
        sum += lebesgue_layer_sum(
            layers,
            z_max,
            &|t| {
                let mut m = 0.0;
                for j in 0..sample_n {
                    for i in 0..sample_n {
                        let z = grid[j][i];
                        if z.is_finite() && z > t {
                            m += hx * hy;
                        }
                    }
                }
                m
            },
            1.0,
        );
    }
    if z_min < -1e-12 {
        sum += lebesgue_layer_sum(
            layers,
            -z_min,
            &|t| {
                let mut m = 0.0;
                for j in 0..sample_n {
                    for i in 0..sample_n {
                        let z = grid[j][i];
                        if z.is_finite() && z < -t {
                            m += hx * hy;
                        }
                    }
                }
                m
            },
            -1.0,
        );
    }
    sum
}

// ================================================================
// 基于预计算值数组的积分函数（零 FFI 回调）
// ================================================================

// --- 一维 ---

pub fn trapz1d_from_values(values: &[f64], a: f64, b: f64) -> f64 {
    let n = values.len() - 1;
    if n == 0 {
        return 0.0;
    }
    let h = (b - a) / n as f64;
    let mut sum = values[0] + values[n];
    for v in &values[1..n] {
        sum += 2.0 * v;
    }
    (h / 2.0) * sum
}

pub fn simpson1d_from_values(values: &[f64], a: f64, b: f64) -> Result<f64, String> {
    let n = values.len() - 1;
    if n % 2 != 0 {
        return Err("辛普森法要求 N 必须为偶数!".to_string());
    }
    if n == 0 {
        return Ok(0.0);
    }
    let h = (b - a) / n as f64;
    let mut sum = values[0] + values[n];
    for i in 1..n {
        sum += simpson_weight(i, n) * values[i];
    }
    Ok((h / 3.0) * sum)
}

pub fn riemann1d_left_from_values(values: &[f64], a: f64, b: f64) -> f64 {
    let n = values.len() - 1;
    if n == 0 {
        return 0.0;
    }
    let h = (b - a) / n as f64;
    let sum: f64 = values[..n].iter().sum();
    sum * h
}

pub fn riemann1d_right_from_values(values: &[f64], a: f64, b: f64) -> f64 {
    let n = values.len() - 1;
    if n == 0 {
        return 0.0;
    }
    let h = (b - a) / n as f64;
    let sum: f64 = values[1..].iter().sum();
    sum * h
}

pub fn riemann1d_mid_from_values(values: &[f64], a: f64, b: f64) -> f64 {
    let n = values.len();
    if n == 0 {
        return 0.0;
    }
    let h = (b - a) / n as f64;
    let sum: f64 = values.iter().sum();
    sum * h
}

// --- 二维 ---

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
    let hx = (b - a) / n as f64;
    let hy = (d - c) / m as f64;
    let sum: f64 = values.iter().sum();
    sum * hx * hy
}

// --- 勒贝格（基于值数组 扫描在 Rust 内完成 零 FFI） ---

pub fn lebesgue1d_from_values(values: &[f64], a: f64, b: f64, layers: usize) -> f64 {
    let n = values.len() - 1;
    if n == 0 {
        return 0.0;
    }
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
        return 0.0;
    }

    let mut sum = 0.0;

    if y_max > 1e-12 {
        sum += lebesgue_layer_sum(
            layers,
            y_max,
            &|t| {
                let mut m = 0.0;
                for &y in values {
                    if y.is_finite() && y > t {
                        m += h;
                    }
                }
                m
            },
            1.0,
        );
    }
    if y_min < -1e-12 {
        sum += lebesgue_layer_sum(
            layers,
            -y_min,
            &|t| {
                let mut m = 0.0;
                for &y in values {
                    if y.is_finite() && y < -t {
                        m += h;
                    }
                }
                m
            },
            -1.0,
        );
    }
    sum
}

pub fn lebesgue2d_from_values(
    values: &[f64],
    x_range: (f64, f64),
    y_range: (f64, f64),
    grid_size: usize, // 每维的分格数（旧称 sample_n）
    layers: usize,
) -> f64 {
    let (a, b) = x_range;
    let (c, d) = y_range;
    let hx = (b - a) / grid_size as f64;
    let hy = (d - c) / grid_size as f64;
    let area = hx * hy;
    // values 是 (grid_size+1) × (grid_size+1) 的网格点值 行主序

    let mut z_min = f64::INFINITY;
    let mut z_max = f64::NEG_INFINITY;
    for &z in values {
        if z.is_finite() {
            z_min = z_min.min(z);
            z_max = z_max.max(z);
        }
    }
    if !z_min.is_finite() || !z_max.is_finite() {
        return 0.0;
    }

    // 辅助：判断某个格子是否满足条件
    let cell_meets = |predicate: &dyn Fn(f64) -> bool, j: usize, i: usize| -> bool {
        let stride = grid_size + 1;
        let idx = j * stride + i;
        predicate(values[idx])
            && predicate(values[idx + 1])
            && predicate(values[idx + stride])
            && predicate(values[idx + stride + 1])
    };

    let mut sum = 0.0;

    if z_max > 1e-12 {
        sum += lebesgue_layer_sum(
            layers,
            z_max,
            &|t| {
                let pred = |z: f64| z > t;
                let mut m = 0.0;
                for j in 0..grid_size {
                    for i in 0..grid_size {
                        if cell_meets(&pred, j, i) {
                            m += area;
                        }
                    }
                }
                m
            },
            1.0,
        );
    }
    if z_min < -1e-12 {
        sum += lebesgue_layer_sum(
            layers,
            -z_min,
            &|t| {
                let pred = |z: f64| z < -t;
                let mut m = 0.0;
                for j in 0..grid_size {
                    for i in 0..grid_size {
                        if cell_meets(&pred, j, i) {
                            m += area;
                        }
                    }
                }
                m
            },
            -1.0,
        );
    }
    sum
}
