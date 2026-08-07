import type { MathNode } from 'mathjs';

// ================================================================
// 数值积分类型
// ================================================================

export type Integral1DFn = (x: number) => number;
export type Integral2DFn = (x: number, y: number) => number;
export type Range1D = [number, number];

// ================================================================
// 数学对象核心类型 —— discriminated union
// ================================================================

/** 系数(曲线/曲面自由参数) */
export interface Coefficient {
    name: string;
    value: number;
    min: number;
    max: number;
    step: number;
}

/** 曲线:一元函数 y = f(x) */
export interface CurveExpr {
    readonly kind: 'curve';
    readonly id: number;
    node: MathNode;
    coefficients: Coefficient[];
    color: string;
    enabled: boolean;
}

/** 曲面:二元函数 z = f(x, y) */
export interface SurfaceExpr {
    readonly kind: 'surface';
    readonly id: number;
    node: MathNode;
    coefficients: Coefficient[];
    color: string;
    enabled: boolean;
}

/** 空间点 */
export interface PointEntity {
    readonly kind: 'point';
    readonly id: number;
    x: number;
    y: number;
    z: number;
    color: string;
    enabled: boolean;
}

/** 空间向量(带起点和方向分量) */
export interface VectorEntity {
    readonly kind: 'vector';
    readonly id: number;
    origin: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    color: string;
    enabled: boolean;
}

/** 四种数学对象的联合类型 */
export type MathObject = CurveExpr | SurfaceExpr | PointEntity | VectorEntity;

// ================================================================
// 视图 / 相机类型
// ================================================================

export type ViewMode = '2d' | '3d';
export type CamMode = 'perspective' | 'orthographic';

// ================================================================
// 事件映射 —— 全面使用 diskindcrimininated union 的事件键名
// ================================================================

export interface MathLabEvents {
    'mathobj:added': { object: MathObject };
    'mathobj:removed': { id: number };
    'mathobj:toggled': { id: number; enabled: boolean };
    'mathobj:updated': { id: number };
    'mode:changed': { mode: ViewMode };
    'camera:changed': { camMode: CamMode };
    'integral:calculated': { results: { id: number; value: number }[]; total: number };
    'coefficient:changed': { id: number };
    'selection:changed': { id: number | null; kind: string | null };
}