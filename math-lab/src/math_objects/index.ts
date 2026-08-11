// ============================================================
// math_objects 统一导出
// ============================================================

// 类型
export type {
    Coefficient,
    CurveExpr,
    SurfaceExpr,
    PointEntity,
    VectorEntity,
    VectorFieldExpr,
    MathObject,
    Integral1DFn,
    Integral2DFn,
    Range1D,
    ViewMode,
    CamMode,
    MathLabEvents,
} from './types';

// 数值积分纯函数
// WASM

// 纯函数 — 曲线
export { parseCurve, differentiateCurve } from './Curve';

// 纯函数 — 曲面
export { parseSurface, differentiateSurface } from './Surface';

// 纯函数 — 点
export { createPoint, movePoint } from './Point';

// 纯函数 — 向量
export { createVector, transformVector } from './Vector';

// 系数工具
export { extractCoefficients } from './coefficientUtils';

// 管理器
export { MathObjectManager } from './MathObjectManager';

export { ColorManager } from './ColorManager';

// 梯度计算
export { computeGradient } from './GradientCore';
export type { GradientResult } from './GradientCore';

export { parseVectorField, sampleVectorField } from './VectorField';
