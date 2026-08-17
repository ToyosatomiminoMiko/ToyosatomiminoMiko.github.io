/// 曲面伪彩色映射参数.
///
/// 当前颜色映射是固定的 HSL 方案,先把这些值集中到这里；
/// 后续若需要允许前端覆盖,再把它们变成函数参数或配置结构体.
pub const SURFACE_HUE_START: f64 = 0.66;
pub const SURFACE_SATURATION: f64 = 0.9;
pub const SURFACE_LIGHTNESS_BASE: f64 = 0.5;
pub const SURFACE_LIGHTNESS_RANGE: f64 = 0.3;

/// 所有 z 值都非法时的退化极值.
pub const DEGENERATE_Z_MIN: f64 = 0.0;
pub const DEGENERATE_Z_MAX: f64 = 1.0;

/// 平坦曲面（range == 0）的颜色位置.
pub const FLAT_COLOR_T: f64 = 0.5;
