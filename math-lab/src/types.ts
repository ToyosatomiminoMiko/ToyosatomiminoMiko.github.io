/**
 * 项目对外的类型汇总.
 *
 * 场景对象、分析/积分与数值积分辅助类型统一来自 `compiler/ir/types`;
 * 视图类型来自 `render/types`,事件类型来自 `service/events`.
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
    Integral1DFn,
    Integral2DFn,
    Range1D,
} from './compiler/ir/types';

export type {
    CamMode,
    ViewHome,
} from './render/types';

export type { MathLabEvents } from './service/events';
