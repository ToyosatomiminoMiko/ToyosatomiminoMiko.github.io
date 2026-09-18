/**
 * 指针风场 -- 纯状态机,不自己绑事件,不碰 DOM,因此可以直接单测.
 * 由 EmberWebGPU 把 pointermove / pointerleave 喂进来.
 *
 * 语义: 指针位置是一股"风",越近推得越开;停手一段时间后自然衰减回 0.
 */
import { POINTER_IDLE_AFTER_MS, POINTER_MIN_DT, POINTER_OFFSCREEN, POINTER_SMOOTHING } from './config';

export class PointerWind {
    private pointerX = -POINTER_OFFSCREEN;
    private pointerY = -POINTER_OFFSCREEN;
    private lastMoveTime = 0;
    private targetStrength = 0;
    private currentStrength = 0;

    constructor(
        private readonly now: () => number = () => performance.now(),
        /** 停手多久后开始衰减(ms) */
        private readonly idleAfterMs = POINTER_IDLE_AFTER_MS
    ) {}

    get x(): number {
        return this.pointerX;
    }

    get y(): number {
        return this.pointerY;
    }

    /** 0 = 无交互, 1 = 全力 */
    get strength(): number {
        return this.currentStrength;
    }

    /** 指针移动到某个位置(逻辑像素) */
    moveTo(clientX: number, clientY: number): void {
        this.pointerX = clientX;
        this.pointerY = clientY;
        this.lastMoveTime = this.now();
        this.targetStrength = 1;
    }

    /** 指针离开 / 窗口失焦 */
    release(): void {
        this.targetStrength = 0;
        this.lastMoveTime = 0;
    }

    /** 按 dt 平滑逼近目标强度 */
    update(dt: number): void {
        if (this.now() - this.lastMoveTime > this.idleAfterMs) this.targetStrength = 0;
        // dt 为 0(不足一个仿真步)时也留一点最小推进,避免强度卡死
        this.currentStrength +=
            (this.targetStrength - this.currentStrength) *
            Math.min(1, Math.max(dt, POINTER_MIN_DT) * POINTER_SMOOTHING);
    }
}
