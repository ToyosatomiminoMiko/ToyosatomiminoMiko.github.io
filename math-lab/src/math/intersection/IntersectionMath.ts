/**
 * 求交数值引擎.
 *
 * 求交统一用"一侧参数化、另一侧隐式场"的模型:
 * - 曲线作为一维参数化对象,另一侧(曲面/体积)提供隐式场,在一维参数上求根;
 * - 曲面/体积作为二维参数化面片,另一侧提供隐式场,在面片网格上做等值线追踪.
 *
 * 所有坐标都是世界坐标(已计入对象静态 transform).
 */
import type {
    BoxObject,
    Coefficient,
    ConicSolidObject,
    CurveObject,
    SceneObject,
    SphereObject,
    SurfaceObject,
    Vec3,
} from '../../compiler/ir/types';
import { evaluateScalarAt } from '../../compiler/dsl/expression';
import {
    sample_curve as wasmSampleCurve,
    sample_surface_values as wasmSampleSurfaceValues,
} from '../../wasm/math_rs/math_rs';
import { NUMERIC_CONFIG } from '../../config/numericConfig';

export type Mat4 = number[][];

/** 隐式场:world 点 -> 标量,0 表示在对象边界上. */
export type FieldFn = (world: Vec3) => number;

export interface CurveSample {
    t: number;
    local: Vec3;
    world: Vec3;
}

/**
 * 二维参数化面片.
 *
 * 曲面(单面片)和体积(球体 6 个立方体面片/方块 6 个面/旋转体 3 个面)
 * 都描述为 (u, v) -> world 点;`wrapU` 表示 u 方向首尾相接(例如旋转体的角度).
 */
export interface ParamPatch {
    u0: number;
    u1: number;
    v0: number;
    v1: number;
    wrapU: boolean;
    valid(u: number, v: number): boolean;
    point(u: number, v: number): Vec3;
}

const TAU = Math.PI * 2;

// ================================================================
// 矩阵与向量工具
// ================================================================

export function applyMat4(m: Mat4 | null, p: Vec3): Vec3 {
    if (!m) return p;
    return {
        x: m[0][0] * p.x + m[0][1] * p.y + m[0][2] * p.z + m[0][3],
        y: m[1][0] * p.x + m[1][1] * p.y + m[1][2] * p.z + m[1][3],
        z: m[2][0] * p.x + m[2][1] * p.y + m[2][2] * p.z + m[2][3],
    };
}

/** 4x4 行主序矩阵求逆;不可逆时返回 null. */
export function invertMat4(m: Mat4): Mat4 | null {
    const a = m.map((row) => [...row]);
    const inv: Mat4 = [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
    ];

    for (let col = 0; col < 4; col += 1) {
        let pivot = col;
        for (let row = col + 1; row < 4; row += 1) {
            if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) {
                pivot = row;
            }
        }
        if (Math.abs(a[pivot][col]) < 1e-12) return null;
        if (pivot !== col) {
            [a[pivot], a[col]] = [a[col], a[pivot]];
            [inv[pivot], inv[col]] = [inv[col], inv[pivot]];
        }

        const scale = a[col][col];
        for (let k = 0; k < 4; k += 1) {
            a[col][k] /= scale;
            inv[col][k] /= scale;
        }
        for (let row = 0; row < 4; row += 1) {
            if (row === col) continue;
            const factor = a[row][col];
            if (factor === 0) continue;
            for (let k = 0; k < 4; k += 1) {
                a[row][k] -= factor * a[col][k];
                inv[row][k] -= factor * inv[col][k];
            }
        }
    }
    return inv;
}

function sub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function dist(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function clamp(value: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, value));
}

function dedupePoints(points: Vec3[], tolerance: number): Vec3[] {
    const result: Vec3[] = [];
    for (const point of points) {
        if (!result.some((existing) => dist(existing, point) < tolerance)) {
            result.push(point);
        }
    }
    return result;
}

// ================================================================
// 表达式求值与曲线采样
// ================================================================

function coefficientScope(source: { coefficients: readonly Coefficient[] }): Record<string, number> {
    const scope: Record<string, number> = {};
    for (const coefficient of source.coefficients) {
        scope[coefficient.name] = coefficient.value;
    }
    return scope;
}

function curveYAt(curve: CurveObject, x: number): number | null {
    return evaluateScalarAt(curve.expr, coefficientScope(curve), x, Number.NaN, Number.NaN);
}

function curveWorldAt(curve: CurveObject, m: Mat4 | null, t: number): Vec3 | null {
    const y = curveYAt(curve, t);
    if (y === null || !Number.isFinite(y)) return null;
    return applyMat4(m, { x: t, y, z: 0 });
}

/** 用 wasm 批量采样曲线的本地点,再变换到世界坐标. */
export function sampleCurvePoints(
    curve: CurveObject,
    m: Mat4 | null,
    steps: number,
): CurveSample[] {
    const range = curve.range ?? NUMERIC_CONFIG.curve.defaultRange;
    const names = curve.coefficients.map((coefficient) => coefficient.name);
    const values = new Float64Array(curve.coefficients.map((coefficient) => coefficient.value));
    const raw = wasmSampleCurve(curve.expr, names, values, range[0], range[1], steps);

    const samples: CurveSample[] = [];
    for (let i = 0; i + 2 < raw.length; i += 3) {
        const x = raw[i];
        const y = raw[i + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const local: Vec3 = { x, y, z: 0 };
        samples.push({ t: x, local, world: applyMat4(m, local) });
    }
    return samples;
}

/** 用 wasm 批量采样曲面 z = f(x, y),返回行优先的 (nx+1)*(ny+1) 个值. */
export function sampleSurfaceGrid(
    surface: SurfaceObject,
    nx: number,
    ny: number,
): ArrayLike<number> {
    const [xa, xb, ya, yb] = surface.range;
    const names = surface.coefficients.map((coefficient) => coefficient.name);
    const values = new Float64Array(surface.coefficients.map((coefficient) => coefficient.value));
    return wasmSampleSurfaceValues(surface.expr, names, values, xa, xb, ya, yb, nx, ny);
}

// ================================================================
// 隐式场
// ================================================================

/**
 * 构建对象的隐式场.
 *
 * 各对象约定:场在边界上为 0,内部为负,外部为正.
 * 曲面:z - f(x, y);球体:|p-c| - r;方块:max(|dx|, |dy|, |dz|);
 * 旋转体:max(ρ - r(y), 底平面, 顶平面).
 */
export function buildField(source: SceneObject, invM: Mat4 | null): FieldFn {
    const toLocal = (world: Vec3): Vec3 => (invM ? applyMat4(invM, world) : world);

    switch (source.kind) {
        case 'surface': {
            const scope = coefficientScope(source);
            const expr = source.expr;
            const [xa, xb, ya, yb] = source.range;
            return (world) => {
                const q = toLocal(world);
                if (q.x < xa || q.x > xb || q.y < ya || q.y > yb) {
                    return Number.NaN;
                }
                const z = evaluateScalarAt(expr, scope, q.x, q.y, Number.NaN);
                return z === null ? Number.NaN : q.z - z;
            };
        }

        case 'sphere': {
            const { position, radius } = source;
            return (world) => {
                const q = toLocal(world);
                return (
                    Math.hypot(
                        q.x - position.x,
                        q.y - position.y,
                        q.z - position.z,
                    ) - radius
                );
            };
        }

        case 'box': {
            const { position, size } = source;
            const half = [size[0] / 2, size[1] / 2, size[2] / 2];
            return (world) => {
                const q = toLocal(world);
                return Math.max(
                    Math.abs(q.x - position.x) - half[0],
                    Math.abs(q.y - position.y) - half[1],
                    Math.abs(q.z - position.z) - half[2],
                );
            };
        }

        case 'conic': {
            const { position, baseRadius, topRadius, height } = source;
            const halfHeight = height / 2;
            return (world) => {
                const q = toLocal(world);
                const dy = q.y - position.y;
                const rho = Math.hypot(q.x - position.x, q.z - position.z);
                const radiusAt =
                    baseRadius + (topRadius - baseRadius) * ((dy + halfHeight) / height);
                return Math.max(
                    rho - radiusAt,
                    -(dy + halfHeight),
                    dy - halfHeight,
                );
            };
        }

        default:
            throw new Error(`求交不支持对象类型 ${source.kind}`);
    }
}

// ================================================================
// 参数化面片
// ================================================================

function bilinearZ(
    zValues: ArrayLike<number>,
    nx: number,
    ny: number,
    u: number,
    v: number,
    xa: number,
    xb: number,
    ya: number,
    yb: number,
): number {
    const xf = ((u - xa) / (xb - xa)) * nx;
    const yf = ((v - ya) / (yb - ya)) * ny;
    const i0 = clamp(Math.floor(xf), 0, nx - 1);
    const j0 = clamp(Math.floor(yf), 0, ny - 1);
    const i1 = Math.min(i0 + 1, nx);
    const j1 = Math.min(j0 + 1, ny);
    const tx = clamp(xf - i0, 0, 1);
    const ty = clamp(yf - j0, 0, 1);

    const z00 = zValues[j0 * (nx + 1) + i0];
    const z10 = zValues[j0 * (nx + 1) + i1];
    const z01 = zValues[j1 * (nx + 1) + i0];
    const z11 = zValues[j1 * (nx + 1) + i1];
    if (
        !Number.isFinite(z00)
        || !Number.isFinite(z10)
        || !Number.isFinite(z01)
        || !Number.isFinite(z11)
    ) {
        return Number.NaN;
    }
    const bottom = z00 + (z10 - z00) * tx;
    const top = z01 + (z11 - z01) * tx;
    return bottom + (top - bottom) * ty;
}

/** 曲面对象就是一张 (x, y) -> z 的矩形面片. */
export function buildSurfacePatch(
    surface: SurfaceObject,
    m: Mat4 | null,
    zValues: ArrayLike<number>,
    nx: number,
    ny: number,
): ParamPatch {
    const [xa, xb, ya, yb] = surface.range;
    const point = (u: number, v: number): Vec3 => {
        const z = bilinearZ(zValues, nx, ny, u, v, xa, xb, ya, yb);
        return applyMat4(m, { x: u, y: v, z });
    };
    return {
        u0: xa,
        u1: xb,
        v0: ya,
        v1: yb,
        wrapU: false,
        valid: (u, v) => Number.isFinite(bilinearZ(zValues, nx, ny, u, v, xa, xb, ya, yb)),
        point,
    };
}

type SolidObject = SphereObject | BoxObject | ConicSolidObject;

const SPHERE_FACES: Array<{ d: Vec3; a: Vec3; b: Vec3 }> = [
    { d: { x: 1, y: 0, z: 0 }, a: { x: 0, y: 1, z: 0 }, b: { x: 0, y: 0, z: 1 } },
    { d: { x: -1, y: 0, z: 0 }, a: { x: 0, y: 0, z: 1 }, b: { x: 0, y: 1, z: 0 } },
    { d: { x: 0, y: 1, z: 0 }, a: { x: 0, y: 0, z: 1 }, b: { x: 1, y: 0, z: 0 } },
    { d: { x: 0, y: -1, z: 0 }, a: { x: 1, y: 0, z: 0 }, b: { x: 0, y: 0, z: 1 } },
    { d: { x: 0, y: 0, z: 1 }, a: { x: 1, y: 0, z: 0 }, b: { x: 0, y: 1, z: 0 } },
    { d: { x: 0, y: 0, z: -1 }, a: { x: 0, y: 1, z: 0 }, b: { x: 1, y: 0, z: 0 } },
];

/**
 * 体积对象的边界面片.
 *
 * 球体用立方体贴图式 6 个半球面片(无极点奇点,面片之间只在棱上重合);
 * 方块是 6 个矩形面;旋转体是侧面 + 下底圆盘 + 上底圆盘.
 */
export function buildVolumePatches(solid: SolidObject, m: Mat4 | null): ParamPatch[] {
    switch (solid.kind) {
        case 'sphere': {
            const { position, radius } = solid;
            return SPHERE_FACES.map(({ d, a, b }) => ({
                u0: -radius,
                u1: radius,
                v0: -radius,
                v1: radius,
                wrapU: false,
                valid: () => true,
                point: (u, v) => {
                    const length = Math.hypot(radius, u, v);
                    const scale = radius / length;
                    return applyMat4(m, {
                        x: position.x + (d.x * radius + a.x * u + b.x * v) * scale,
                        y: position.y + (d.y * radius + a.y * u + b.y * v) * scale,
                        z: position.z + (d.z * radius + a.z * u + b.z * v) * scale,
                    });
                },
            }));
        }

        case 'box': {
            const { position, size } = solid;
            const half = [size[0] / 2, size[1] / 2, size[2] / 2];
            const faces: Array<{
                d: Vec3;
                a: Vec3;
                b: Vec3;
                ar: number;
                br: number;
                hd: number;
            }> = [
                { d: { x: 1, y: 0, z: 0 }, a: { x: 0, y: 1, z: 0 }, b: { x: 0, y: 0, z: 1 }, ar: half[1], br: half[2], hd: half[0] },
                { d: { x: -1, y: 0, z: 0 }, a: { x: 0, y: 0, z: 1 }, b: { x: 0, y: 1, z: 0 }, ar: half[2], br: half[1], hd: half[0] },
                { d: { x: 0, y: 1, z: 0 }, a: { x: 0, y: 0, z: 1 }, b: { x: 1, y: 0, z: 0 }, ar: half[2], br: half[0], hd: half[1] },
                { d: { x: 0, y: -1, z: 0 }, a: { x: 1, y: 0, z: 0 }, b: { x: 0, y: 0, z: 1 }, ar: half[0], br: half[2], hd: half[1] },
                { d: { x: 0, y: 0, z: 1 }, a: { x: 1, y: 0, z: 0 }, b: { x: 0, y: 1, z: 0 }, ar: half[0], br: half[1], hd: half[2] },
                { d: { x: 0, y: 0, z: -1 }, a: { x: 0, y: 1, z: 0 }, b: { x: 1, y: 0, z: 0 }, ar: half[1], br: half[0], hd: half[2] },
            ];
            return faces.map(({ d, a, b, ar, br, hd }) => ({
                    u0: -ar,
                    u1: ar,
                    v0: -br,
                    v1: br,
                    wrapU: false,
                    valid: () => true,
                    point: (u, v) => applyMat4(m, {
                        x: position.x + d.x * hd + a.x * u + b.x * v,
                        y: position.y + d.y * hd + a.y * u + b.y * v,
                        z: position.z + d.z * hd + a.z * u + b.z * v,
                    }),
                }));
        }

        case 'conic': {
            const { position, baseRadius, topRadius, height } = solid;
            const halfHeight = height / 2;
            const patches: ParamPatch[] = [];

            patches.push({
                u0: 0,
                u1: TAU,
                v0: 0,
                v1: height,
                wrapU: true,
                valid: () => true,
                point: (u, v) => {
                    const radiusAt = baseRadius + (topRadius - baseRadius) * (v / height);
                    return applyMat4(m, {
                        x: position.x + radiusAt * Math.cos(u),
                        y: position.y + v - halfHeight,
                        z: position.z + radiusAt * Math.sin(u),
                    });
                },
            });

            if (baseRadius > 1e-9) {
                patches.push({
                    u0: 0,
                    u1: TAU,
                    v0: 0,
                    v1: baseRadius,
                    wrapU: true,
                    valid: (_u, rho) => rho >= 0 && rho <= baseRadius + 1e-9,
                    point: (u, rho) => applyMat4(m, {
                        x: position.x + rho * Math.cos(u),
                        y: position.y - halfHeight,
                        z: position.z + rho * Math.sin(u),
                    }),
                });
            }

            if (topRadius > 1e-9) {
                patches.push({
                    u0: 0,
                    u1: TAU,
                    v0: 0,
                    v1: topRadius,
                    wrapU: true,
                    valid: (_u, rho) => rho >= 0 && rho <= topRadius + 1e-9,
                    point: (u, rho) => applyMat4(m, {
                        x: position.x + rho * Math.cos(u),
                        y: position.y + halfHeight,
                        z: position.z + rho * Math.sin(u),
                    }),
                });
            }

            return patches;
        }
    }
}

// ================================================================
// 一维求根:曲线 ∩ 曲面/体积
// ================================================================

function find1DRoots(
    f: (x: number) => number | null,
    lo: number,
    hi: number,
    steps: number,
    pointAt: (x: number) => Vec3 | null,
): Vec3[] {
    const xs: number[] = [];
    for (let i = 0; i <= steps; i += 1) {
        xs.push(lo + ((hi - lo) * i) / steps);
    }
    const values = xs.map(f);
    const roots: Vec3[] = [];

    for (let i = 0; i + 1 < xs.length; i += 1) {
        const f0 = values[i];
        const f1 = values[i + 1];
        if (f0 === null || f1 === null || !Number.isFinite(f0) || !Number.isFinite(f1)) {
            continue;
        }
        if (f0 === 0) {
            const p = pointAt(xs[i]);
            if (p) roots.push(p);
            continue;
        }
        if (f1 === 0) {
            const p = pointAt(xs[i + 1]);
            if (p) roots.push(p);
            continue;
        }
        if (Math.sign(f0) === Math.sign(f1)) continue;

        let loX = xs[i];
        let hiX = xs[i + 1];
        let fLo = f0;
        let fHi = f1;
        let refined: Vec3 | null = null;
        for (let iter = 0; iter < 100; iter += 1) {
            const mid = (loX + hiX) / 2;
            const fm = f(mid);
            if (fm === null || !Number.isFinite(fm)) break;
            if (fm === 0 || Math.abs(fm) < 1e-12) {
                refined = pointAt(mid);
                break;
            }
            if (Math.sign(fm) === Math.sign(fLo)) {
                loX = mid;
                fLo = fm;
            } else {
                hiX = mid;
                fHi = fm;
            }
            if (hiX - loX < 1e-11 * (1 + Math.abs(loX))) {
                refined = pointAt((loX + hiX) / 2);
                break;
            }
        }
        if (!refined && fLo !== fHi) {
            refined = pointAt((loX + hiX) / 2);
        }
        if (refined) roots.push(refined);
    }

    // 相切接触:采样点本身就在边界上但没有符号变化.
    const touchTolerance = 1e-7;
    for (let i = 0; i < xs.length; i += 1) {
        const value = values[i];
        if (value === null || !Number.isFinite(value) || Math.abs(value) > touchTolerance) {
            continue;
        }
        const p = pointAt(xs[i]);
        if (p && !roots.some((existing) => dist(existing, p) < 1e-5)) {
            roots.push(p);
        }
    }

    return dedupePoints(roots, 1e-5);
}

/** 曲线 ∩ 隐式场:在曲线参数上找场值符号变化的根. */
export function findCurveFieldIntersections(
    curve: CurveObject,
    curveM: Mat4 | null,
    field: FieldFn,
    steps: number,
): Vec3[] {
    const samples = sampleCurvePoints(curve, curveM, steps);
    if (samples.length === 0) return [];

    const range = curve.range ?? NUMERIC_CONFIG.curve.defaultRange;
    return find1DRoots(
        (x) => {
            const world = curveWorldAt(curve, curveM, x);
            return world ? field(world) : null;
        },
        range[0],
        range[1],
        steps,
        (x) => curveWorldAt(curve, curveM, x),
    );
}

// ================================================================
// 曲线 ∩ 曲线
// ================================================================

/** 平面内两条 y=f(x) 曲线求交:对 fA(x)-fB(x) 一维求根. */
export function solvePlanarCurveCurve(
    a: CurveObject,
    b: CurveObject,
    steps: number,
): Vec3[] {
    const rangeA = a.range ?? NUMERIC_CONFIG.curve.defaultRange;
    const rangeB = b.range ?? NUMERIC_CONFIG.curve.defaultRange;
    const lo = Math.max(rangeA[0], rangeB[0]);
    const hi = Math.min(rangeA[1], rangeB[1]);
    if (lo >= hi) return [];

    const scopeA = coefficientScope(a);
    const scopeB = coefficientScope(b);
    return find1DRoots(
        (x) => {
            const ya = evaluateScalarAt(a.expr, scopeA, x, Number.NaN, Number.NaN);
            const yb = evaluateScalarAt(b.expr, scopeB, x, Number.NaN, Number.NaN);
            if (ya === null || yb === null) return null;
            return ya - yb;
        },
        lo,
        hi,
        steps,
        (x) => {
            const y = evaluateScalarAt(a.expr, scopeA, x, Number.NaN, Number.NaN);
            return y === null ? null : { x, y, z: 0 };
        },
    );
}

function closestPointOnSegments(
    p1: Vec3,
    p2: Vec3,
    q1: Vec3,
    q2: Vec3,
): { d2: number; t: number; s: number } {
    const d1 = sub(p2, p1);
    const d2 = sub(q2, q1);
    const r = sub(p1, q1);
    const a = dot(d1, d1);
    const e = dot(d2, d2);
    const f = dot(d2, r);
    const eps = 1e-14;

    let t: number;
    let s: number;
    if (a <= eps && e <= eps) {
        t = 0;
        s = 0;
    } else if (a <= eps) {
        t = 0;
        s = clamp(f / e, 0, 1);
    } else {
        const c = dot(d1, r);
        if (e <= eps) {
            s = 0;
            t = clamp(-c / a, 0, 1);
        } else {
            const b = dot(d1, d2);
            const denom = a * e - b * b;
            t = denom > eps ? clamp((b * f - c * e) / denom, 0, 1) : 0;
            s = (b * t + f) / e;
            if (s < 0) {
                s = 0;
                t = clamp(-c / a, 0, 1);
            } else if (s > 1) {
                s = 1;
                t = clamp((b - c) / a, 0, 1);
            }
        }
    }

    const cp1 = { x: p1.x + d1.x * t, y: p1.y + d1.y * t, z: p1.z + d1.z * t };
    const cp2 = { x: q1.x + d2.x * s, y: q1.y + d2.y * s, z: q1.z + d2.z * s };
    return {
        d2: (cp1.x - cp2.x) ** 2 + (cp1.y - cp2.y) ** 2 + (cp1.z - cp2.z) ** 2,
        t,
        s,
    };
}

/** 带静态 transform 的两条三维曲线求交:线段最近点 + 最小二乘牛顿. */
export function solveSpaceCurveCurve(
    a: CurveObject,
    ma: Mat4 | null,
    b: CurveObject,
    mb: Mat4 | null,
    steps: number,
): Vec3[] {
    const samplesA = sampleCurvePoints(a, ma, steps);
    const samplesB = sampleCurvePoints(b, mb, steps);
    if (samplesA.length < 2 || samplesB.length < 2) return [];

    const rangeA = a.range ?? NUMERIC_CONFIG.curve.defaultRange;
    const rangeB = b.range ?? NUMERIC_CONFIG.curve.defaultRange;
    let maxStep = 0;
    for (let i = 0; i + 1 < samplesA.length; i += 1) {
        maxStep = Math.max(maxStep, dist(samplesA[i].world, samplesA[i + 1].world));
    }
    for (let i = 0; i + 1 < samplesB.length; i += 1) {
        maxStep = Math.max(maxStep, dist(samplesB[i].world, samplesB[i + 1].world));
    }
    const seedTolerance = Math.max(1e-6, 2 * maxStep);
    const results: Vec3[] = [];

    for (let i = 0; i + 1 < samplesA.length; i += 1) {
        for (let j = 0; j + 1 < samplesB.length; j += 1) {
            const closest = closestPointOnSegments(
                samplesA[i].world,
                samplesA[i + 1].world,
                samplesB[j].world,
                samplesB[j + 1].world,
            );
            if (closest.d2 > seedTolerance * seedTolerance) continue;

            const t =
                samplesA[i].t
                + (samplesA[i + 1].t - samplesA[i].t) * closest.t;
            const s =
                samplesB[j].t
                + (samplesB[j + 1].t - samplesB[j].t) * closest.s;
            const refined = refineSpaceCurvePair(a, ma, b, mb, t, s, rangeA, rangeB);
            if (refined && !results.some((existing) => dist(existing, refined) < 1e-5)) {
                results.push(refined);
            }
        }
    }
    return results;
}

function refineSpaceCurvePair(
    a: CurveObject,
    ma: Mat4 | null,
    b: CurveObject,
    mb: Mat4 | null,
    t0: number,
    s0: number,
    rangeA: [number, number],
    rangeB: [number, number],
): Vec3 | null {
    let t = clamp(t0, rangeA[0], rangeA[1]);
    let s = clamp(s0, rangeB[0], rangeB[1]);
    let pa = curveWorldAt(a, ma, t);
    let pb = curveWorldAt(b, mb, s);
    if (!pa || !pb) return null;

    for (let iter = 0; iter < 40; iter += 1) {
        const r = sub(pa, pb);
        const r2 = dot(r, r);
        if (r2 < 1e-16) return midpoint(pa, pb);

        const h = 1e-6;
        const paP = curveWorldAt(a, ma, t + h);
        const paM = curveWorldAt(a, ma, t - h);
        const pbP = curveWorldAt(b, mb, s + h);
        const pbM = curveWorldAt(b, mb, s - h);
        if (!paP || !paM || !pbP || !pbM) break;

        const dpa = {
            x: (paP.x - paM.x) / (2 * h),
            y: (paP.y - paM.y) / (2 * h),
            z: (paP.z - paM.z) / (2 * h),
        };
        const dpb = {
            x: (pbP.x - pbM.x) / (2 * h),
            y: (pbP.y - pbM.y) / (2 * h),
            z: (pbP.z - pbM.z) / (2 * h),
        };

        const a00 = dot(dpa, dpa);
        const a01 = -dot(dpa, dpb);
        const a11 = dot(dpb, dpb);
        const b0 = -dot(dpa, r);
        const b1 = dot(dpb, r);
        const det = a00 * a11 - a01 * a01;
        if (Math.abs(det) < 1e-18) break;

        const dt = (b0 * a11 - a01 * b1) / det;
        const ds = (a00 * b1 - a01 * b0) / det;
        t = clamp(t + dt, rangeA[0], rangeA[1]);
        s = clamp(s + ds, rangeB[0], rangeB[1]);
        if (Math.abs(dt) < 1e-12 && Math.abs(ds) < 1e-12) break;

        pa = curveWorldAt(a, ma, t);
        pb = curveWorldAt(b, mb, s);
        if (!pa || !pb) break;
    }

    if (!pa || !pb) return null;
    const r = sub(pa, pb);
    return dot(r, r) < 1e-12 ? midpoint(pa, pb) : null;
}

/** 两条曲线求交:无变换时走平面快速路径,有变换时走三维线段路径. */
export function solveCurveCurve(
    a: CurveObject,
    ma: Mat4 | null,
    b: CurveObject,
    mb: Mat4 | null,
    steps: number,
): Vec3[] {
    if (!ma && !mb) return solvePlanarCurveCurve(a, b, steps);
    return solveSpaceCurveCurve(a, ma, b, mb, steps);
}

// ================================================================
// 二维等值线:曲面/体积之间的交线
// ================================================================

/**
 * 在面片上追踪 field = 0 的等值线.
 *
 * 采用 marching squares:对每个网格单元按四个角点符号决定穿过单元的线段,
 * 再按共享顶点把线段拼成折线.顶点用坐标去重,因此旋转体面片的 θ 接缝
 * 也能正确接上.
 */
export function traceContours(
    field: FieldFn,
    patch: ParamPatch,
    nu: number,
    nv: number,
): Vec3[][] {
    const gridWidth = nu + 1;
    const values = new Float64Array(gridWidth * (nv + 1));
    const validFlags = new Uint8Array(gridWidth * (nv + 1));

    for (let j = 0; j <= nv; j += 1) {
        const v = patch.v0 + ((patch.v1 - patch.v0) * j) / nv;
        for (let i = 0; i <= nu; i += 1) {
            const u = patch.u0 + ((patch.u1 - patch.u0) * i) / nu;
            const index = j * gridWidth + i;
            const f = field(patch.point(u, v));
            const ok = patch.valid(u, v) && Number.isFinite(f);
            values[index] = f;
            validFlags[index] = ok ? 1 : 0;
        }
    }

    const pool = new Map<string, number>();
    const points: Vec3[] = [];
    const vertexKey = (p: Vec3): string =>
        `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`;
    const vertexAt = (u: number, v: number): number => {
        const p = patch.point(u, v);
        const key = vertexKey(p);
        let id = pool.get(key);
        if (id === undefined) {
            id = points.length;
            pool.set(key, id);
            points.push(p);
        }
        return id;
    };

    const segments: Array<[number, number]> = [];
    for (let j = 0; j < nv; j += 1) {
        for (let i = 0; i < nu; i += 1) {
            const iA = j * gridWidth + i;
            const iB = j * gridWidth + i + 1;
            const iC = (j + 1) * gridWidth + i + 1;
            const iD = (j + 1) * gridWidth + i;
            if (
                !validFlags[iA]
                || !validFlags[iB]
                || !validFlags[iC]
                || !validFlags[iD]
            ) {
                continue;
            }

            const vA = values[iA];
            const vB = values[iB];
            const vC = values[iC];
            const vD = values[iD];
            const negA = vA < 0;
            const negB = vB < 0;
            const negC = vC < 0;
            const negD = vD < 0;

            const u0 = patch.u0 + ((patch.u1 - patch.u0) * i) / nu;
            const u1 = patch.u0 + ((patch.u1 - patch.u0) * (i + 1)) / nu;
            const v0 = patch.v0 + ((patch.v1 - patch.v0) * j) / nv;
            const v1 = patch.v0 + ((patch.v1 - patch.v0) * (j + 1)) / nv;

            const crossings: Array<{ u: number; v: number }> = [];
            const addCrossing = (
                fa: number,
                fb: number,
                ua: number,
                va: number,
                ub: number,
                vb: number,
            ): void => {
                if (fa === 0 && fb === 0) return;
                if (fa === 0) {
                    crossings.push({ u: ua, v: va });
                    return;
                }
                if (fb === 0) {
                    crossings.push({ u: ub, v: vb });
                    return;
                }
                if ((fa < 0) === (fb < 0)) return;
                const t = fa / (fa - fb);
                crossings.push({
                    u: ua + (ub - ua) * t,
                    v: va + (vb - va) * t,
                });
            };

            // 四条边:底 A-B、右 B-C、顶 C-D、左 D-A
            addCrossing(vA, vB, u0, v0, u1, v0);
            addCrossing(vB, vC, u1, v0, u1, v1);
            addCrossing(vC, vD, u1, v1, u0, v1);
            addCrossing(vD, vA, u0, v1, u0, v0);

            const pushSegment = (
                first: { u: number; v: number },
                second: { u: number; v: number },
            ): void => {
                segments.push([vertexAt(first.u, first.v), vertexAt(second.u, second.v)]);
            };

            if (crossings.length === 2) {
                pushSegment(crossings[0], crossings[1]);
            } else if (crossings.length === 4) {
                // 鞍点歧义:按单元中心符号选择连接方式,保证相邻单元一致.
                const centerNeg = (vA + vB + vC + vD) / 4 < 0;
                if (negA === negC && negB === negD && negA !== negB) {
                    if (negA === centerNeg) {
                        pushSegment(crossings[0], crossings[1]);
                        pushSegment(crossings[2], crossings[3]);
                    } else {
                        pushSegment(crossings[0], crossings[3]);
                        pushSegment(crossings[1], crossings[2]);
                    }
                } else {
                    pushSegment(crossings[0], crossings[1]);
                    pushSegment(crossings[2], crossings[3]);
                }
            }
        }
    }

    const chains = chainSegments(segments);
    return chains
        .map((chain) => chain.map((id) => points[id]))
        .filter((chain) => chain.length >= 2);
}

/** 把 marching squares 产出的线段按共享端点拼成折线. */
function chainSegments(segments: Array<[number, number]>): number[][] {
    const adjacency = new Map<number, Array<[number, number]>>();
    segments.forEach(([a, b], id) => {
        if (!adjacency.has(a)) adjacency.set(a, []);
        if (!adjacency.has(b)) adjacency.set(b, []);
        adjacency.get(a)!.push([b, id]);
        adjacency.get(b)!.push([a, id]);
    });

    const used = new Set<number>();
    const chains: number[][] = [];
    for (let id = 0; id < segments.length; id += 1) {
        if (used.has(id)) continue;

        let tail = segments[id][0];
        let head = segments[id][1];
        used.add(id);
        const chain = [tail, head];

        let extended = true;
        while (extended) {
            extended = false;
            for (const [other, edgeId] of adjacency.get(head) ?? []) {
                if (used.has(edgeId)) continue;
                if (other === chain[0] && chain.length > 2) {
                    used.add(edgeId);
                    chain.push(other);
                    extended = true;
                    break;
                }
                used.add(edgeId);
                chain.push(other);
                head = other;
                extended = true;
                break;
            }
            if (extended) continue;

            for (const [other, edgeId] of adjacency.get(tail) ?? []) {
                if (used.has(edgeId)) continue;
                used.add(edgeId);
                chain.unshift(other);
                tail = other;
                extended = true;
                break;
            }
        }
        chains.push(chain);
    }
    return chains;
}
