/**
 * 对象 blueprint 类型定义(声明级中间形态).
 *
 * blueprint 由静态场景层在编译缓存命中前一次性构建(见 ./build.ts),携带
 * 归一化后的表达式与解析好的选项;物化层(./materialize.ts)每次参数刷新时
 * 把 blueprint 求值成 ir/types.ts 的 SceneObject.静态场景/构建/物化三处
 * 都只经由这里共享类型与 type guard.
 */
export type CurveBlueprint = {
    name: string;
    id: number;
    kind: 'curve';
    expr: string;
    coefficientNames: string[];
    color: string;
    range?: [number, number];
    segments?: number;
};

export type SurfaceBlueprint = {
    name: string;
    id: number;
    kind: 'surface';
    expr: string;
    coefficientNames: string[];
    color: string;
    range: [number, number, number, number];
    segments?: number;
};

export type VectorFieldBlueprint = {
    name: string;
    id: number;
    kind: 'vector_field';
    pExpr: string;
    qExpr: string;
    rExpr: string;
    coefficientNames: string[];
    color: string;
    gridSize: [number, number, number];
    range: {
        x: [number, number];
        y: [number, number];
        z: [number, number];
    };
    glyphScale: number;
};

export type PointBlueprint = {
    name: string;
    id: number;
    kind: 'point';
    expr: string;
    coordinateExprs: [string, string, string];
    color: string;
};

export type VectorBlueprint = {
    name: string;
    id: number;
    kind: 'vector';
    expr: string;
    originExprs: [string, string, string];
    directionExprs: [string, string, string];
    color: string;
};

export type SphereBlueprint = {
    name: string;
    id: number;
    kind: 'sphere';
    expr: string;
    positionExprs: [string, string, string];
    radiusExpr: string;
    coefficientNames: string[];
    color: string;
    segments: number;
    opacity: number;
};

export type BoxBlueprint = {
    name: string;
    id: number;
    kind: 'box';
    expr: string;
    positionExprs: [string, string, string];
    sizeExprs: [string, string, string];
    coefficientNames: string[];
    color: string;
    opacity: number;
};

export type ConicBlueprint = {
    name: string;
    id: number;
    kind: 'conic';
    expr: string;
    declaredKind: 'cylinder' | 'cone' | 'frustum';
    positionExprs: [string, string, string];
    baseExpr: string;
    heightExpr: string;
    topExpr?: string;
    angleExpr?: string;
    coefficientNames: string[];
    color: string;
    segments: number;
    opacity: number;
};

export type RegionBlueprint = {
    name: string;
    id: number;
    kind: 'region';
    /** 原始 DSL 表达式 `region(c1, c2)`(仅诊断保留,不做数学归一化). */
    expr: string;
    /** 两条边界曲线对象名(必须先声明为 curve). */
    curveAName: string;
    curveBName: string;
    /**
     * x 区间;来自显式 range 或两曲线 x-range 交集.
     * 解析在 blueprint 阶段完成,物化时直接落 IR.
     */
    range: [number, number];
    coefficientNames: string[];
    color: string;
    opacity: number;
    segments: number;
};

export type ObjectBlueprint =
    | CurveBlueprint
    | SurfaceBlueprint
    | VectorFieldBlueprint
    | PointBlueprint
    | VectorBlueprint
    | SphereBlueprint
    | BoxBlueprint
    | ConicBlueprint
    | RegionBlueprint;

export type CoefficientBlueprint = Exclude<
    ObjectBlueprint,
    PointBlueprint | VectorBlueprint
>;

/** 该 blueprint 是否携带自由参数列表(point/vector 没有). */
export function blueprintHasCoefficients(
    blueprint: ObjectBlueprint,
): blueprint is CoefficientBlueprint {
    return 'coefficientNames' in blueprint;
}
