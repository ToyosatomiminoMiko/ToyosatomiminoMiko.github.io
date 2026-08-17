/**
 * 场景 IR —— 语言层与渲染层之间的唯一稳定数据边界.
 *
 * 这里只允许出现“纯数据”:
 * - 不引用 mathjs 的 MathNode
 * - 不引用 three.js 的任何类型
 * - 不引用 DOM
 *
 * DslCompiler 负责把 AST 编译成这份 IR;Web/桌面渲染器只消费这份 IR.
 * 表达式统一用字符串保存,渲染器需要求值时再由各自的执行后端处理.
 */

/** 曲线 / 曲面 / 向量场里的自由参数. */
export interface Coefficient {
    name: string;
    value: number;
    min: number;
    max: number;
    step: number;
}

/** `param` 声明生成的参数面板项. */
export interface ParamDeclaration {
    name: string;
    value: number;
    min: number;
    max: number;
    step: number;
}

/** 曲线对象:y = f(x),渲染在 z=0 平面. */
export interface CurveObject {
    kind: 'curve';
    id: number;
    name: string;
    /** 纯字符串表达式,例如 `sin(x * a)`. */
    expr: string;
    coefficients: Coefficient[];
    color: string;
    enabled: boolean;
    range?: [number, number];
    segments?: number;
}

/** 曲面对象:z = f(x, y). */
export interface SurfaceObject {
    kind: 'surface';
    id: number;
    name: string;
    /** 纯字符串表达式,例如 `sin(x) * cos(y)`. */
    expr: string;
    coefficients: Coefficient[];
    color: string;
    enabled: boolean;
    range: [number, number, number, number];
    segments?: number;
}

/** 向量场对象:F(x, y, z) = [P, Q, R]. */
export interface VectorFieldObject {
    kind: 'vector_field';
    id: number;
    name: string;
    /** 三个分量的字符串表达式. */
    components: [string, string, string];
    coefficients: Coefficient[];
    color: string;
    enabled: boolean;
    range: {
        x: [number, number];
        y: [number, number];
        z: [number, number];
    };
    gridSize: [number, number, number];
    glyphScale: number;
}

/** 空间点(暂未接入 DSL,但保留为可渲染对象). */
export interface PointObject {
    kind: 'point';
    id: number;
    name?: string;
    x: number;
    y: number;
    z: number;
    color: string;
    enabled: boolean;
}

/** 空间向量(暂未接入 DSL,但保留为可渲染对象). */
export interface VectorObject {
    kind: 'vector';
    id: number;
    name?: string;
    origin: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    color: string;
    enabled: boolean;
}

/**
 * 场景中所有数学对象的联合类型.
 *
 * 注意:`point` / `vector` 是保留对象类型,后续会补 DSL 语法；
 * 当前先恢复渲染能力,不继续按 legacy 删除.
 */
export type SceneObject =
    | CurveObject
    | SurfaceObject
    | VectorFieldObject
    | PointObject
    | VectorObject;

/** 微分分析结果(纯数值结果). */
export type AnalysisOp = 'gradient' | 'divergence' | 'curl';
export type AnalysisShow = 'point' | 'normal' | 'tangent_plane';

export interface AnalysisResult {
    name: string;
    op: AnalysisOp;
    point: [number, number, number];
    vector: [number, number, number];
    scalar: number | null;
    show: AnalysisShow[];
}

/** 数值积分任务. */
export type IntegralMethod = 'trapezoid' | 'simpson' | 'riemann' | 'lebesgue';

export interface IntegralTask {
    name: string;
    objectId: number;
    sourceKind: 'curve' | 'surface';
    method: IntegralMethod;
    range: [number, number] | [number, number, number, number];
    segments: number;
    layers: number;
    show: boolean;
}

/** 完整场景 IR. */
export interface SceneIR {
    params: ParamDeclaration[];
    objects: SceneObject[];
    /**
     * 对象 id -> 4x4 行主序变换矩阵.
     *
     * 使用 Record 而不是 Map,是为了让 IR 保持可序列化,
     * 便于未来跨线程 / 跨进程 / 桌面端消费.
     */
    objectTransforms: Record<number, number[][]>;
    analyses: AnalysisResult[];
    integrals: IntegralTask[];
}

// ================================================================
// 数值积分辅助类型
//
// 这些类型原本混在 `math/objects/types.ts`,现迁移到 IR 层,
// 因为它们描述的是编译后的积分计算输入/输出形状.
// ================================================================

export type Integral1DFn = (x: number) => number;
export type Integral2DFn = (x: number, y: number) => number;
export type Range1D = [number, number];
