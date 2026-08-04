/**
 * 颜色管理器 —— 从预置色板中循环取色
 */
export class ColorManager {
    private _palette: string[];
    private _index: number;

    constructor(palette: readonly string[]) {
        this._palette = [...palette];
        this._index = 0;
    }

    /** 取下一个颜色（循环） */
    next(): string {
        const c = this._palette[this._index % this._palette.length];
        this._index++;
        return c;
    }

    /** 重置取色位置 */
    reset(): void {
        this._index = 0;
    }
}