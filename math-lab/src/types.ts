/**
 * 项目对外的类型汇总.
 *
 * 场景对象与分析/积分类型统一来自 `ir/types`;
 * 视图、事件、数值积分辅助类型来自 `math_objects/types`.
 */
export type {
    Coefficient,
    CurveObject,
    SurfaceObject,
    PointObject,
    VectorObject,
    VectorFieldObject,
    SceneObject,
    AnalysisResult,
    IntegralTask,
    SceneIR,
} from './compiler/ir/types';

export type {
    Integral1DFn,
    Integral2DFn,
    Range1D,
    CamMode,
    ViewHome,
    MathLabEvents,
} from './math/objects/types';
