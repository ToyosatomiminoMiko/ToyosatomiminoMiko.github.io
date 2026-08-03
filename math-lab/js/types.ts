import type { MathNode } from 'mathjs';

// ================================================================
// 阶段 1：数值积分类型
// ================================================================

export type Integral1DFn = (x: number) => number;
export type Integral2DFn = (x: number, y: number) => number;
export type Range1D = [number, number];

// ================================================================
// 阶段 2：核心领域类型
// ================================================================

export interface Coefficient {
    name: string;
    value: number;
    min: number;
    max: number;
    step: number;
}

export interface Expression {
    id: number;
    type: '2d' | '3d' | 'point' | 'vector';
    node: MathNode;
    coefficients: Coefficient[];
    color: string;
    enabled: boolean;
    derivative: Expression | null;
}

export type ViewMode = '2d' | '3d';
export type CamMode = 'perspective' | 'orthographic';

// ================================================================
// 事件映射 —— EventBus 泛型化的核心
// ================================================================

export interface MathLabEvents {
    'expr:added': { expr: Expression };
    'expr:removed': { id: number };
    'expr:toggled': { id: number; enabled: boolean };
    'expr:updated': { id: number; fnStr: string };
    'mode:changed': { mode: ViewMode };
    'camera:changed': { camMode: CamMode };
    'integral:calculated': { results: { id: number; value: number }[]; total: number };
    'coefficient:changed': { id: number };
    'selection:changed': { id: number | null; type: string | null };
}