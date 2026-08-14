import type { TensorExpr } from '../tensor/types';
import type { SceneTransform } from '../tensor/SceneTransform';
import type { AnalysisExpr, ScalarFieldExpr, VectorFieldExpr } from '../diffops/types';

/** 由 `param` 声明自动生成的参数面板项. */
export interface ParamDecl {
    name: string;
    value: number;
    min: number;
    max: number;
    step: number;
}

export type CameraProjection = 'perspective' | 'orthographic';
export type ViewHome = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'isometric';

export interface CameraState {
    projection: CameraProjection;
    rotationLock: boolean;
    home: ViewHome;
}

export interface CurveObject {
    kind: 'curve';
    id: number;
    name: string;
    expr: ScalarFieldExpr;
    color: string;
    range: [number, number];
    segments: number;
    transform: SceneTransform | null;
    enabled: boolean;
}

export interface SurfaceObject {
    kind: 'surface';
    id: number;
    name: string;
    expr: ScalarFieldExpr;
    color: string;
    range: [number, number, number, number];
    segments: number;
    transform: SceneTransform | null;
    enabled: boolean;
}

export interface VectorFieldObject {
    kind: 'vector_field';
    id: number;
    name: string;
    expr: VectorFieldExpr;
    color: string;
    range: [number, number, number, number, number, number];
    grid: [number, number, number];
    scale: number;
    transform: SceneTransform | null;
    enabled: boolean;
}

export interface PointObject {
    kind: 'point';
    id: number;
    name: string;
    position: [number, number, number];
    color: string;
    enabled: boolean;
}

export interface VectorObject {
    kind: 'vector';
    id: number;
    name: string;
    origin: [number, number, number];
    direction: [number, number, number];
    color: string;
    enabled: boolean;
}

export type SceneObject =
    | CurveObject
    | SurfaceObject
    | VectorFieldObject
    | PointObject
    | VectorObject;

/**
 * 场景 IR,作为语言层与渲染层的稳定边界.
 *
 * 它不依赖 DOM\Three.js 或 bevy,Web 端与未来的统一 Rust 渲染端
 * 都只消费同一份 `SceneIR`.
 */
export interface SceneIR {
    params: ParamDecl[];
    tensors: TensorExpr[];
    objects: SceneObject[];
    analyses: AnalysisExpr[];
    camera: CameraState;
}
