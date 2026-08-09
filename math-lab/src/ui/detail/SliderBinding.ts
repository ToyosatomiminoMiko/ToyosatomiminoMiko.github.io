/**
 * SliderBinding – 通用滑块 <-> 数值输入双向同步
 *
 * 约定一个 .coeff-row 内包含:
 *   <label>名称</label>
 *   <input type="range" class="coeff-slider" data-coeff="name" />
 *   <input type="number" class="coeff-value" data-coeff="name" />
 *
 * 用法:
 *   const cleanup = SliderBinding.bindAll(container, (name, value) => { ... });
 *   // 销毁时调用 cleanup()
 */

export type CoeffChangeCallback = (name: string, value: number) => void;

export class SliderBinding {
    static bindAll(
        container: HTMLElement,
        onChange: CoeffChangeCallback,
        options?: { debounceMs?: number },
    ): () => void {
        const abortController = new AbortController();
        const signal = abortController.signal;
        const debounceMs = options?.debounceMs ?? 50; // 默认 50ms 防抖

        const timers = new Map<string, ReturnType<typeof setTimeout>>();

        // 通用处理:根据 slider 或 number 输入 统一回调
        const handleChange = (coeffName: string, rawValue: string) => {
            // performance.mark('slider-input');
            const val = parseFloat(rawValue);
            if (isNaN(val)) return;

            // 防抖
            if (timers.has(coeffName)) clearTimeout(timers.get(coeffName));
            timers.set(
                coeffName,
                setTimeout(() => {
                    // performance.mark('slider-callback');
                    // performance.measure('slider', 'slider-input', 'slider-callback');
                    onChange(coeffName, val);
                    timers.delete(coeffName);
                }, debounceMs),
            );
        };

        // 事件委托:监听整个容器的 input 事件
        container.addEventListener(
            'input',
            (e: Event) => {
                const target = e.target as HTMLElement;
                if (!target) return;

                const row = target.closest('.coeff-row') as HTMLElement | null;
                if (!row) return;

                // 获取 slider 和 number 元素
                const slider = row.querySelector<HTMLInputElement>('.coeff-slider');
                const numInput = row.querySelector<HTMLInputElement>('.coeff-value');
                if (!slider || !numInput) return;

                const coeffName = slider.dataset.coeff || numInput.dataset.coeff;
                if (!coeffName) return;

                // 同步:根据触发来源决定同步方向
                if (target === slider) {
                    // slider 拖动了 同步到 number
                    numInput.value = parseFloat(slider.value).toFixed(2);
                    handleChange(coeffName, slider.value);
                } else if (target === numInput) {
                    // number 输入了 先钳位再同步到 slider
                    let val = parseFloat(numInput.value);
                    if (isNaN(val)) return;
                    const min = parseFloat(slider.min) || 0;
                    const max = parseFloat(slider.max) || 10;
                    val = Math.max(min, Math.min(max, val));
                    numInput.value = val.toFixed(2);
                    slider.value = String(val);
                    handleChange(coeffName, String(val));
                }
            },
            { signal },
        );

        // 返回清理函数
        return () => {
            abortController.abort();
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
        };
    }
}