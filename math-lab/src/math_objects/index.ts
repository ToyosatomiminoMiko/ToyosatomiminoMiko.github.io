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
    MathObject,
    Integral1DFn,
    Integral2DFn,
    Range1D,
    ViewMode,
    CamMode,
    MathLabEvents,
} from './types';

// 数值积分纯函数
export {
    trapz2d,
    simpson2d,
    trapz1d,
    simpson1d,
    riemann1dLeft,
    riemann1dRight,
    riemann1dMid,
    riemann2dLeft,
    lebesgue1d,
    lebesgue2d,
} from './IntegralCore';

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
