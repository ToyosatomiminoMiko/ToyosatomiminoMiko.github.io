use wasm_bindgen::prelude::*;

mod integral_core;

/// JS 调用的辅助：从 js_sys::Function 提取 f64 返回值
fn call1d(f: &js_sys::Function, x: f64) -> f64 {
    f.call1(&JsValue::NULL, &JsValue::from_f64(x))
        .ok()
        .and_then(|v| v.as_f64())
        .unwrap_or(f64::NAN)
}

fn call2d(f: &js_sys::Function, x: f64, y: f64) -> f64 {
    f.call2(&JsValue::NULL, &JsValue::from_f64(x), &JsValue::from_f64(y))
        .ok()
        .and_then(|v| v.as_f64())
        .unwrap_or(f64::NAN)
}

// ================================================================
// 一维积分
// ================================================================

#[wasm_bindgen]
pub fn trapz1d(f: &js_sys::Function, a: f64, b: f64, n: usize) -> f64 {
    integral_core::trapz1d(|x| call1d(f, x), a, b, n)
}

#[wasm_bindgen]
pub fn simpson1d(f: &js_sys::Function, a: f64, b: f64, n: usize) -> f64 {
    integral_core::simpson1d(|x| call1d(f, x), a, b, n)
}

#[wasm_bindgen]
pub fn riemann1d_left(f: &js_sys::Function, a: f64, b: f64, n: usize) -> f64 {
    integral_core::riemann1d(|x| call1d(f, x), a, b, n, integral_core::RiemannMode::Left)
}

#[wasm_bindgen]
pub fn riemann1d_right(f: &js_sys::Function, a: f64, b: f64, n: usize) -> f64 {
    integral_core::riemann1d(|x| call1d(f, x), a, b, n, integral_core::RiemannMode::Right)
}

#[wasm_bindgen]
pub fn riemann1d_mid(f: &js_sys::Function, a: f64, b: f64, n: usize) -> f64 {
    integral_core::riemann1d(|x| call1d(f, x), a, b, n, integral_core::RiemannMode::Mid)
}

#[wasm_bindgen]
pub fn lebesgue1d(f: &js_sys::Function, a: f64, b: f64, layers: usize, sample_n: usize) -> f64 {
    integral_core::lebesgue1d(|x| call1d(f, x), a, b, layers, sample_n)
}

// ================================================================
// 二维积分
// ================================================================

#[wasm_bindgen]
pub fn trapz2d(
    f: &js_sys::Function,
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    n: usize,
    m: usize,
) -> f64 {
    integral_core::trapz2d(|x, y| call2d(f, x, y), (xa, xb), (ya, yb), n, m)
}

#[wasm_bindgen]
pub fn simpson2d(
    f: &js_sys::Function,
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    n: usize,
    m: usize,
) -> f64 {
    integral_core::simpson2d(|x, y| call2d(f, x, y), (xa, xb), (ya, yb), n, m)
}

#[wasm_bindgen]
pub fn riemann2d_left(
    f: &js_sys::Function,
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    n: usize,
    m: usize,
) -> f64 {
    integral_core::riemann2d_left(|x, y| call2d(f, x, y), (xa, xb), (ya, yb), n, m)
}

#[wasm_bindgen]
pub fn lebesgue2d(
    f: &js_sys::Function,
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    layers: usize,
    sample_n: usize,
) -> f64 {
    integral_core::lebesgue2d(|x, y| call2d(f, x, y), (xa, xb), (ya, yb), layers, sample_n)
}

// ================================================================
// 基于值数组的积分（零 FFI 回调）—— 推荐使用
// ================================================================

#[wasm_bindgen]
pub fn trapz1d_values(values: &[f64], a: f64, b: f64) -> f64 {
    integral_core::trapz1d_from_values(values, a, b)
}

#[wasm_bindgen]
pub fn simpson1d_values(values: &[f64], a: f64, b: f64) -> Result<f64, JsValue> {
    integral_core::simpson1d_from_values(values, a, b).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn riemann1d_left_values(values: &[f64], a: f64, b: f64) -> f64 {
    integral_core::riemann1d_left_from_values(values, a, b)
}

#[wasm_bindgen]
pub fn riemann1d_right_values(values: &[f64], a: f64, b: f64) -> f64 {
    integral_core::riemann1d_right_from_values(values, a, b)
}

#[wasm_bindgen]
pub fn riemann1d_mid_values(values: &[f64], a: f64, b: f64) -> f64 {
    integral_core::riemann1d_mid_from_values(values, a, b)
}

#[wasm_bindgen]
pub fn lebesgue1d_values(values: &[f64], a: f64, b: f64, layers: usize) -> f64 {
    integral_core::lebesgue1d_from_values(values, a, b, layers)
}

// --- 二维 ---

#[wasm_bindgen]
pub fn trapz2d_values(
    values: &[f64],
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    n: usize,
    m: usize,
) -> f64 {
    integral_core::trapz2d_from_values(values, (xa, xb), (ya, yb), n, m)
}

#[wasm_bindgen]
pub fn simpson2d_values(
    values: &[f64],
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    n: usize,
    m: usize,
) -> Result<f64, JsValue> {
    integral_core::simpson2d_from_values(values, (xa, xb), (ya, yb), n, m)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn riemann2d_left_values(
    values: &[f64],
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    n: usize,
    m: usize,
) -> f64 {
    integral_core::riemann2d_left_from_values(values, (xa, xb), (ya, yb), n, m)
}

#[wasm_bindgen]
pub fn lebesgue2d_values(
    values: &[f64],
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    grid_size: usize,
    layers: usize,
) -> f64 {
    integral_core::lebesgue2d_from_values(values, (xa, xb), (ya, yb), grid_size, layers)
}
