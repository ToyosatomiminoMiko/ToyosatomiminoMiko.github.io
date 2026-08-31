import type { CamMode, ViewHome } from '../render/types';

/**
 * 跨层事件映射.
 *
 * 新问题/待办:
 * - `service` 现在依赖 `compiler/ir` 和 `render`,不再是纯粹无依赖的基础层;
 *   若后续要保持 service 可复用,可把相机事件类型下沉到 `render/events.ts`,
 *   这里只保留 EventBus 本身.
 * - 已删除当前没有任何 emit 的 `mathobj:*` 事件;未来若要恢复对象生命周期事件,
 *   必须先接入实际 emit 点,避免再次留下 dead event keys.
 */
export interface MathLabEvents {
    'camera:changed': { camMode: CamMode };
    'camera:view': { view: ViewHome };
    'camera:rotationLock': { locked: boolean };
    'axis:lineWidthChanged': { width: number };
    'origin:changed': { radius: number; visible: boolean };
    'coefficient:changed': { id: number };
    'selection:changed': { id: number | null; kind: string | null };
}
