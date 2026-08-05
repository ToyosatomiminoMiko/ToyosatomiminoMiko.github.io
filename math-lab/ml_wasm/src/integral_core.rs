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
