import type { MathObject } from '../../math_objects/types';

/** 标签页接口:每个详情标签页都实现此接口 */
export interface Tab {
    /** 渲染标签页内容到 container */
    render(obj: MathObject): void;
    /** 清理事件监听器、定时器等 */
    destroy(): void;
    /** 该标签页对当前选中的 kind 是否可见 */
    isVisible(kind: string | null): boolean;
}