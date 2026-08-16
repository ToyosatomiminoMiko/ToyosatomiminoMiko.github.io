pub mod config;
pub mod surface_utils;

use wasm_bindgen::prelude::*;

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
