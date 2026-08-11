// ============================================================
// math_objects/types.ts
// ============================================================

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
} from './math_objects/types';

// 向后兼容别名(过渡期使用,后续逐步消除)
import type { MathObject, VectorFieldExpr } from './math_objects/types';
/** @deprecated 使用 MathObject 替代 */
export type Expression = MathObject;