//! 求交数值内核(原 IntersectionMath.ts 的 Rust 移植).
//!
//! 设计约束:
//! - 表达式只解析一次,上下文只构建一次,后续逐点求值都复用;
//! - 所有坐标均为世界坐标,对象静态 transform 在描述符进入内核前已经附带;
//! - 对象描述是可序列化的枚举数据,不携带跨 WASM 边界的闭包;
//! - marching squares 的鞍点歧义与旧 TS 实现保持一致(中心符号判定).
//!
//! 本模块不直接依赖 wasm-bindgen,便于在 `cargo test` 里做纯 Rust 验证.

use std::cmp::Ordering;
use std::collections::HashMap;

use crate::eval_core::CompiledEvaluator;
use crate::transform_core::{apply_to_point, Mat4};

const TAU: f64 = std::f64::consts::TAU;

/// 与旧 TS 实现保持一致的去重半径(世界坐标).
const POINT_DEDUP_TOLERANCE: f64 = 1e-5;
/// 顶点池的坐标量化精度(旧实现使用 toFixed(6)).
const VERTEX_QUANTUM: f64 = 1e6;

type V3 = [f64; 3];

#[derive(Clone, Copy)]
struct Crossing {
    u: f64,
    v: f64,
}

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn dist(a: V3, b: V3) -> f64 {
    (sub(a, b)).iter().map(|v| v * v).sum::<f64>().sqrt()
}

fn midpoint(a: V3, b: V3) -> V3 {
    [
        (a[0] + b[0]) * 0.5,
        (a[1] + b[1]) * 0.5,
        (a[2] + b[2]) * 0.5,
    ]
}

fn clamp(value: f64, lo: f64, hi: f64) -> f64 {
    value.max(lo).min(hi)
}

fn finite(value: f64) -> bool {
    value.is_finite()
}

fn finite_opt(value: Option<f64>) -> bool {
    matches!(value, Some(value) if value.is_finite())
}

fn to_world(matrix: Option<Mat4>, local: V3) -> V3 {
    match matrix {
        Some(matrix) => apply_to_point(matrix, local[0], local[1], local[2]),
        None => local,
    }
}

fn to_local(inverse: Option<Mat4>, world: V3) -> V3 {
    to_world(inverse, world)
}

// ================================================================
// 对象描述符
// ================================================================

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ObjectKind {
    Curve,
    Surface,
    Sphere,
    Box,
    Conic,
}

impl ObjectKind {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "curve" => Ok(Self::Curve),
            "surface" => Ok(Self::Surface),
            "sphere" => Ok(Self::Sphere),
            "box" => Ok(Self::Box),
            "conic" => Ok(Self::Conic),
            _ => Err(format!("求交不支持对象类型 {raw}")),
        }
    }
}

/// 描述一个求交参与方.所有数值参数集中在 `params`:
/// - curve:  [x0, x1]
/// - surface:[x0, x1, y0, y1]
/// - sphere: [cx, cy, cz, radius]
/// - box:    [cx, cy, cz, sx, sy, sz]
/// - conic:  [cx, cy, cz, base, top, height]
#[derive(Debug)]
pub struct ObjectDescriptor {
    pub kind: ObjectKind,
    pub expr: String,
    pub coefficient_names: Vec<String>,
    pub coefficient_values: Vec<f64>,
    pub params: Vec<f64>,
    pub matrix: Option<Mat4>,
    pub inverse: Option<Mat4>,
}

fn parse_optional_matrix(raw: &[f64], label: &str) -> Result<Option<Mat4>, String> {
    if raw.is_empty() {
        return Ok(None);
    }
    if raw.len() != 16 {
        return Err(format!("{label} 需要 16 个元素,实际为 {}", raw.len()));
    }
    let mut matrix = [0.0; 16];
    matrix.copy_from_slice(raw);
    Ok(Some(matrix))
}

pub fn parse_object_descriptor(
    kind: &str,
    expr: &str,
    coefficient_names: Vec<String>,
    coefficient_values: Vec<f64>,
    params: Vec<f64>,
    matrix_values: Vec<f64>,
    inverse_values: Vec<f64>,
) -> Result<ObjectDescriptor, String> {
    let kind = ObjectKind::parse(kind)?;
    if coefficient_names.len() != coefficient_values.len() {
        return Err(format!(
            "{} 的系数名与系数值数量不一致: {} vs {}",
            kind_name(kind),
            coefficient_names.len(),
            coefficient_values.len()
        ));
    }

    let expected_params = match kind {
        ObjectKind::Curve => 2,
        ObjectKind::Surface => 4,
        ObjectKind::Sphere => 4,
        ObjectKind::Box => 6,
        ObjectKind::Conic => 6,
    };
    if params.len() != expected_params {
        return Err(format!(
            "{} 需要 {expected_params} 个数值参数,实际为 {}",
            kind_name(kind),
            params.len()
        ));
    }

    let matrix = parse_optional_matrix(&matrix_values, "变换矩阵")?;
    let inverse = parse_optional_matrix(&inverse_values, "逆矩阵")?;

    Ok(ObjectDescriptor {
        kind,
        expr: expr.to_string(),
        coefficient_names,
        coefficient_values,
        params,
        matrix,
        inverse,
    })
}

fn kind_name(kind: ObjectKind) -> &'static str {
    match kind {
        ObjectKind::Curve => "曲线",
        ObjectKind::Surface => "曲面",
        ObjectKind::Sphere => "球体",
        ObjectKind::Box => "方块",
        ObjectKind::Conic => "旋转体",
    }
}

struct CurveEval {
    expr: CompiledEvaluator,
    range: [f64; 2],
}

impl CurveEval {
    fn new(descriptor: &ObjectDescriptor) -> Result<Self, String> {
        let expr = CompiledEvaluator::new(
            &descriptor.expr,
            &descriptor.coefficient_names,
            &descriptor.coefficient_values,
        )?;
        let x0: f64 = descriptor.params[0];
        let x1: f64 = descriptor.params[1];
        if x0.partial_cmp(&x1) != Some(Ordering::Less) {
            return Err("曲线 range 需要 min < max".to_string());
        }
        Ok(Self {
            expr,
            range: [x0, x1],
        })
    }

    fn eval_y(&mut self, x: f64) -> Result<Option<f64>, String> {
        self.expr.eval_1d(x)
    }

    fn world_at(&mut self, matrix: Option<Mat4>, x: f64) -> Result<Option<V3>, String> {
        match self.eval_y(x)? {
            Some(y) if finite(y) => Ok(Some(to_world(matrix, [x, y, 0.0]))),
            _ => Ok(None),
        }
    }
}

fn sample_curve(
    expr: &mut CurveEval,
    matrix: Option<Mat4>,
    steps: usize,
) -> Result<Vec<(f64, V3)>, String> {
    let [lo, hi] = expr.range;
    let mut samples: Vec<(f64, [f64; 3])> = Vec::with_capacity(steps + 1);
    for i in 0..=steps {
        let x: f64 = lo + (hi - lo) * (i as f64 / steps as f64);
        if let Some(point) = expr.world_at(matrix, x)? {
            samples.push((x, point));
        }
    }
    Ok(samples)
}

// ================================================================
// 隐式场
// ================================================================

enum FieldKind {
    Surface {
        expr: CompiledEvaluator,
        range: [f64; 4],
    },
    Sphere {
        center: V3,
        radius: f64,
    },
    Box {
        center: V3,
        half: V3,
    },
    Conic {
        center: V3,
        base_radius: f64,
        top_radius: f64,
        height: f64,
    },
}

struct FieldEval {
    inverse: Option<Mat4>,
    kind: FieldKind,
}

/// 供体积积分(C1 世界网格 / lebesgue 层)使用的"点在实体内外"探针.
///
/// 复用隐式场(≤0 在体内)与逆矩阵语义;对 `sphere/box/conic` 开放,
/// curve/surface 不能作为体域.
pub(crate) struct SolidProbe {
    field: FieldEval,
}

impl SolidProbe {
    pub(crate) fn new(descriptor: &ObjectDescriptor) -> Result<Self, String> {
        if !matches!(
            descriptor.kind,
            ObjectKind::Sphere | ObjectKind::Box | ObjectKind::Conic
        ) {
            return Err("体积积分只支持 sphere/box/conic 域".to_string());
        }
        Ok(Self {
            field: FieldEval::new(descriptor)?,
        })
    }

    /// 世界坐标点是否在实体内(边界计为体内).
    pub(crate) fn inside(&mut self, world: V3) -> Result<bool, String> {
        match self.field.eval(world)? {
            Some(value) => Ok(value <= 0.0),
            None => Ok(false),
        }
    }
}

/// 实体的世界外接 AABB:每轴为 [min, max].
pub(crate) type WorldAabb = ([f64; 2], [f64; 2], [f64; 2]);

/// 实体在世界坐标下的外接 AABB.
///
/// 做法:取"包含该实体局部形状的轴对齐盒"的 8 个角点,经静态矩阵变换到
/// 世界后取 min/max.对球/盒精确;对圆台按底半径外接盒,可能轻微外扩,
/// 但只影响采样候选格,不影响最终"点在体内"判定与积分值.
pub(crate) fn solid_world_aabb(descriptor: &ObjectDescriptor) -> Result<WorldAabb, String> {
    let (center, half) = match descriptor.kind {
        ObjectKind::Sphere => (
            [
                descriptor.params[0],
                descriptor.params[1],
                descriptor.params[2],
            ],
            [
                descriptor.params[3],
                descriptor.params[3],
                descriptor.params[3],
            ],
        ),
        ObjectKind::Box => (
            [
                descriptor.params[0],
                descriptor.params[1],
                descriptor.params[2],
            ],
            [
                descriptor.params[3] * 0.5,
                descriptor.params[4] * 0.5,
                descriptor.params[5] * 0.5,
            ],
        ),
        ObjectKind::Conic => {
            let radius = descriptor.params[3].max(descriptor.params[4]);
            (
                [
                    descriptor.params[0],
                    descriptor.params[1],
                    descriptor.params[2],
                ],
                [radius, descriptor.params[5] * 0.5, radius],
            )
        }
        _ => return Err("体积积分只支持 sphere/box/conic 域".to_string()),
    };

    let mut mins = [f64::INFINITY; 3];
    let mut maxs = [f64::NEG_INFINITY; 3];
    for &sx in &[-1.0, 1.0] {
        for &sy in &[-1.0, 1.0] {
            for &sz in &[-1.0, 1.0] {
                let corner = [
                    center[0] + sx * half[0],
                    center[1] + sy * half[1],
                    center[2] + sz * half[2],
                ];
                let world = to_world(descriptor.matrix, corner);
                for axis in 0..3 {
                    mins[axis] = mins[axis].min(world[axis]);
                    maxs[axis] = maxs[axis].max(world[axis]);
                }
            }
        }
    }
    Ok(([mins[0], maxs[0]], [mins[1], maxs[1]], [mins[2], maxs[2]]))
}

impl FieldEval {
    fn new(descriptor: &ObjectDescriptor) -> Result<Self, String> {
        let kind = match descriptor.kind {
            ObjectKind::Surface => {
                let expr = CompiledEvaluator::new(
                    &descriptor.expr,
                    &descriptor.coefficient_names,
                    &descriptor.coefficient_values,
                )?;
                FieldKind::Surface {
                    expr,
                    range: [
                        descriptor.params[0],
                        descriptor.params[1],
                        descriptor.params[2],
                        descriptor.params[3],
                    ],
                }
            }
            ObjectKind::Sphere => FieldKind::Sphere {
                center: [
                    descriptor.params[0],
                    descriptor.params[1],
                    descriptor.params[2],
                ],
                radius: descriptor.params[3],
            },
            ObjectKind::Box => FieldKind::Box {
                center: [
                    descriptor.params[0],
                    descriptor.params[1],
                    descriptor.params[2],
                ],
                half: [
                    descriptor.params[3] * 0.5,
                    descriptor.params[4] * 0.5,
                    descriptor.params[5] * 0.5,
                ],
            },
            ObjectKind::Conic => FieldKind::Conic {
                center: [
                    descriptor.params[0],
                    descriptor.params[1],
                    descriptor.params[2],
                ],
                base_radius: descriptor.params[3],
                top_radius: descriptor.params[4],
                height: descriptor.params[5],
            },
            ObjectKind::Curve => return Err("曲线不能作为隐式场".to_string()),
        };
        Ok(Self {
            inverse: descriptor.inverse,
            kind,
        })
    }

    fn eval(&mut self, world: V3) -> Result<Option<f64>, String> {
        let local = to_local(self.inverse, world);
        match &mut self.kind {
            FieldKind::Surface { expr, range } => {
                let [xa, xb, ya, yb] = *range;
                if local[0] < xa || local[0] > xb || local[1] < ya || local[1] > yb {
                    return Ok(None);
                }
                let z = expr.eval_2d(local[0], local[1])?;
                Ok(z.map(|z| local[2] - z))
            }
            FieldKind::Sphere { center, radius } => Ok(Some(dist(local, *center) - *radius)),
            FieldKind::Box { center, half } => {
                let dx = (local[0] - center[0]).abs() - half[0];
                let dy = (local[1] - center[1]).abs() - half[1];
                let dz = (local[2] - center[2]).abs() - half[2];
                Ok(Some(dx.max(dy).max(dz)))
            }
            FieldKind::Conic {
                center,
                base_radius,
                top_radius,
                height,
            } => {
                let dy = local[1] - center[1];
                let rho = ((local[0] - center[0]).powi(2) + (local[2] - center[2]).powi(2)).sqrt();
                let half_height = *height * 0.5;
                let radius_at =
                    *base_radius + (*top_radius - *base_radius) * ((dy + half_height) / *height);
                Ok(Some(
                    (rho - radius_at)
                        .max(-(dy + half_height))
                        .max(dy - half_height),
                ))
            }
        }
    }
}

// ================================================================
// 参数化面片
// ================================================================

struct SurfaceGrid {
    z_values: Vec<f64>,
    nx: usize,
    ny: usize,
    range: [f64; 4],
    matrix: Option<Mat4>,
}

impl SurfaceGrid {
    fn new(descriptor: &ObjectDescriptor, nx: usize, ny: usize) -> Result<Self, String> {
        let [xa, xb, ya, yb] = [
            descriptor.params[0],
            descriptor.params[1],
            descriptor.params[2],
            descriptor.params[3],
        ];
        if !(xa < xb && ya < yb) {
            return Err("曲面 range 需要 min < max".to_string());
        }
        let z_values: Vec<f64> = crate::sampling_core::sample_surface_values(
            &descriptor.expr,
            &descriptor.coefficient_names,
            &descriptor.coefficient_values,
            xa,
            xb,
            ya,
            yb,
            nx,
            ny,
        )?;
        Ok(Self {
            z_values,
            nx,
            ny,
            range: [xa, xb, ya, yb],
            matrix: descriptor.matrix,
        })
    }

    fn bilinear_z(&self, u: f64, v: f64) -> Option<f64> {
        let [xa, xb, ya, yb] = self.range;
        let xf = ((u - xa) / (xb - xa)) * self.nx as f64;
        let yf = ((v - ya) / (yb - ya)) * self.ny as f64;
        let i0 = clamp(xf.floor(), 0.0, (self.nx - 1) as f64) as usize;
        let j0 = clamp(yf.floor(), 0.0, (self.ny - 1) as f64) as usize;
        let i1 = (i0 + 1).min(self.nx);
        let j1 = (j0 + 1).min(self.ny);
        let tx = clamp(xf - i0 as f64, 0.0, 1.0);
        let ty = clamp(yf - j0 as f64, 0.0, 1.0);
        let width = self.nx + 1;
        let z00 = self.z_values[j0 * width + i0];
        let z10 = self.z_values[j0 * width + i1];
        let z01 = self.z_values[j1 * width + i0];
        let z11 = self.z_values[j1 * width + i1];
        if !finite(z00) || !finite(z10) || !finite(z01) || !finite(z11) {
            return None;
        }
        let bottom = z00 + (z10 - z00) * tx;
        let top = z01 + (z11 - z01) * tx;
        Some(bottom + (top - bottom) * ty)
    }

    fn point(&self, u: f64, v: f64) -> Option<V3> {
        let z = self.bilinear_z(u, v)?;
        Some(to_world(self.matrix, [u, v, z]))
    }
}

const SPHERE_FACES: [([f64; 3], [f64; 3], [f64; 3]); 6] = [
    ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
    ([-1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]),
    ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]),
    ([0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
    ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
    ([0.0, 0.0, -1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]),
];

enum PatchShape {
    Surface(SurfaceGrid),
    SphereFace {
        center: V3,
        radius: f64,
        direction: V3,
        axis_a: V3,
        axis_b: V3,
        matrix: Option<Mat4>,
    },
    BoxFace {
        center: V3,
        direction: V3,
        axis_a: V3,
        axis_b: V3,
        ar: f64,
        br: f64,
        hd: f64,
        matrix: Option<Mat4>,
    },
    ConicSide {
        center: V3,
        base_radius: f64,
        top_radius: f64,
        height: f64,
        matrix: Option<Mat4>,
    },
    ConicCap {
        center: V3,
        radius: f64,
        y_offset: f64,
        matrix: Option<Mat4>,
    },
}

struct PatchEval {
    u0: f64,
    u1: f64,
    v0: f64,
    v1: f64,
    shape: PatchShape,
}

impl PatchEval {
    fn point_valid(&self, u: f64, v: f64) -> (Option<V3>, bool) {
        match &self.shape {
            PatchShape::Surface(grid) => {
                let point = grid.point(u, v);
                (point, point.is_some())
            }
            PatchShape::SphereFace {
                center,
                radius,
                direction,
                axis_a,
                axis_b,
                matrix,
            } => {
                let length = (radius * radius + u * u + v * v).sqrt();
                let scale = radius / length;
                let mut local = [0.0; 3];
                for i in 0..3 {
                    local[i] =
                        center[i] + (direction[i] * radius + axis_a[i] * u + axis_b[i] * v) * scale;
                }
                (Some(to_world(*matrix, local)), true)
            }
            PatchShape::BoxFace {
                center,
                direction,
                axis_a,
                axis_b,
                ar,
                br,
                hd,
                matrix,
            } => {
                let mut local = [0.0; 3];
                for i in 0..3 {
                    local[i] = center[i] + direction[i] * hd + axis_a[i] * u + axis_b[i] * v;
                }
                let _ = (ar, br);
                (Some(to_world(*matrix, local)), true)
            }
            PatchShape::ConicSide {
                center,
                base_radius,
                top_radius,
                height,
                matrix,
            } => {
                let radius_at = base_radius + (top_radius - base_radius) * (v / height);
                let local = [
                    center[0] + radius_at * u.cos(),
                    center[1] + v - height * 0.5,
                    center[2] + radius_at * u.sin(),
                ];
                (Some(to_world(*matrix, local)), true)
            }
            PatchShape::ConicCap {
                center,
                radius,
                y_offset,
                matrix,
            } => {
                let valid = v >= 0.0 && v <= radius + 1e-9;
                if valid {
                    let local = [
                        center[0] + v * u.cos(),
                        center[1] + y_offset,
                        center[2] + v * u.sin(),
                    ];
                    (Some(to_world(*matrix, local)), true)
                } else {
                    (None, false)
                }
            }
        }
    }

    fn point(&self, u: f64, v: f64) -> Option<V3> {
        self.point_valid(u, v).0
    }
}

fn build_surface_patch(
    descriptor: &ObjectDescriptor,
    segments: usize,
) -> Result<PatchEval, String> {
    let grid = SurfaceGrid::new(descriptor, segments, segments)?;
    Ok(PatchEval {
        u0: grid.range[0],
        u1: grid.range[1],
        v0: grid.range[2],
        v1: grid.range[3],
        shape: PatchShape::Surface(grid),
    })
}

fn build_sphere_patches(descriptor: &ObjectDescriptor) -> Result<Vec<PatchEval>, String> {
    let center = [
        descriptor.params[0],
        descriptor.params[1],
        descriptor.params[2],
    ];
    let radius = descriptor.params[3];
    if radius.partial_cmp(&0.0) != Some(Ordering::Greater) {
        return Err("球体 radius 必须大于 0".to_string());
    }
    Ok(SPHERE_FACES
        .iter()
        .map(|(direction, axis_a, axis_b)| PatchEval {
            u0: -radius,
            u1: radius,
            v0: -radius,
            v1: radius,
            shape: PatchShape::SphereFace {
                center,
                radius,
                direction: *direction,
                axis_a: *axis_a,
                axis_b: *axis_b,
                matrix: descriptor.matrix,
            },
        })
        .collect())
}

fn build_box_patches(descriptor: &ObjectDescriptor) -> Result<Vec<PatchEval>, String> {
    let center = [
        descriptor.params[0],
        descriptor.params[1],
        descriptor.params[2],
    ];
    let half = [
        descriptor.params[3] * 0.5,
        descriptor.params[4] * 0.5,
        descriptor.params[5] * 0.5,
    ];
    if half.iter().any(|value| *value <= 0.0) {
        return Err("方块 size 每个分量都必须大于 0".to_string());
    }
    // 每项: 方向,u 轴,v 轴,u 半长,v 半长,法向偏移.
    let faces = [
        (
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            half[1],
            half[2],
            half[0],
        ),
        (
            [-1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, 1.0, 0.0],
            half[2],
            half[1],
            half[0],
        ),
        (
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0],
            half[2],
            half[0],
            half[1],
        ),
        (
            [0.0, -1.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0],
            half[0],
            half[2],
            half[1],
        ),
        (
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            half[0],
            half[1],
            half[2],
        ),
        (
            [0.0, 0.0, -1.0],
            [0.0, 1.0, 0.0],
            [1.0, 0.0, 0.0],
            half[1],
            half[0],
            half[2],
        ),
    ];
    Ok(faces
        .iter()
        .map(|(direction, axis_a, axis_b, ar, br, hd)| PatchEval {
            u0: -ar,
            u1: *ar,
            v0: -br,
            v1: *br,
            shape: PatchShape::BoxFace {
                center,
                direction: *direction,
                axis_a: *axis_a,
                axis_b: *axis_b,
                ar: *ar,
                br: *br,
                hd: *hd,
                matrix: descriptor.matrix,
            },
        })
        .collect())
}

fn build_conic_patches(descriptor: &ObjectDescriptor) -> Result<Vec<PatchEval>, String> {
    let center = [
        descriptor.params[0],
        descriptor.params[1],
        descriptor.params[2],
    ];
    let base_radius = descriptor.params[3];
    let top_radius = descriptor.params[4];
    let height = descriptor.params[5];
    if !(base_radius > 0.0 && height > 0.0) {
        return Err("旋转体 base/height 必须大于 0".to_string());
    }

    let mut patches = vec![PatchEval {
        u0: 0.0,
        u1: TAU,
        v0: 0.0,
        v1: height,
        shape: PatchShape::ConicSide {
            center,
            base_radius,
            top_radius,
            height,
            matrix: descriptor.matrix,
        },
    }];

    if base_radius > 1e-9 {
        patches.push(PatchEval {
            u0: 0.0,
            u1: TAU,
            v0: 0.0,
            v1: base_radius,
            shape: PatchShape::ConicCap {
                center,
                radius: base_radius,
                y_offset: -height * 0.5,
                matrix: descriptor.matrix,
            },
        });
    }
    if top_radius > 1e-9 {
        patches.push(PatchEval {
            u0: 0.0,
            u1: TAU,
            v0: 0.0,
            v1: top_radius,
            shape: PatchShape::ConicCap {
                center,
                radius: top_radius,
                y_offset: height * 0.5,
                matrix: descriptor.matrix,
            },
        });
    }
    Ok(patches)
}

fn build_patches(descriptor: &ObjectDescriptor, segments: usize) -> Result<Vec<PatchEval>, String> {
    match descriptor.kind {
        ObjectKind::Surface => Ok(vec![build_surface_patch(descriptor, segments)?]),
        ObjectKind::Sphere => build_sphere_patches(descriptor),
        ObjectKind::Box => build_box_patches(descriptor),
        ObjectKind::Conic => build_conic_patches(descriptor),
        ObjectKind::Curve => Err("曲线不能作为参数化面片".to_string()),
    }
}

// ================================================================
// 一维求根
// ================================================================

/// 采样 + 符号变化二分 + 相切采样点,返回参数位置.与旧 TS 一致.
fn find_1d_roots<F>(f: &mut F, lo: f64, hi: f64, steps: usize) -> Result<Vec<f64>, String>
where
    F: FnMut(f64) -> Result<Option<f64>, String>,
{
    let mut xs = Vec::with_capacity(steps + 1);
    let mut values = Vec::with_capacity(steps + 1);
    for i in 0..=steps {
        let x = lo + (hi - lo) * (i as f64 / steps as f64);
        xs.push(x);
        values.push(f(x)?);
    }

    let mut roots = Vec::new();
    for i in 0..steps {
        let f0 = values[i];
        let f1 = values[i + 1];
        if !finite_opt(f0) || !finite_opt(f1) {
            continue;
        }
        let f0 = f0.unwrap();
        let f1 = f1.unwrap();
        if f0 == 0.0 {
            roots.push(xs[i]);
            continue;
        }
        if f1 == 0.0 {
            roots.push(xs[i + 1]);
            continue;
        }
        if (f0 < 0.0) == (f1 < 0.0) {
            continue;
        }

        let mut lo_x = xs[i];
        let mut hi_x = xs[i + 1];
        let mut f_lo = f0;
        let mut f_hi = f1;
        let mut converged = false;
        for _ in 0..100 {
            let mid = (lo_x + hi_x) * 0.5;
            let fm = f(mid)?;
            let Some(fm) = fm.filter(|value| value.is_finite()) else {
                break;
            };
            if fm == 0.0 || fm.abs() < 1e-12 {
                roots.push(mid);
                converged = true;
                break;
            }
            if (fm < 0.0) == (f_lo < 0.0) {
                lo_x = mid;
                f_lo = fm;
            } else {
                hi_x = mid;
                f_hi = fm;
            }
            if hi_x - lo_x < 1e-11 * (1.0 + lo_x.abs()) {
                roots.push((lo_x + hi_x) * 0.5);
                converged = true;
                break;
            }
        }
        if !converged && (f_lo < 0.0) != (f_hi < 0.0) {
            roots.push((lo_x + hi_x) * 0.5);
        }
    }

    // 相切:采样点本身就在边界上但没有符号变化.
    for (i, value) in values.iter().enumerate() {
        let value = value.filter(|value| value.is_finite()).unwrap_or(f64::NAN);
        if value.abs() <= 1e-7 {
            roots.push(xs[i]);
        }
    }

    Ok(roots)
}

fn dedupe_points(points: Vec<V3>) -> Vec<V3> {
    let mut result: Vec<V3> = Vec::with_capacity(points.len());
    for point in points {
        if !result
            .iter()
            .any(|existing| dist(*existing, point) < POINT_DEDUP_TOLERANCE)
        {
            result.push(point);
        }
    }
    result
}

fn dedupe_roots(roots: Vec<f64>) -> Vec<f64> {
    let mut result: Vec<f64> = Vec::with_capacity(roots.len());
    for root in roots {
        if !result
            .iter()
            .any(|existing| (*existing - root).abs() < POINT_DEDUP_TOLERANCE)
        {
            result.push(root);
        }
    }
    result
}

// ================================================================
// 曲线 ∩ 曲线
// ================================================================

fn planar_curve_intersections(
    a: &ObjectDescriptor,
    b: &ObjectDescriptor,
    steps: usize,
) -> Result<Vec<V3>, String> {
    let mut curve_a = CurveEval::new(a)?;
    let mut curve_b = CurveEval::new(b)?;
    let lo = a.params[0].max(b.params[0]);
    let hi = a.params[1].min(b.params[1]);
    if lo.partial_cmp(&hi) != Some(Ordering::Less) {
        return Ok(Vec::new());
    }

    let roots = find_1d_roots(
        &mut |x| {
            let ya = curve_a.eval_y(x)?;
            let yb = curve_b.eval_y(x)?;
            match (ya, yb) {
                (Some(ya), Some(yb)) => Ok(Some(ya - yb)),
                _ => Ok(None),
            }
        },
        lo,
        hi,
        steps,
    )?;

    let mut points = Vec::with_capacity(roots.len());
    for x in dedupe_roots(roots) {
        if let Some(point) = curve_a.world_at(None, x)? {
            points.push(point);
        }
    }
    Ok(dedupe_points(points))
}

fn closest_point_on_segments(p1: V3, p2: V3, q1: V3, q2: V3) -> (f64, f64, f64) {
    let d1 = sub(p2, p1);
    let d2 = sub(q2, q1);
    let r = sub(p1, q1);
    let a = dot(d1, d1);
    let e = dot(d2, d2);
    let f = dot(d2, r);
    let eps = 1e-14;

    let (mut t, mut s);
    if a <= eps && e <= eps {
        t = 0.0;
        s = 0.0;
    } else if a <= eps {
        t = 0.0;
        s = clamp(f / e, 0.0, 1.0);
    } else {
        let c = dot(d1, r);
        if e <= eps {
            s = 0.0;
            t = clamp(-c / a, 0.0, 1.0);
        } else {
            let b = dot(d1, d2);
            let denom = a * e - b * b;
            t = if denom > eps {
                clamp((b * f - c * e) / denom, 0.0, 1.0)
            } else {
                0.0
            };
            s = (b * t + f) / e;
            if s < 0.0 {
                s = 0.0;
                t = clamp(-c / a, 0.0, 1.0);
            } else if s > 1.0 {
                s = 1.0;
                t = clamp((b - c) / a, 0.0, 1.0);
            }
        }
    }

    let cp1 = [p1[0] + d1[0] * t, p1[1] + d1[1] * t, p1[2] + d1[2] * t];
    let cp2 = [q1[0] + d2[0] * s, q1[1] + d2[1] * s, q1[2] + d2[2] * s];
    let d2 = (cp1[0] - cp2[0]).powi(2) + (cp1[1] - cp2[1]).powi(2) + (cp1[2] - cp2[2]).powi(2);
    (d2, t, s)
}

fn refine_space_curve_pair(
    a: &ObjectDescriptor,
    b: &ObjectDescriptor,
    curve_a: &mut CurveEval,
    curve_b: &mut CurveEval,
    t0: f64,
    s0: f64,
) -> Result<Option<V3>, String> {
    let t = clamp(t0, a.params[0], a.params[1]);
    let s = clamp(s0, b.params[0], b.params[1]);
    let mut pa = match curve_a.world_at(a.matrix, t)? {
        Some(point) => point,
        None => return Ok(None),
    };
    let mut pb = match curve_b.world_at(b.matrix, s)? {
        Some(point) => point,
        None => return Ok(None),
    };

    let mut t = t;
    let mut s = s;
    for _ in 0..40 {
        let r = sub(pa, pb);
        let r2 = dot(r, r);
        if r2 < 1e-16 {
            return Ok(Some(midpoint(pa, pb)));
        }

        let h = 1e-6;
        let pa_p = curve_a.world_at(a.matrix, t + h)?;
        let pa_m = curve_a.world_at(a.matrix, t - h)?;
        let pb_p = curve_b.world_at(b.matrix, s + h)?;
        let pb_m = curve_b.world_at(b.matrix, s - h)?;
        let (Some(pa_p), Some(pa_m), Some(pb_p), Some(pb_m)) = (pa_p, pa_m, pb_p, pb_m) else {
            break;
        };

        let dpa = [
            (pa_p[0] - pa_m[0]) / (2.0 * h),
            (pa_p[1] - pa_m[1]) / (2.0 * h),
            (pa_p[2] - pa_m[2]) / (2.0 * h),
        ];
        let dpb = [
            (pb_p[0] - pb_m[0]) / (2.0 * h),
            (pb_p[1] - pb_m[1]) / (2.0 * h),
            (pb_p[2] - pb_m[2]) / (2.0 * h),
        ];

        let a00 = dot(dpa, dpa);
        let a01 = -dot(dpa, dpb);
        let a11 = dot(dpb, dpb);
        let b0 = -dot(dpa, r);
        let b1 = dot(dpb, r);
        let det = a00 * a11 - a01 * a01;
        if det.abs() < 1e-18 {
            break;
        }

        let dt = (b0 * a11 - a01 * b1) / det;
        let ds = (a00 * b1 - a01 * b0) / det;
        t = clamp(t + dt, a.params[0], a.params[1]);
        s = clamp(s + ds, b.params[0], b.params[1]);
        if dt.abs() < 1e-12 && ds.abs() < 1e-12 {
            break;
        }

        match (
            curve_a.world_at(a.matrix, t)?,
            curve_b.world_at(b.matrix, s)?,
        ) {
            (Some(next_pa), Some(next_pb)) => {
                pa = next_pa;
                pb = next_pb;
            }
            _ => break,
        }
    }

    let r = sub(pa, pb);
    if dot(r, r) < 1e-12 {
        Ok(Some(midpoint(pa, pb)))
    } else {
        Ok(None)
    }
}

fn space_curve_intersections(
    a: &ObjectDescriptor,
    b: &ObjectDescriptor,
    steps: usize,
) -> Result<Vec<V3>, String> {
    let mut curve_a = CurveEval::new(a)?;
    let mut curve_b = CurveEval::new(b)?;
    let samples_a = sample_curve(&mut curve_a, a.matrix, steps)?;
    let samples_b = sample_curve(&mut curve_b, b.matrix, steps)?;
    if samples_a.len() < 2 || samples_b.len() < 2 {
        return Ok(Vec::new());
    }

    let mut max_step: f64 = 1e-6;
    for pair in samples_a.windows(2) {
        max_step = max_step.max(dist(pair[0].1, pair[1].1));
    }
    for pair in samples_b.windows(2) {
        max_step = max_step.max(dist(pair[0].1, pair[1].1));
    }
    let seed_tolerance = max_step.max(1e-6) * 2.0;

    let mut results: Vec<V3> = Vec::new();
    for pair_a in samples_a.windows(2) {
        for pair_b in samples_b.windows(2) {
            let (d2, t_local, s_local) =
                closest_point_on_segments(pair_a[0].1, pair_a[1].1, pair_b[0].1, pair_b[1].1);
            if d2 > seed_tolerance * seed_tolerance {
                continue;
            }
            let t = pair_a[0].0 + (pair_a[1].0 - pair_a[0].0) * t_local;
            let s = pair_b[0].0 + (pair_b[1].0 - pair_b[0].0) * s_local;
            if let Some(point) = refine_space_curve_pair(a, b, &mut curve_a, &mut curve_b, t, s)? {
                if !results
                    .iter()
                    .any(|existing| dist(*existing, point) < POINT_DEDUP_TOLERANCE)
                {
                    results.push(point);
                }
            }
        }
    }
    Ok(results)
}

fn curve_curve_intersections(
    a: &ObjectDescriptor,
    b: &ObjectDescriptor,
    steps: usize,
) -> Result<Vec<V3>, String> {
    if a.matrix.is_none() && b.matrix.is_none() {
        planar_curve_intersections(a, b, steps)
    } else {
        space_curve_intersections(a, b, steps)
    }
}

// ================================================================
// 曲线 ∩ 隐式场
// ================================================================

fn curve_field_intersections(
    curve: &ObjectDescriptor,
    field: &ObjectDescriptor,
    steps: usize,
) -> Result<Vec<V3>, String> {
    let mut curve_eval = CurveEval::new(curve)?;
    let mut field_eval = FieldEval::new(field)?;
    let range = [curve.params[0], curve.params[1]];
    let roots = find_1d_roots(
        &mut |x| {
            let world = match curve_eval.world_at(curve.matrix, x)? {
                Some(world) => world,
                None => return Ok(None),
            };
            field_eval.eval(world)
        },
        range[0],
        range[1],
        steps,
    )?;

    let mut points = Vec::with_capacity(roots.len());
    for x in dedupe_roots(roots) {
        if let Some(point) = curve_eval.world_at(curve.matrix, x)? {
            points.push(point);
        }
    }
    Ok(dedupe_points(points))
}

// ================================================================
// marching squares 等值线
// ================================================================

fn trace_contours(
    patch: &PatchEval,
    field: &mut FieldEval,
    nu: usize,
    nv: usize,
) -> Result<Vec<Vec<V3>>, String> {
    let grid_width = nu + 1;
    let mut values = vec![f64::NAN; grid_width * (nv + 1)];
    let mut valid_flags = vec![false; grid_width * (nv + 1)];

    for j in 0..=nv {
        let v = patch.v0 + ((patch.v1 - patch.v0) * j as f64) / nv as f64;
        for i in 0..=nu {
            let u = patch.u0 + ((patch.u1 - patch.u0) * i as f64) / nu as f64;
            let index = j * grid_width + i;
            let (point, point_valid) = patch.point_valid(u, v);
            let f = match point {
                Some(point) => field.eval(point)?,
                None => None,
            };
            let f = f.unwrap_or(f64::NAN);
            let ok = point_valid && finite(f);
            values[index] = f;
            valid_flags[index] = ok;
        }
    }

    let mut points: Vec<V3> = Vec::new();
    let mut pool: HashMap<(i64, i64, i64), u32> = HashMap::new();
    let mut vertex_id = |u: f64, v: f64| -> Option<u32> {
        let p = patch.point(u, v)?;
        let key = (
            (p[0] * VERTEX_QUANTUM).round() as i64,
            (p[1] * VERTEX_QUANTUM).round() as i64,
            (p[2] * VERTEX_QUANTUM).round() as i64,
        );
        Some(match pool.get(&key) {
            Some(id) => *id,
            None => {
                let id = points.len() as u32;
                pool.insert(key, id);
                points.push(p);
                id
            }
        })
    };

    let mut segments: Vec<(u32, u32)> = Vec::new();
    for j in 0..nv {
        for i in 0..nu {
            let i_a = j * grid_width + i;
            let i_b = j * grid_width + i + 1;
            let i_c = (j + 1) * grid_width + i + 1;
            let i_d = (j + 1) * grid_width + i;
            if !valid_flags[i_a] || !valid_flags[i_b] || !valid_flags[i_c] || !valid_flags[i_d] {
                continue;
            }

            let v_a = values[i_a];
            let v_b = values[i_b];
            let v_c = values[i_c];
            let v_d = values[i_d];
            let neg_a = v_a < 0.0;
            let neg_b = v_b < 0.0;
            let neg_c = v_c < 0.0;
            let neg_d = v_d < 0.0;

            let u0 = patch.u0 + ((patch.u1 - patch.u0) * i as f64) / nu as f64;
            let u1 = patch.u0 + ((patch.u1 - patch.u0) * (i + 1) as f64) / nu as f64;
            let v0 = patch.v0 + ((patch.v1 - patch.v0) * j as f64) / nv as f64;
            let v1 = patch.v0 + ((patch.v1 - patch.v0) * (j + 1) as f64) / nv as f64;

            let mut crossings: Vec<Crossing> = Vec::with_capacity(4);
            let mut add_crossing = |fa: f64, fb: f64, ua: f64, va: f64, ub: f64, vb: f64| {
                if fa == 0.0 && fb == 0.0 {
                    return;
                }
                if fa == 0.0 {
                    crossings.push(Crossing { u: ua, v: va });
                    return;
                }
                if fb == 0.0 {
                    crossings.push(Crossing { u: ub, v: vb });
                    return;
                }
                if (fa < 0.0) == (fb < 0.0) {
                    return;
                }
                let t = fa / (fa - fb);
                crossings.push(Crossing {
                    u: ua + (ub - ua) * t,
                    v: va + (vb - va) * t,
                });
            };

            add_crossing(v_a, v_b, u0, v0, u1, v0);
            add_crossing(v_b, v_c, u1, v0, u1, v1);
            add_crossing(v_c, v_d, u1, v1, u0, v1);
            add_crossing(v_d, v_a, u0, v1, u0, v0);

            if crossings.len() == 2 {
                push_segment(&mut vertex_id, &mut segments, crossings[0], crossings[1]);
            } else if crossings.len() == 4 {
                let center_neg = (v_a + v_b + v_c + v_d) * 0.25 < 0.0;
                if neg_a == neg_c && neg_b == neg_d && neg_a != neg_b {
                    if neg_a == center_neg {
                        push_segment(&mut vertex_id, &mut segments, crossings[0], crossings[1]);
                        push_segment(&mut vertex_id, &mut segments, crossings[2], crossings[3]);
                    } else {
                        push_segment(&mut vertex_id, &mut segments, crossings[0], crossings[3]);
                        push_segment(&mut vertex_id, &mut segments, crossings[1], crossings[2]);
                    }
                } else {
                    push_segment(&mut vertex_id, &mut segments, crossings[0], crossings[1]);
                    push_segment(&mut vertex_id, &mut segments, crossings[2], crossings[3]);
                }
            }
        }
    }

    let chains = chain_segments(&segments);
    let mut contours = Vec::with_capacity(chains.len());
    for chain in chains {
        if chain.len() >= 2 {
            let contour: Vec<V3> = chain.into_iter().map(|id| points[id as usize]).collect();
            contours.push(contour);
        }
    }
    Ok(contours)
}

fn push_segment(
    vertex_id: &mut impl FnMut(f64, f64) -> Option<u32>,
    segments: &mut Vec<(u32, u32)>,
    first: Crossing,
    second: Crossing,
) {
    if let (Some(first), Some(second)) =
        (vertex_id(first.u, first.v), vertex_id(second.u, second.v))
    {
        segments.push((first, second));
    }
}

fn chain_segments(segments: &[(u32, u32)]) -> Vec<Vec<u32>> {
    let mut adjacency: HashMap<u32, Vec<(u32, usize)>> = HashMap::new();
    for (id, (a, b)) in segments.iter().enumerate() {
        adjacency.entry(*a).or_default().push((*b, id));
        adjacency.entry(*b).or_default().push((*a, id));
    }

    let mut used = vec![false; segments.len()];
    let mut chains: Vec<Vec<u32>> = Vec::new();
    for id in 0..segments.len() {
        if used[id] {
            continue;
        }
        used[id] = true;
        let mut tail = segments[id].0;
        let mut head = segments[id].1;
        let mut chain = vec![tail, head];

        let mut extended = true;
        while extended {
            extended = false;
            if let Some(edges) = adjacency.get(&head) {
                for (other, edge_id) in edges {
                    if used[*edge_id] {
                        continue;
                    }
                    if *other == chain[0] && chain.len() > 2 {
                        used[*edge_id] = true;
                        chain.push(*other);
                        extended = true;
                        break;
                    }
                    used[*edge_id] = true;
                    chain.push(*other);
                    head = *other;
                    extended = true;
                    break;
                }
            }
            if extended {
                continue;
            }
            if let Some(edges) = adjacency.get(&tail) {
                for (other, edge_id) in edges {
                    if used[*edge_id] {
                        continue;
                    }
                    used[*edge_id] = true;
                    chain.insert(0, *other);
                    tail = *other;
                    extended = true;
                    break;
                }
            }
        }
        chains.push(chain);
    }
    chains
}

fn patch_field_intersections(
    patch: &ObjectDescriptor,
    field: &ObjectDescriptor,
    segments: usize,
) -> Result<Vec<Vec<V3>>, String> {
    let mut field_eval = FieldEval::new(field)?;
    let patches = build_patches(patch, segments)?;
    let mut contours = Vec::new();
    for patch_eval in &patches {
        contours.extend(trace_contours(
            patch_eval,
            &mut field_eval,
            segments,
            segments,
        )?);
    }
    Ok(contours)
}

// ================================================================
// 顶层入口
// ================================================================

#[derive(Debug, Default, Clone)]
pub struct IntersectionCoreOutput {
    /// 离散交点,扁平 `[x, y, z, ...]`.
    pub points: Vec<f64>,
    /// 交线折线点,扁平 `[x, y, z, ...]`.
    pub curve_points: Vec<f64>,
    /// 每条折线在 `curve_points` 里的起始下标,末尾追加总长.
    pub curve_offsets: Vec<u32>,
}

impl IntersectionCoreOutput {
    fn from_points(points: Vec<V3>) -> Self {
        let mut flat = Vec::with_capacity(points.len() * 3);
        for point in points {
            flat.extend_from_slice(&point);
        }
        Self {
            points: flat,
            ..Self::default()
        }
    }

    fn from_contours(contours: Vec<Vec<V3>>) -> Self {
        let mut curve_points = Vec::new();
        let mut curve_offsets = Vec::with_capacity(contours.len() + 1);
        curve_offsets.push(0);
        for contour in contours {
            for point in contour {
                curve_points.extend_from_slice(&point);
            }
            curve_offsets.push(curve_points.len() as u32 / 3);
        }
        Self {
            points: Vec::new(),
            curve_points,
            curve_offsets,
        }
    }
}

/// 计算两个对象描述符的交集,组合语义为:
/// 曲线参与 -> 离散交点;曲面/体积参与 -> 空间交线.
/// 非曲线组合的面片侧选择见 [`choose_patch_field_pair`].
pub fn compute_pair(
    a: &ObjectDescriptor,
    b: &ObjectDescriptor,
    segments: usize,
) -> Result<IntersectionCoreOutput, String> {
    if segments == 0 {
        return Err("求交 segments 必须大于 0".to_string());
    }
    match (a.kind, b.kind) {
        (ObjectKind::Curve, ObjectKind::Curve) => Ok(IntersectionCoreOutput::from_points(
            curve_curve_intersections(a, b, segments)?,
        )),
        (ObjectKind::Curve, _) => Ok(IntersectionCoreOutput::from_points(
            curve_field_intersections(a, b, segments)?,
        )),
        (_, ObjectKind::Curve) => Ok(IntersectionCoreOutput::from_points(
            curve_field_intersections(b, a, segments)?,
        )),
        _ => {
            let (patch, field) = choose_patch_field_pair(a, b);
            Ok(IntersectionCoreOutput::from_contours(
                patch_field_intersections(patch, field, segments)?,
            ))
        }
    }
}

/// 让"曲面/体积组合"的计算结果不依赖 DSL 参数顺序.
///
/// 规则:
/// - 曲面 + 体积:体积表面是精确参数化,曲面用隐式场精确求值,因此体积做
///   面片侧更稳(旧实现固定第一个对象做面片,会因顺序差 6 倍工作量并引入
///   曲面双线性近似误差);
/// - 体积 + 体积:双方都精确,选面片数少的一侧,减少重复扫描;
/// - 曲面 + 曲面:保持第一个对象为面片(两边的离散化误差同级,无全局更优).
fn choose_patch_field_pair<'a>(
    a: &'a ObjectDescriptor,
    b: &'a ObjectDescriptor,
) -> (&'a ObjectDescriptor, &'a ObjectDescriptor) {
    let patch_count = |kind: ObjectKind| match kind {
        ObjectKind::Conic => 3,
        ObjectKind::Surface => 1,
        ObjectKind::Curve => 0,
        ObjectKind::Sphere | ObjectKind::Box => 6,
    };

    let a_is_surface = a.kind == ObjectKind::Surface;
    let b_is_surface = b.kind == ObjectKind::Surface;
    if a_is_surface != b_is_surface {
        // 曲面/体积组合:体积做面片.
        if a_is_surface {
            (b, a)
        } else {
            (a, b)
        }
    } else if !a_is_surface && !b_is_surface && patch_count(b.kind) < patch_count(a.kind) {
        (b, a)
    } else {
        (a, b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn curve_descriptor(expr: &str, range: [f64; 2]) -> ObjectDescriptor {
        parse_object_descriptor(
            "curve",
            expr,
            vec![],
            vec![],
            range.to_vec(),
            vec![],
            vec![],
        )
        .unwrap()
    }

    fn surface_descriptor(expr: &str, range: [f64; 4]) -> ObjectDescriptor {
        parse_object_descriptor(
            "surface",
            expr,
            vec![],
            vec![],
            range.to_vec(),
            vec![],
            vec![],
        )
        .unwrap()
    }

    fn sphere_descriptor(center: [f64; 3], radius: f64) -> ObjectDescriptor {
        let params = [center[0], center[1], center[2], radius];
        parse_object_descriptor(
            "sphere",
            "",
            vec![],
            vec![],
            params.to_vec(),
            vec![],
            vec![],
        )
        .unwrap()
    }

    fn box_descriptor(center: [f64; 3], size: [f64; 3]) -> ObjectDescriptor {
        let params = [center[0], center[1], center[2], size[0], size[1], size[2]];
        parse_object_descriptor("box", "", vec![], vec![], params.to_vec(), vec![], vec![]).unwrap()
    }

    fn points_of(output: &IntersectionCoreOutput) -> Vec<[f64; 3]> {
        output
            .points
            .as_chunks::<3>()
            .0
            .iter()
            .map(|chunk| [chunk[0], chunk[1], chunk[2]])
            .collect()
    }

    #[test]
    fn planar_curves_cross_at_expected_x() {
        let a = curve_descriptor("x", [-2.0, 2.0]);
        let b = curve_descriptor("-x + 2", [-2.0, 2.0]);
        let output = compute_pair(&a, &b, 64).unwrap();
        let points = points_of(&output);
        assert_eq!(points.len(), 1);
        assert!((points[0][0] - 1.0).abs() < 1e-4);
        assert!((points[0][1] - 1.0).abs() < 1e-4);
    }

    #[test]
    fn curve_pierces_surface() {
        let curve = curve_descriptor("x", [-2.0, 2.0]);
        let surface = surface_descriptor("y", [-2.0, 2.0, -2.0, 2.0]);
        let output = compute_pair(&curve, &surface, 64).unwrap();
        let points = points_of(&output);
        assert_eq!(points.len(), 1);
        assert!(points[0][0].abs() < 1e-3);
        assert!(points[0][1].abs() < 1e-3);
    }

    #[test]
    fn curve_crosses_sphere_twice() {
        let curve = curve_descriptor("x", [-2.0, 2.0]);
        let sphere = sphere_descriptor([0.0, 0.0, 0.0], 1.0);
        let output = compute_pair(&curve, &sphere, 128).unwrap();
        let points = points_of(&output);
        assert_eq!(points.len(), 2);
        let mut xs: Vec<f64> = points.iter().map(|point| point[0]).collect();
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert!((xs[0] + 1.0 / 2.0f64.sqrt()).abs() < 1e-2);
        assert!((xs[1] - 1.0 / 2.0f64.sqrt()).abs() < 1e-2);
    }

    #[test]
    fn two_surfaces_produce_contour() {
        let a = surface_descriptor("0", [-2.0, 2.0, -2.0, 2.0]);
        let b = surface_descriptor("x", [-2.0, 2.0, -2.0, 2.0]);
        let output = compute_pair(&a, &b, 32).unwrap();
        assert!(output.curve_offsets.len() >= 2);
        assert!(output.curve_points.len() >= 16 * 3);
        for chunk in output.curve_points.as_chunks::<3>().0 {
            assert!(chunk[0].abs() < 0.03);
            assert!(chunk[2].abs() < 1e-9);
        }
    }

    #[test]
    fn plane_cuts_sphere_in_circle() {
        let sphere = sphere_descriptor([0.0, 0.0, 0.0], 1.0);
        let surface = surface_descriptor("0", [-1.5, 1.5, -1.5, 1.5]);
        let output = compute_pair(&sphere, &surface, 32).unwrap();
        assert!(output.curve_offsets.len() >= 2);
        for chunk in output.curve_points.as_chunks::<3>().0 {
            let rho = (chunk[0] * chunk[0] + chunk[1] * chunk[1]).sqrt();
            assert!((rho - 1.0).abs() < 0.1);
            assert!(chunk[2].abs() < 1e-6);
        }
    }

    #[test]
    fn sphere_box_crossing_produces_closed_contours() {
        let sphere = sphere_descriptor([0.0, 0.0, 0.0], 1.5);
        let box_obj = box_descriptor([0.0, 0.0, 0.0], [2.0, 2.0, 2.0]);
        let output = compute_pair(&sphere, &box_obj, 32).unwrap();
        assert!(output.curve_offsets.len() >= 5);
        for chunk in output.curve_points.as_chunks::<3>().0 {
            assert!(
                (chunk[0].powi(2) + chunk[1].powi(2) + chunk[2].powi(2))
                    .sqrt()
                    .abs()
                    - 1.5
                    < 0.2
            );
            assert!((chunk[0].abs().max(chunk[1].abs()).max(chunk[2].abs()) - 1.0).abs() < 0.2);
        }
    }

    #[test]
    fn surface_volume_order_does_not_change_result() {
        let sphere = sphere_descriptor([0.0, 0.0, 0.0], 1.0);
        let surface = surface_descriptor("0", [-1.5, 1.5, -1.5, 1.5]);
        let first = compute_pair(&sphere, &surface, 32).unwrap();
        let second = compute_pair(&surface, &sphere, 32).unwrap();
        assert_eq!(first.curve_offsets, second.curve_offsets);
        assert_eq!(first.curve_points, second.curve_points);
    }

    #[test]
    fn transform_translates_curve_intersection() {
        let mut matrix = [0.0; 16];
        matrix[0] = 1.0;
        matrix[5] = 1.0;
        matrix[10] = 1.0;
        matrix[15] = 1.0;
        matrix[3] = 0.0;
        matrix[7] = 1.0;
        let curve = parse_object_descriptor(
            "curve",
            "x",
            vec![],
            vec![],
            vec![-2.0, 2.0],
            matrix.to_vec(),
            matrix.to_vec(),
        )
        .unwrap();
        let surface = surface_descriptor("y", [-2.0, 2.0, -2.0, 2.0]);
        let output = compute_pair(&curve, &surface, 64).unwrap();
        let points = points_of(&output);
        assert_eq!(points.len(), 1);
        assert!((points[0][0] + 1.0).abs() < 1e-3);
        assert!(points[0][1].abs() < 1e-3);
    }
}
