/**
 * DSL 编辑器行号栏.
 *
 * 为什么"textarea 加行号"听起来简单却难实现:
 * 原生 textarea 的内部滚动区无法再渲染"每行一个数字",行号只能做在
 * 旁边的独立元素里,于是难点变成数字必须与文本**逐像素对齐**,三个坑:
 * 1. 软换行:textarea 默认把长行折成多个视觉行,行号(按 \n 计)就无法
 *    一一对应--所以这里关闭软换行(white-space: pre),让 源码行 == 视觉行;
 * 2. 行高对齐:gutter 与 textarea 必须同字体/字号/行高,且首行起始位置
 *    一致(见 panels.css 中 padding-top 的推导注释);
 * 3. 滚动同步:文本在 textarea 内部滚动,行号在外部,只能用
 *    translateY(-scrollTop) 跟随,并在 scroll / input / 容器尺寸变化
 *    (面板折叠,拖宽拖高)时重同步.
 *
 * 三件事由 CSS 与 HTML 结构约束住之后,这里的逻辑只剩两条:
 * 按 \n 计数重绘行号 + 按 scrollTop 反向平移.
 */
export class EditorLineNumbers {
    private readonly numbers: HTMLPreElement;
    private readonly resizeObserver: ResizeObserver;
    private disposed = false;

    constructor(private readonly editor: HTMLTextAreaElement) {
        const box = editor.parentElement as HTMLElement;
        const gutter = box.querySelector<HTMLDivElement>('#dsl-editor-gutter');
        const numbers = box.querySelector<HTMLPreElement>('#dsl-editor-lines');
        if (!gutter || !numbers) {
            throw new Error('EditorLineNumbers 缺少 #dsl-editor-gutter / #dsl-editor-lines 结构');
        }
        this.numbers = numbers;

        // 输入(含粘贴/撤销/IME 组字)只改行数,重绘行号;
        // 内部滚动只改偏移,平移即可.
        editor.addEventListener('input', this.update);
        editor.addEventListener('scroll', this.sync, { passive: true });

        // 面板折叠/展开,拖宽会改变容器尺寸:行号内容只取决于文本,
        // 尺寸变化不重算行数,只需校准一次平移(scrollTop 可能被重置).
        this.resizeObserver = new ResizeObserver(() => this.sync());
        this.resizeObserver.observe(box);

        this.update();
    }

    /** input / 初始化:按 \n 重算行数并重绘,再校准一次平移. */
    private readonly update = (): void => {
        const lineCount = this.editor.value.split('\n').length;
        const buffer: string[] = [];
        for (let i = 1; i <= lineCount; i += 1) buffer.push(String(i));
        this.numbers.textContent = buffer.join('\n');
        this.sync();
    };

    /** scroll / 尺寸变化:textarea 内部滚了多少,行号就反向平移多少. */
    private readonly sync = (): void => {
        if (this.disposed) return;
        this.numbers.style.transform = `translateY(${-this.editor.scrollTop}px)`;
    };

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.editor.removeEventListener('input', this.update);
        this.editor.removeEventListener('scroll', this.sync);
        this.resizeObserver.disconnect();
    }
}
