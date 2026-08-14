use wasm_bindgen::prelude::*;
// 实现模块
mod field_core;
mod integral_core;
mod parser_wasm;
mod sampling_core;
mod surface_utils;
mod transform_core;

// ================================================================
// .miko DSL 解析器
// ================================================================

#[wasm_bindgen]
pub fn parse_miko(source: &str) -> Result<String, JsValue> {
    parser_wasm::parse_to_json(source).map_err(|e| JsValue::from_str(&e))
}

// ================================================================
// 4x4 矩阵变换
// ================================================================

fn mat4_error(message: impl Into<String>) -> JsValue {
    JsValue::from_str(&message.into())
}

#[wasm_bindgen]
pub fn mat4_identity() -> Vec<f64> {
    transform_core::identity4().to_vec()
}

#[wasm_bindgen]
pub fn mat4_translate(tx: f64, ty: f64, tz: f64) -> Vec<f64> {
    transform_core::translate4(tx, ty, tz).to_vec()
}

#[wasm_bindgen]
pub fn mat4_scale(sx: f64, sy: f64, sz: f64) -> Vec<f64> {
    transform_core::scale4(sx, sy, sz).to_vec()
}

#[wasm_bindgen]
pub fn mat4_rotate(rx: f64, ry: f64, rz: f64) -> Vec<f64> {
    transform_core::rotate4(rx, ry, rz).to_vec()
}

#[wasm_bindgen]
pub fn mat4_multiply(a: Vec<f64>, b: Vec<f64>) -> Result<Vec<f64>, JsValue> {
    let a = transform_core::from_flat(a).map_err(mat4_error)?;
    let b = transform_core::from_flat(b).map_err(mat4_error)?;
    Ok(transform_core::multiply4x4(a, b).to_vec())
}

#[wasm_bindgen]
pub fn mat4_apply_point(matrix: Vec<f64>, x: f64, y: f64, z: f64) -> Result<Vec<f64>, JsValue> {
    let matrix = transform_core::from_flat(matrix).map_err(mat4_error)?;
    Ok(transform_core::apply_to_point(matrix, x, y, z).to_vec())
}

// ================================================================
// 曲线 / 向量场采样
// ================================================================

#[wasm_bindgen]
pub fn sample_curve(
    expr: &str,
    coeff_names: Vec<String>,
    coeff_values: Vec<f64>,
    x_min: f64,
    x_max: f64,
    steps: usize,
) -> Result<Vec<f32>, JsValue> {
    sampling_core::sample_curve(expr, &coeff_names, &coeff_values, x_min, x_max, steps)
        .map_err(mat4_error)
}

#[wasm_bindgen]
pub fn sample_vector_field(
    p_expr: &str,
    q_expr: &str,
    r_expr: &str,
    coeff_names: Vec<String>,
    coeff_values: Vec<f64>,
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    z_min: f64,
    z_max: f64,
    nx: usize,
    ny: usize,
    nz: usize,
) -> Result<Vec<f32>, JsValue> {
    sampling_core::sample_vector_field(
        p_expr,
        q_expr,
        r_expr,
        &coeff_names,
        &coeff_values,
        x_min,
        x_max,
        y_min,
        y_max,
        z_min,
        z_max,
        nx,
        ny,
        nz,
    )
    .map_err(mat4_error)
}

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

// ================================================================
// 统一表面后处理
// ================================================================
#[wasm_bindgen]
pub fn generate_full_indices(cols: u32, rows: u32) -> Vec<u32> {
    surface_utils::generate_full_indices(cols as usize, rows as usize)
}

#[wasm_bindgen(getter_with_clone)]
pub struct SurfaceSampleResult {
    pub positions: Vec<f32>,
    pub colors: Vec<f32>,
    pub valid_indices: Vec<u32>,
    pub normals: Vec<f32>,
    pub z_min: f64,
    pub z_max: f64,
}

#[wasm_bindgen]
pub fn sample_and_process_surface(
    expr: &str,
    coeff_names: Vec<String>,
    coeff_values: Vec<f64>,
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    cols: u32,
    rows: u32,
) -> Result<SurfaceSampleResult, JsValue> {
    let result = surface_utils::sample_and_process_surface(
        expr,
        &coeff_names,
        &coeff_values,
        x_min,
        x_max,
        y_min,
        y_max,
        cols,
        rows,
    )
    .map_err(|e| JsValue::from_str(&e))?;

    Ok(SurfaceSampleResult {
        positions: result.positions,
        colors: result.colors,
        valid_indices: result.valid_indices,
        normals: result.normals,
        z_min: result.z_min,
        z_max: result.z_max,
    })
}

// ================================================================
// 梯度 / 散度 / 旋度
// ================================================================

#[wasm_bindgen]
pub struct GradientPointResult {
    pub f0: f64,
    pub fx: f64,
    pub fy: f64,
}

#[wasm_bindgen]
pub struct CurlPointResult {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[wasm_bindgen]
pub fn evaluate_gradient_point(
    surface_expr: &str,
    fx_expr: &str,
    fy_expr: &str,
    coeff_names: Vec<String>,
    coeff_values: Vec<f64>,
    x: f64,
    y: f64,
) -> Result<GradientPointResult, JsValue> {
    let (f0, fx, fy) = field_core::evaluate_gradient_point(
        surface_expr,
        fx_expr,
        fy_expr,
        &coeff_names,
        &coeff_values,
        x,
        y,
    )
    .map_err(|e| JsValue::from_str(&e))?;

    Ok(GradientPointResult { f0, fx, fy })
}

#[wasm_bindgen]
pub fn evaluate_divergence_point(
    dpx_expr: &str,
    dqy_expr: &str,
    drz_expr: &str,
    coeff_names: Vec<String>,
    coeff_values: Vec<f64>,
    x: f64,
    y: f64,
    z: f64,
) -> Result<f64, JsValue> {
    field_core::evaluate_divergence_point(
        dpx_expr,
        dqy_expr,
        drz_expr,
        &coeff_names,
        &coeff_values,
        x,
        y,
        z,
    )
    .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn evaluate_curl_point(
    dr_dy_expr: &str,
    dq_dz_expr: &str,
    dp_dz_expr: &str,
    dr_dx_expr: &str,
    dq_dx_expr: &str,
    dp_dy_expr: &str,
    coeff_names: Vec<String>,
    coeff_values: Vec<f64>,
    x: f64,
    y: f64,
    z: f64,
) -> Result<CurlPointResult, JsValue> {
    let (x, y, z) = field_core::evaluate_curl_point(
        dr_dy_expr,
        dq_dz_expr,
        dp_dz_expr,
        dr_dx_expr,
        dq_dx_expr,
        dp_dy_expr,
        &coeff_names,
        &coeff_values,
        x,
        y,
        z,
    )
    .map_err(|e| JsValue::from_str(&e))?;

    Ok(CurlPointResult { x, y, z })
}
