use wasm_bindgen::prelude::*;
// 实现模块
mod integral_core;
mod surface_utils;

// ================================================================
// 基于值数组的积分 零FFI回调 推荐使用
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

// 三角形剔除
#[wasm_bindgen]
pub fn filter_nan_triangles(full_indices: &[u32], z_values: &[f64]) -> Vec<u32> {
    surface_utils::filter_nan_triangles(full_indices, z_values)
}