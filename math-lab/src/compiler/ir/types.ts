/**
 * 场景 IR —— 语言层与渲染层之间的唯一稳定数据边界.
 *
 * 这里只允许出现"纯数据":
 * - 不引用外部数学库的 AST 类型
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
    /** 原始坐标表达式,例如 `[a, b, 3]`. */
    expr: string;
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
    /** 原始向量表达式,例如 `[[0, j, 0], [1, k, 0]]`. */
    expr: string;
    origin: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    color: string;
    enabled: boolean;
}

/** 三维位置或尺寸分量,保持 IR 不依赖 three.js. */
export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

/** 球体体积对象:中心点 + 半径. */
export interface SphereObject {
    kind: 'sphere';
    id: number;
    name: string;
    /** 原始 DSL 表达式,例如 `[x, y, z]`. */
    expr: string;
    position: Vec3;
    radius: number;
    /** 半径/位置中出现的自由参数,供参数面板与增量刷新使用. */
    coefficients: Coefficient[];
    color: string;
    opacity: number;
    /** 径向分段数,只影响可视化质量,不改变数学半径. */
    segments: number;
    enabled: boolean;
}

/** 轴对齐方块体积对象:中心点 + 三轴尺寸. */
export interface BoxObject {
    kind: 'box';
    id: number;
    name: string;
    /** 原始 DSL 表达式,例如 `[x, y, z]`. */
    expr: string;
    position: Vec3;
    size: [number, number, number];
    /** size/位置中出现的自由参数. */
    coefficients: Coefficient[];
    color: string;
    opacity: number;
    enabled: boolean;
}

/**
 * 圆柱 / 圆锥 / 圆台的统一体积对象.
 *
 * 三种形体只用上下底半径和高描述:
 * - 圆柱:topRadius === baseRadius
 * - 圆锥:topRadius === 0
 * - 圆台:0 < topRadius < baseRadius
 *
 * `sideAngle` 是母线相对轴的夹角,单位为弧度,由上下底半径和高推出;
 * 同时保留它方便诊断和后续可视化控制.
 */
export interface ConicSolidObject {
    kind: 'conic';
    id: number;
    name: string;
    /** 原始 DSL 表达式,例如 `[x, y, z]`. */
    expr: string;
    position: Vec3;
    baseRadius: number;
    topRadius: number;
    height: number;
    sideAngle: number;
    /** 几何参数/位置中出现的自由参数. */
    coefficients: Coefficient[];
    color: string;
    opacity: number;
    /** 圆周分段数. */
    segments: number;
    enabled: boolean;
}

/**
 * 场景中所有数学对象的联合类型.
 *
 * 注意:`point` / `vector` 是保留对象类型,后续会补 DSL 语法;
 * 当前先恢复渲染能力,不继续按 legacy 删除.
 */
export type SceneObject =
    | CurveObject
    | SurfaceObject
    | VectorFieldObject
    | PointObject
    | VectorObject
    | SphereObject
    | BoxObject
    | ConicSolidObject;

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
    /** 求值对象是否参与计算.为 false 时仅保留列表项,不执行数值计算. */
    enabled: boolean;
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
    /** 求值对象是否参与计算.为 false 时仅保留列表项,不执行数值计算. */
    enabled: boolean;
}

/**
 * 求交结果(纯数值结果).
 *
 * 两个对象相交时可能是离散交点,也可能是空间交线:
 * - 曲线参与的求交(曲线∩曲线/曲面/体积)产生 `points`;
 * - 曲面/体积参与的求交(曲面∩曲面/体积,体积∩体积)产生 `curves`.
 * 坐标一律是世界坐标(已计入对象静态 transform).
 */
export interface IntersectionResult {
    name: string;
    aName: string;
    bName: string;
    points: Vec3[];
    curves: Vec3[][];
    color: string;
    /** 求交对象是否参与计算.为 false 时仅保留列表项,不执行数值计算. */
    enabled: boolean;
}

/** 一个动画片段:单个变换矩阵 + 持续时间. */
export interface AnimationClip {
    name: string;
    duration: number;
    matrix: number[][];
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
    /**
     * 场景中所有 animation 声明.
     * 名称唯一,对象通过 objectAnimations 引用.
     */
    animations: AnimationClip[];
    /**
     * 对象 id -> 按顺序播放的动画名列表.
     * 空列表或缺失表示该对象没有动画.
     */
    objectAnimations: Record<number, string[]>;
    analyses: AnalysisResult[];
    integrals: IntegralTask[];
    intersections: IntersectionResult[];
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

// 预留说明:Integral1DFn/Integral2DFn 面向"函数式积分接口",当前 DSL 积分
// 走 IntegralTask + Worker 数值采样,不使用这两个类型;仅在需要提供可注入
// 的数学函数接口时再消费它们,否则应删除.
