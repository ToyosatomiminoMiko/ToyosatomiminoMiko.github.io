import type { SceneObject } from '../../compiler/ir/types';

// ================================================================
// 数值积分辅助类型
// ================================================================

export type Integral1DFn = (x: number) => number;
export type Integral2DFn = (x: number, y: number) => number;
export type Range1D = [number, number];

// ================================================================
// 视图 / 相机类型
// ================================================================

export type CamMode = 'perspective' | 'orthographic';
export type ViewHome = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'isometric';

// ================================================================
// 事件映射 —— 统一使用 discriminated union 的事件键名
// ================================================================

export interface MathLabEvents {
    'mathobj:added': { object: SceneObject };
    'mathobj:removed': { id: number };
    'mathobj:toggled': { id: number; enabled: boolean };
    'mathobj:updated': { id: number };
    'camera:changed': { camMode: CamMode };
    'camera:view': { view: ViewHome };
    'camera:rotationLock': { locked: boolean };
    'integral:calculated': { results: { id: number; value: number }[]; total: number };
    'coefficient:changed': { id: number };
    'selection:changed': { id: number | null; kind: string | null };
}
