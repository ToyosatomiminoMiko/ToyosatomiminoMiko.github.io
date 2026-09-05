pub mod builtins;
pub mod config;
pub mod domain_integral;
pub mod eval_core;
pub mod field_core;
pub mod integral_core;
pub mod integral_method;
pub mod intersection_core;
pub mod sampling_core;
pub mod symbolic;
pub mod transform_core;

use integral_method::IntegralMethod;
use wasm_bindgen::prelude::*;

fn math_error(message: impl Into<String>) -> JsValue {
    JsValue::from_str(&message.into())
}

// ================================================================
// 4x4 矩阵变换
// ================================================================

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
    let a = transform_core::from_flat(a).map_err(math_error)?;
    let b = transform_core::from_flat(b).map_err(math_error)?;
    Ok(transform_core::multiply4x4(a, b).to_vec())
}

#[wasm_bindgen]
pub fn mat4_apply_point(matrix: Vec<f64>, x: f64, y: f64, z: f64) -> Result<Vec<f64>, JsValue> {
    let matrix = transform_core::from_flat(matrix).map_err(math_error)?;
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
        .map_err(math_error)
}

#[allow(clippy::too_many_arguments)]
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
    .map_err(math_error)
}

// ================================================================
// 表达式级积分
// ================================================================

#[wasm_bindgen(getter_with_clone)]
pub struct IntegralSampleResult {
    pub value: f64,
    pub samples: Vec<f64>,
    pub sample_shape: String,
    pub n: usize,
    pub m: usize,
    /// 域积分(region 2D / solid 3D)回传的外接范围;其他域按需填 NaN.
    pub xa: f64,
    pub xb: f64,
    pub ya: f64,
    pub yb: f64,
    pub za: f64,
    pub zb: f64,
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn integrate1d(
    expr: &str,
    coeff_names: Vec<String>,
    coeff_values: Vec<f64>,
    a: f64,
    b: f64,
    n: usize,
    layers: usize,
    method: &str,
) -> Result<IntegralSampleResult, JsValue> {
    let method = IntegralMethod::parse(method).map_err(math_error)?;
    let sample_shape = method.sample_shape_1d();
    let samples =
        sampling_core::sample_function_1d(expr, &coeff_names, &coeff_values, a, b, n, sample_shape)
            .map_err(|e| JsValue::from_str(&e))?;

    let value = match method {
        IntegralMethod::Trapz => {
            integral_core::trapz1d_from_values(&samples, a, b).map_err(|e| JsValue::from_str(&e))?
        }
        IntegralMethod::Simpson => integral_core::simpson1d_from_values(&samples, a, b)
            .map_err(|e| JsValue::from_str(&e))?,
        IntegralMethod::RiemannLeft => integral_core::riemann1d_left_from_values(&samples, a, b)
            .map_err(|e| JsValue::from_str(&e))?,
        IntegralMethod::RiemannRight => integral_core::riemann1d_right_from_values(&samples, a, b)
            .map_err(|e| JsValue::from_str(&e))?,
        IntegralMethod::RiemannMid => integral_core::riemann1d_mid_from_values(&samples, a, b)
            .map_err(|e| JsValue::from_str(&e))?,
        IntegralMethod::Lebesgue => integral_core::lebesgue1d_from_values(&samples, a, b, layers)
            .map_err(|e| JsValue::from_str(&e))?,
    };

    Ok(IntegralSampleResult {
        value,
        samples,
        sample_shape: sample_shape.tag_1d().to_string(),
        n,
        m: 0,
        xa: a,
        xb: b,
        ya: f64::NAN,
        yb: f64::NAN,
        za: f64::NAN,
        zb: f64::NAN,
    })
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn integrate2d(
    expr: &str,
    coeff_names: Vec<String>,
    coeff_values: Vec<f64>,
    xa: f64,
    xb: f64,
    ya: f64,
    yb: f64,
    n: usize,
    m: usize,
    layers: usize,
    method: &str,
) -> Result<IntegralSampleResult, JsValue> {
    let method = IntegralMethod::parse(method).map_err(math_error)?;
    let sample_shape = method.sample_shape_2d();
    let samples = sampling_core::sample_function_2d(
        expr,
        &coeff_names,
        &coeff_values,
        xa,
        xb,
        ya,
        yb,
        n,
        m,
        sample_shape,
    )
    .map_err(|e| JsValue::from_str(&e))?;

    let value = match method {
        IntegralMethod::Trapz => {
            integral_core::trapz2d_from_values(&samples, (xa, xb), (ya, yb), n, m)
                .map_err(|e| JsValue::from_str(&e))?
        }
        IntegralMethod::Simpson => {
            integral_core::simpson2d_from_values(&samples, (xa, xb), (ya, yb), n, m)
                .map_err(|e| JsValue::from_str(&e))?
        }
        IntegralMethod::RiemannLeft => {
            integral_core::riemann2d_left_from_values(&samples, (xa, xb), (ya, yb), n, m)
                .map_err(|e| JsValue::from_str(&e))?
        }
        IntegralMethod::RiemannRight => {
            integral_core::riemann2d_right_from_values(&samples, (xa, xb), (ya, yb), n, m)
                .map_err(|e| JsValue::from_str(&e))?
        }
        IntegralMethod::RiemannMid => {
            integral_core::riemann2d_mid_from_values(&samples, (xa, xb), (ya, yb), n, m)
                .map_err(|e| JsValue::from_str(&e))?
        }
        IntegralMethod::Lebesgue => {
            integral_core::lebesgue2d_from_values(&samples, (xa, xb), (ya, yb), n, layers)
                .map_err(|e| JsValue::from_str(&e))?
        }
    };

    Ok(IntegralSampleResult {
        value,
        samples,
        sample_shape: sample_shape.tag_2d().to_string(),
        n,
        m,
        xa,
        xb,
        ya,
        yb,
        za: f64::NAN,
        zb: f64::NAN,
    })
}

// ================================================================
// 带域积分:region(2D 面积图形)/ solid(3D 实体)
// ================================================================

/// region(2D, x 型带状)域积分统一入口.
///
/// - 被积函数(世界坐标 x,y,`integrand`)与两条边界曲线各带独立系数表;
/// - 曲线 y=f(x) 求值走一元后端(不会误把 y/z 当坐标变量);
/// - 数值语义见 `domain_integral::integrate_region`.
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn integrate_region(
    method: &str,
    integrand_expr: &str,
    integrand_names: Vec<String>,
    integrand_values: Vec<f64>,
    boundary_a_expr: &str,
    boundary_a_names: Vec<String>,
    boundary_a_values: Vec<f64>,
    boundary_b_expr: &str,
    boundary_b_names: Vec<String>,
    boundary_b_values: Vec<f64>,
    xa: f64,
    xb: f64,
    n: usize,
    layers: usize,
) -> Result<IntegralSampleResult, JsValue> {
    let input = domain_integral::RegionInput {
        integrand_expr,
        integrand_names: &integrand_names,
        integrand_values: &integrand_values,
        boundary_exprs: [boundary_a_expr, boundary_b_expr],
        boundary_names: [&boundary_a_names, &boundary_b_names],
        boundary_values: [&boundary_a_values, &boundary_b_values],
        xa,
        xb,
    };
    let method = IntegralMethod::parse(method).map_err(math_error)?;
    let outcome =
        domain_integral::integrate_region(method, &input, n, layers).map_err(math_error)?;
    Ok(IntegralSampleResult {
        value: outcome.value,
        samples: outcome.samples,
        sample_shape: "2d-cell".to_string(),
        n: outcome.n,
        m: outcome.n,
        xa,
        xb,
        ya: outcome.y_min,
        yb: outcome.y_max,
        za: f64::NAN,
        zb: f64::NAN,
    })
}

/// solid(3D 实体:sphere/box/conic)域积分统一入口.
///
/// 域描述复用求交的 ObjectDescriptor 形状(kind+params+matrix+inverse),
/// 使三重积分与"渲染出的世界实体"保持同一几何口径.
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn integrate_solid(
    method: &str,
    kind: &str,
    params: Vec<f64>,
    matrix_values: Vec<f64>,
    inverse_values: Vec<f64>,
    integrand_expr: &str,
    integrand_names: Vec<String>,
    integrand_values: Vec<f64>,
    n: usize,
    layers: usize,
) -> Result<IntegralSampleResult, JsValue> {
    // 实体没有表达式:expr 传空,系数为空.
    let descriptor = intersection_core::parse_object_descriptor(
        kind,
        "",
        Vec::new(),
        Vec::new(),
        params,
        matrix_values,
        inverse_values,
    )
    .map_err(math_error)?;

    let method = IntegralMethod::parse(method).map_err(math_error)?;

    // f≡1 的 3D lebesgue 直接返回解析测度(体积),不建层几何,不做 O(n³) 网格.
    if method == IntegralMethod::Lebesgue && integrand_expr.trim() == "1" {
        let measure = domain_integral::solid_exact_measure(&descriptor).map_err(math_error)?;
        let aabb = intersection_core::solid_world_aabb(&descriptor).map_err(math_error)?;
        return Ok(IntegralSampleResult {
            value: measure,
            samples: Vec::new(),
            sample_shape: "3d-skip".to_string(),
            n: 0,
            m: 0,
            xa: aabb.0[0],
            xb: aabb.0[1],
            ya: aabb.1[0],
            yb: aabb.1[1],
            za: aabb.2[0],
            zb: aabb.2[1],
        });
    }

    let outcome = domain_integral::integrate_solid(
        method,
        &descriptor,
        integrand_expr,
        &integrand_names,
        &integrand_values,
        n,
        layers,
    )
    .map_err(math_error)?;
    Ok(IntegralSampleResult {
        value: outcome.value,
        samples: outcome.samples,
        sample_shape: "3d-cells".to_string(),
        n: outcome.n,
        m: outcome.n,
        xa: outcome.x_min,
        xb: outcome.x_max,
        ya: outcome.y_min,
        yb: outcome.y_max,
        za: outcome.z_min,
        zb: outcome.z_max,
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

#[wasm_bindgen(getter_with_clone)]
pub struct IntersectionOutput {
    /// 离散交点,扁平 `[x, y, z, ...]`.
    pub points: Vec<f64>,
    /// 交线折线点,扁平 `[x, y, z, ...]`.
    pub curve_points: Vec<f64>,
    /// 每条折线在 `curve_points` 里的起始点下标,末尾为总点数.
    pub curve_offsets: Vec<u32>,
}

#[wasm_bindgen]
pub fn evaluate_scalar(
    expr: &str,
    coeff_names: Vec<String>,
    coeff_values: Vec<f64>,
    x: f64,
    y: f64,
    z: f64,
) -> Result<f64, JsValue> {
    field_core::evaluate_scalar(expr, &coeff_names, &coeff_values, x, y, z)
        .map_err(|e| JsValue::from_str(&e))
}

/// 求交统一入口.
///
/// 两个对象各用 `(kind, expr, coeff_names, coeff_values, params, matrix, inverse)`
/// 描述;`params` 布局见 `intersection_core` 模块注释.表达式/系数只在 Rust
/// 内核里编译一次,后续逐点求值都复用上下文,不再每次跨 JS/WASM 边界重建.
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn intersect_pair(
    kind_a: &str,
    expr_a: &str,
    coeff_names_a: Vec<String>,
    coeff_values_a: Vec<f64>,
    params_a: Vec<f64>,
    matrix_a: Vec<f64>,
    inverse_a: Vec<f64>,
    kind_b: &str,
    expr_b: &str,
    coeff_names_b: Vec<String>,
    coeff_values_b: Vec<f64>,
    params_b: Vec<f64>,
    matrix_b: Vec<f64>,
    inverse_b: Vec<f64>,
    segments: usize,
) -> Result<IntersectionOutput, JsValue> {
    let a = intersection_core::parse_object_descriptor(
        kind_a,
        expr_a,
        coeff_names_a,
        coeff_values_a,
        params_a,
        matrix_a,
        inverse_a,
    )
    .map_err(math_error)?;
    let b = intersection_core::parse_object_descriptor(
        kind_b,
        expr_b,
        coeff_names_b,
        coeff_values_b,
        params_b,
        matrix_b,
        inverse_b,
    )
    .map_err(math_error)?;

    let output = intersection_core::compute_pair(&a, &b, segments).map_err(math_error)?;
    Ok(IntersectionOutput {
        points: output.points,
        curve_points: output.curve_points,
        curve_offsets: output.curve_offsets,
    })
}

// ================================================================
// 符号解析 / 求导 / 变量提取 / 数组与矩阵解析
// ================================================================

#[wasm_bindgen]
pub fn normalize_expression(expr: &str) -> Result<String, JsValue> {
    symbolic::normalize_expression(expr).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn latex_expression(expr: &str) -> Result<String, JsValue> {
    symbolic::latex_expression(expr).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn symbolic_derivative(expr: &str, variable: &str) -> Result<String, JsValue> {
    symbolic::symbolic_derivative(expr, variable).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn symbolic_variables(expr: &str, exclude: Vec<String>) -> Result<Vec<String>, JsValue> {
    symbolic::symbolic_variables(expr, &exclude).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn parse_array_strings(expr: &str) -> Result<String, JsValue> {
    symbolic::parse_array_strings(expr).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn matrix4_from_expr(expr: &str) -> Result<Vec<f64>, JsValue> {
    symbolic::matrix4_from_expr(expr).map_err(|e| JsValue::from_str(&e))
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

#[allow(clippy::too_many_arguments)]
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

#[allow(clippy::too_many_arguments)]
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

// ================================================================
// 分发层 / 契约层测试
//
// 审查报告指出:Rust 测试全是"核函数对拍",没有任何一项覆盖 lib.rs 的
// wasm 语义分发(方法字符串 -> 采样形状 -> 消费核这条 glue)--P0(2D
// rectangle lebesgue 采样/消费长度不一致)就住在 glue 里却一直全绿.
// 这里为每个积分 wasm 入口放一条"真值已知"的黄金用例,直接以 wasm 层
// 参数语义调用导出函数(宿主测试只走成功路径,Err 由 JsValue 构造,见
// integral_core/domain_integral 的纯 Rust 错误用例).
// ================================================================
#[cfg(test)]
mod glue_tests {
    use super::*;

    fn no_coeffs() -> (Vec<String>, Vec<f64>) {
        (Vec::new(), Vec::new())
    }

    fn approx(actual: f64, expected: f64, tol: f64, label: &str) {
        assert!(
            (actual - expected).abs() <= tol,
            "{label}: {actual} vs 期望 {expected} (±{tol})"
        );
    }

    #[test]
    fn integrate1d_trapezoid_simpson_riemann_known_values() {
        let (names, values) = no_coeffs();
        let result = integrate1d(
            "x",
            names.clone(),
            values.clone(),
            0.0,
            1.0,
            128,
            8,
            "trapezoid",
        )
        .expect("trapezoid 应成功");
        approx(result.value, 0.5, 1e-9, "trapezoid ∫x");

        let result = integrate1d(
            "x",
            names.clone(),
            values.clone(),
            0.0,
            1.0,
            128,
            8,
            "simpson",
        )
        .expect("simpson 应成功");
        approx(result.value, 0.5, 1e-12, "simpson ∫x");

        let result = integrate1d(
            "x",
            names.clone(),
            values.clone(),
            0.0,
            1.0,
            128,
            8,
            "riemann:left",
        )
        .expect("riemann:left 应成功");
        approx(result.value, 0.5, 5e-3, "riemann:left ∫x");

        let result = integrate1d("1", names, values, 0.0, 1.0, 320, 32, "lebesgue")
            .expect("1D lebesgue 应成功");
        approx(result.value, 1.0, 1e-9, "1D lebesgue ∫1");
    }

    /// P0 回归:2D rectangle 的 lebesgue 曾经因"corner 采样 N² 个值 vs
    /// 消费端期望 (N+1)²"必然报错;这里要求以 wasm 层语义直接成功.
    #[test]
    fn integrate2d_rectangle_lebesgue_glue_contract() {
        let (names, values) = no_coeffs();
        let result = integrate2d(
            "1",
            names.clone(),
            values.clone(),
            0.0,
            1.0,
            0.0,
            1.0,
            64,
            64,
            16,
            "lebesgue",
        )
        .expect("2D lebesgue f≡1 应成功(不再有长度错误)");
        assert_eq!(result.sample_shape, "2d-corner");
        assert_eq!(result.samples.len(), 64 * 64);
        approx(result.value, 1.0, 1e-9, "2D lebesgue f≡1 面积");

        // f=x:∬_[0,1]² x dA = 1/2(层-测度近似的量化误差随 n,layers 收敛).
        let result = integrate2d(
            "x", names, values, 0.0, 1.0, 0.0, 1.0, 512, 512, 512, "lebesgue",
        )
        .expect("2D lebesgue f=x 应成功");
        approx(result.value, 0.5, 5e-3, "2D lebesgue f=x");
    }

    #[test]
    fn integrate2d_rectangle_other_methods_known_values() {
        let (names, values) = no_coeffs();
        // 梯形/辛普森对双线性精确.
        let result = integrate2d(
            "x + y",
            names.clone(),
            values.clone(),
            0.0,
            1.0,
            0.0,
            1.0,
            64,
            64,
            8,
            "simpson",
        )
        .expect("2D simpson 应成功");
        approx(result.value, 1.0, 1e-9, "2D simpson ∬(x+y)");

        let result = integrate2d(
            "x",
            names.clone(),
            values.clone(),
            0.0,
            1.0,
            0.0,
            1.0,
            128,
            128,
            8,
            "riemann:mid",
        )
        .expect("2D riemann:mid 应成功");
        approx(result.value, 0.5, 1e-9, "2D riemann:mid ∬x");
    }

    #[test]
    fn integrate_region_known_area_and_moment() {
        let (n1, v1) = no_coeffs();
        // D = {0≤x≤1, 0≤y≤x}:面积 1/2,∬ x dA = 1/3.
        let input = domain_integral::RegionInput {
            integrand_expr: "1",
            integrand_names: &n1,
            integrand_values: &v1,
            boundary_exprs: ["0", "x"],
            boundary_names: [&n1, &n1],
            boundary_values: [&v1, &v1],
            xa: 0.0,
            xb: 1.0,
        };
        let outcome = domain_integral::integrate_region(
            IntegralMethod::parse("simpson").unwrap(),
            &input,
            128,
            8,
        )
        .expect("region simpson 应成功");
        approx(outcome.value, 0.5, 1e-9, "region simpson 面积");

        let input = domain_integral::RegionInput {
            integrand_expr: "x",
            integrand_names: &n1,
            integrand_values: &v1,
            boundary_exprs: ["0", "x"],
            boundary_names: [&n1, &n1],
            boundary_values: [&v1, &v1],
            xa: 0.0,
            xb: 1.0,
        };
        let outcome = domain_integral::integrate_region(
            IntegralMethod::parse("simpson").unwrap(),
            &input,
            128,
            8,
        )
        .expect("region simpson 应成功");
        approx(outcome.value, 1.0 / 3.0, 1e-7, "region simpson ∬x");
    }

    #[test]
    fn integrate_solid_volume_and_quadratic_integrand() {
        let (names, values) = no_coeffs();
        // 单位球体积 4π/3(wasm 层的 lebesgue f≡1 短路径).
        let result = integrate_solid(
            "lebesgue",
            "sphere",
            vec![0.0, 0.0, 0.0, 1.0],
            vec![],
            vec![],
            "1",
            names.clone(),
            values.clone(),
            0,
            8,
        )
        .expect("solid lebesgue f≡1 应成功");
        approx(
            result.value,
            4.0 / 3.0 * std::f64::consts::PI,
            1e-9,
            "球体积",
        );

        // ∭(x²+y²+z²) dV = 4π/5.
        let result = integrate_solid(
            "simpson",
            "sphere",
            vec![0.0, 0.0, 0.0, 1.0],
            vec![],
            vec![],
            "x*x + y*y + z*z",
            names,
            values,
            64,
            8,
        )
        .expect("solid simpson 应成功");
        approx(
            result.value,
            4.0 / 5.0 * std::f64::consts::PI,
            1e-3,
            "单位球 ∭r² dV",
        );
    }
}
