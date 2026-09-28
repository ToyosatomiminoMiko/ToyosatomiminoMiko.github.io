// ================================================================
// OLED 像素画板(封装为 OLEDCanvas 类)
//
// 挂载形态与地铁车窗控制台 / 时钟一致:宿主是**空标签页窗格**(由
// src/common/ui/site_shell.ts 建好并交回引用),标记由 ui/oled_panel.ts 生成,
// 本文件只做行为 -- 画板需要的每个元素都由 OledPanel 一次交回,行为代码只按
// 引用操作,不按 id 回头查 DOM.
// ================================================================

import { create_element, type CodeEditorHandle, type SegmentedHandle } from 'miko_ui';

import type {
    PixelPos,
    DrawTool,
    ByteOrderMode,
    PixelColorMode,
    OLEDConfig,
    OledRgb,
    ImportResult,
    BresenhamCallback,
} from './types';
import { createOledPanel, type OledPanel } from './ui/oled_panel';
import {
    OLED_ALPHA_OPAQUE,
    OLED_BITS_PER_BYTE,
    OLED_BUFFER_BYTES,
    OLED_BYTE_ORDER_TEXT,
    OLED_BYTES_PER_PIXEL,
    OLED_BYTES_PER_SOURCE_LINE,
    OLED_CHANNEL_A_OFFSET,
    OLED_COLOR_LIT,
    OLED_COLOR_MODES,
    OLED_COLOR_UNLIT,
    OLED_CONTEXT_UNAVAILABLE,
    OLED_COORDS_EMPTY,
    OLED_COORDS_PREFIX,
    OLED_COPY_BUTTON_TEXT,
    OLED_COPY_FAILED_ALERT,
    OLED_COPY_FAILED_LOG,
    OLED_COPY_FEEDBACK_MS,
    OLED_COPY_SUCCESS_TEXT,
    OLED_DEFAULT_BYTE_ORDER,
    OLED_DEFAULT_COLOR_MODE,
    OLED_DEFAULT_CONFIG,
    OLED_DEFAULT_TOOL,
    OLED_DISPLAY_HIDDEN,
    OLED_DISPLAY_VISIBLE,
    OLED_EXPORT_ARRAY_LENGTH,
    OLED_EXPORT_ARRAY_NAME,
    OLED_HEX_BYTE_PATTERN,
    OLED_HEX_DIGITS_PER_BYTE,
    OLED_HEX_RADIX,
    OLED_IMPORT_FAILED_PREFIX,
    OLED_IMPORT_FORMAT_ERROR,
    OLED_IMPORT_SUCCESS_MESSAGE,
    OLED_MOUSE_BUTTON_MASK,
    OLED_MSB_TOP_BIT,
    OLED_PAGE_ROWS,
    OLED_PANEL_EDITOR_COLLAPSE_TEXT,
    OLED_PANEL_EDITOR_EXPAND_TEXT,
    OLED_PANEL_EDITOR_EXPANDED_CLASS,
    OLED_PNG_FILENAME,
    OLED_PREVIEW_HALF_PIXEL,
    OLED_PREVIEW_STROKE_WIDTH,
    OLED_RESIZE_DEBOUNCE_MS,
    fillRgb,
} from './config';

// ---------- 默认配置 ----------
// OLED_DEFAULT_CONFIG 集中定义于 oled/config.ts,保证画布尺寸/预览色只有一处定义.

export class OLEDCanvas {
    // ---- DOM 引用(全部由面板交回,构造函数里一次接好) ----
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly indicator: HTMLElement;
    private readonly coordsDisplay: HTMLElement;
    /** 数据编辑器(库的 `createCodeEditor` 句柄):导出写入 / 复制读取 / 导入读取都是这一颗 */
    private readonly dataEditor: CodeEditorHandle;
    private readonly copyBtn: HTMLButtonElement;
    private readonly byteOrderBtn: HTMLButtonElement;
    private readonly colorBtn: HTMLButtonElement;
    private readonly pngBtn: HTMLButtonElement;
    private readonly refillBtn: HTMLButtonElement;
    private readonly exportBtn: HTMLButtonElement;
    private readonly importBtn: HTMLButtonElement;
    /** 折叠 / 展开按钮(切数据编辑器的 `is-expanded` 类,见 toggleEditorExpanded) */
    private readonly editorToggleBtn: HTMLButtonElement;
    /** 绘图工具分段选择器(库的 `createSegmented` 句柄;选中回调在 bindEvents 里接) */
    private readonly toolSelect: SegmentedHandle<DrawTool>;

    // ======================
    // 画布初始化
    // ======================
    // 画笔颜色
    private pixelColorMode: PixelColorMode = OLED_DEFAULT_COLOR_MODE;

    // 'lsb' | 'msb' (低位/高位模式)
    private byteOrderMode: ByteOrderMode = OLED_DEFAULT_BYTE_ORDER;

    // 绘图工具设置
    private currentTool: DrawTool = OLED_DEFAULT_TOOL;

    // 记录位置,首次/最后按下
    private startPos: PixelPos | null = null;
    private lastPos: PixelPos | null = null;

    // 存储预览前的画布
    private previewImageData: ImageData | null = null;

    // 初始化画布(未绘制处 = 屏幕未亮起的中性灰,见 OLED_COLOR_UNLIT)
    private imageData: ImageData;

    // 坐标转换系统:画布在视口中的边界矩形.由构造函数末尾的 updateCanvasRect()
    // 首次写入,之后鼠标进入 / 滚动 / 窗口 resize 时重测(见 updateCanvasRect);
    // 字段用 definite assignment 断言,是因为写入发生在方法里.
    private canvasRect!: DOMRect;

    // 窗口事件监听
    private resizeTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly config: OLEDConfig;

    constructor(panel: OledPanel, config: Partial<OLEDConfig> = {}) {
        this.config = { ...OLED_DEFAULT_CONFIG, ...config };

        // DOM 引用全部来自面板(ui/oled_panel.ts 生成标记时一并交回):
        // 这里既不查 id,也不做"找不到元素"的容错分支 -- 标记与行为同源,
        // 交回来的元素必然存在.
        this.canvas = panel.canvas;
        this.indicator = panel.indicator;
        this.coordsDisplay = panel.coordsDisplay;
        this.dataEditor = panel.dataEditor;
        this.copyBtn = panel.copyButton;
        this.byteOrderBtn = panel.byteOrderButton;
        this.colorBtn = panel.colorButton;
        this.pngBtn = panel.pngButton;
        this.refillBtn = panel.refillButton;
        this.exportBtn = panel.exportButton;
        this.importBtn = panel.importButton;
        this.editorToggleBtn = panel.editorToggleButton;
        this.toolSelect = panel.toolSelect;

        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error(OLED_CONTEXT_UNAVAILABLE);
        this.ctx = ctx;

        // 设置物理像素尺寸(实际分辨率)
        this.canvas.width = this.config.width;
        this.canvas.height = this.config.height;

        // 初始化画布:未绘制处铺成"屏幕未亮起"的中性灰
        this.imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
        // 填充未亮起的底色(RGBA格式)
        for (let i = 0; i < this.imageData.data.length; i += OLED_BYTES_PER_PIXEL) {
            fillRgb(this.imageData.data, i, OLED_COLOR_UNLIT);
            // A(完全不透明)
            this.imageData.data[i + OLED_CHANNEL_A_OFFSET] = OLED_ALPHA_OPAQUE;
        }
        this.ctx.putImageData(this.imageData, 0, 0);

        // 颜色按钮一开始就显示当前模式(默认 light)的文案,不必等第一次点击
        this.applyColorMode();

        // 绑定事件,并量一次画布在视口中的位置(后续滚动 / resize / 鼠标进入时重测)
        this.bindEvents();
        this.updateCanvasRect();
    }

    // ======================
    // 事件绑定
    // ======================
    private bindEvents(): void {
        // --- 按钮事件(元素引用来自面板,不按 id 查找) ---
        this.refillBtn.addEventListener('click', () => this.refill());
        this.colorBtn.addEventListener('click', () => this.toggleColor());
        this.pngBtn.addEventListener('click', () => this.downloadPNG());
        this.byteOrderBtn.addEventListener('click', () => this.toggleByteOrder());
        this.copyBtn.addEventListener('click', () => this.copyExport());
        this.exportBtn.addEventListener('click', () => this.exportData());
        this.importBtn.addEventListener('click', () => {
            // 成功 / 失败都靠文案本身说明(见 config.ts 的两条结果文案),不加图标前缀
            const result = this.importDataFromText();
            alert(result.message);
        });
        this.editorToggleBtn.addEventListener('click', () => this.toggleEditorExpanded());

        // --- 绘图工具(库的分段选择器:用户选中哪一项由 onChange 报回来) ---
        this.toolSelect.onChange((tool) => this.setTool(tool));

        // ======================
        // 鼠标事件监听
        // ======================
        // 右键菜单关闭
        this.canvas.oncontextmenu = (e) => e.preventDefault();
        // 鼠标进入事件
        this.canvas.addEventListener('mouseenter', this.onMouseEnter);
        // 鼠标退出事件
        this.canvas.addEventListener('mouseleave', this.onMouseLeave);
        // 鼠标移动事件
        this.canvas.addEventListener('mousemove', this.onMouseMove);
        // 鼠标按下事件
        this.canvas.addEventListener('mousedown', this.onMouseDown);

        // ======================
        // 键盘事件监听
        // ======================
        // 按下 ESC 终止正在进行的直线 / 矩形绘制预览
        document.addEventListener('keydown', this.onKeyDown);

        // ======================
        // 窗口事件监听
        // ======================
        window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
        window.addEventListener('resize', this.onResize);
    }

    // ======================
    // 工具控制区
    // ======================
    /** 清除画板(整块铺成当前画笔颜色:暗 = 全部未亮,亮 = 全部点亮) */
    refill(): void {
        this.fillImageData(OLED_COLOR_MODES[this.pixelColorMode].pixelColor);
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    /**
     * 把当前画笔模式的读数刷到颜色按钮上.
     * 只改文案(亮起 1 / 未亮 0):按钮的底色与文字颜色全归 UI 库(`miko_ui`)
     * 的按钮基线,本站不给它写任何背景色.构造与切换共用这一处.
     */
    private applyColorMode(): void {
        this.colorBtn.textContent = OLED_COLOR_MODES[this.pixelColorMode].buttonText;
    }

    /** 画笔颜色切换 */
    toggleColor(): void {
        this.pixelColorMode = this.pixelColorMode === 'dark' ? 'light' : 'dark';
        this.applyColorMode();
    }

    /** 工具切换 */
    setTool(tool: DrawTool): void {
        this.currentTool = tool;
        this.startPos = null;
        this.previewImageData = null;
        this.ctx.putImageData(this.imageData, 0, 0); // 清除任何预览
    }

    /** 高地位模式切换 */
    toggleByteOrder(): void {
        this.byteOrderMode = this.byteOrderMode === 'lsb' ? 'msb' : 'lsb';
        this.byteOrderBtn.textContent = OLED_BYTE_ORDER_TEXT[this.byteOrderMode];
    }

    /**
     * 数据导出:把当前画布生成成 C 源码,写进数据框.
     * 数据框只有一颗,所以这一次写入会**覆盖**框里原有的内容(包括刚粘进去,
     * 还没导入的字节);导出的源码本身就是导入正则认的 `0x??` 形式,覆盖之后
     * 立刻点"导入数据"读回来的仍是同一幅图.
     */
    exportData(): void {
        const cSource = this.generateEmbeddedData();
        this.dataEditor.textarea.value = cSource;
        // 程序化写 `.value` 不派发 `input`:行号栏与高亮层要显式刷新一次
        // (库的 `CodeEditor.refresh`,它转给两个装饰件;见 ui/oled_panel.ts).
        this.dataEditor.refresh();
    }

    /** 下载PNG */
    downloadPNG(): void {
        // 这里的 <a> 是"临时下载触发器",不属于页面标记,但同样是 DOM 构造,
        // 照全站约定用库的 create_element 而不是 document.createElement.
        const link = create_element(
            { tag: 'a' },
            { download: OLED_PNG_FILENAME, href: this.canvas.toDataURL('image/png') },
        );
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /** 把数据框里的文本复制到剪贴板(带视觉反馈) */
    async copyExport(): Promise<void> {
        const textarea = this.dataEditor.textarea;
        try {
            // 使用现代 Clipboard API
            await navigator.clipboard.writeText(textarea.value);
            // 添加视觉反馈
            this.copyBtn.textContent = OLED_COPY_SUCCESS_TEXT;
            setTimeout(() => {
                this.copyBtn.textContent = OLED_COPY_BUTTON_TEXT;
            }, OLED_COPY_FEEDBACK_MS);
        } catch (err) {
            console.error(OLED_COPY_FAILED_LOG, err);
            alert(OLED_COPY_FAILED_ALERT);
        }
    }

    /** 数据导入:解析数据框里的十六进制字节(导出源码也能原样喂回来) */
    importDataFromText(): ImportResult {
        const input = this.dataEditor.textarea.value;
        try {
            // 提取十六进制数据
            const hexValues = input.match(OLED_HEX_BYTE_PATTERN);
            if (!hexValues || hexValues.length !== OLED_BUFFER_BYTES) {
                throw new Error(OLED_IMPORT_FORMAT_ERROR);
            }
            // 转换到Uint8Array
            const buffer = new Uint8Array(hexValues.map(v => parseInt(v, OLED_HEX_RADIX)));
            // 更新画布数据
            this.updateCanvasFromBuffer(buffer);
            return { success: true, message: OLED_IMPORT_SUCCESS_MESSAGE };
        } catch (e) {
            const err = e as Error;
            return { success: false, message: `${OLED_IMPORT_FAILED_PREFIX}${err.message}` };
        }
    }

    /**
     * 折叠 / 展开数据编辑器.
     *
     * 两种高度都是设计参数,留在样式表里(见 public/css/index.css 与 tokens.css):
     * 折叠态 = `--oled-editor-height`(同时也是最小高度),展开态 = 70 行的
     * `--oled-editor-expanded-height`.这里只切一个类名,并把按钮文案与
     * `aria-expanded` 同步过去.
     *
     * 为什么还要清一次内联 height:库的外框是 `overflow: hidden`,本站又给了
     * `resize: vertical`,用户手动拖过之后浏览器会在外框上留下内联 height --
     * 内联样式压得过样式表里的两种高度,不清掉的话"点了没反应".
     */
    toggleEditorExpanded(): void {
        const editor = this.dataEditor.element;
        const expanded = editor.classList.toggle(OLED_PANEL_EDITOR_EXPANDED_CLASS);
        editor.style.height = '';
        this.editorToggleBtn.textContent = expanded
            ? OLED_PANEL_EDITOR_COLLAPSE_TEXT
            : OLED_PANEL_EDITOR_EXPAND_TEXT;
        this.editorToggleBtn.setAttribute('aria-expanded', String(expanded));
    }

    // ======================
    // 绘图核心逻辑
    // ======================
    /** 把整块 imageData 铺成单一颜色(R/G/B 三通道,Alpha 不动) */
    private fillImageData(color: OledRgb): void {
        for (let i = 0; i < this.imageData.data.length; i += OLED_BYTES_PER_PIXEL) {
            fillRgb(this.imageData.data, i, color);
        }
    }

    /**
     * 设置单个像素颜色
     * @param x - X坐标
     * @param y - Y坐标
     */
    private setPixel(x: number, y: number): void {
        const index = (y * this.canvas.width + x) * OLED_BYTES_PER_PIXEL;
        const color = OLED_COLOR_MODES[this.pixelColorMode].pixelColor;
        // 注意:保留Alpha通道不变
        fillRgb(this.imageData.data, index, color);
    }

    /**
     * Bresenham 直线通用迭代器
     * 遍历直线上的所有像素坐标,每到一个点就调用回调函数
     * @param x1 - 起点X
     * @param y1 - 起点Y
     * @param x2 - 终点X
     * @param y2 - 终点Y
     * @param callback - (x, y) => void
     */
    private walkBresenham(
        x1: number, y1: number,
        x2: number, y2: number,
        callback: BresenhamCallback
    ): void {
        const dx = Math.abs(x2 - x1);
        const dy = -Math.abs(y2 - y1);
        const sx = x1 < x2 ? 1 : -1;
        const sy = y1 < y2 ? 1 : -1;
        let err = dx + dy;

        while (true) {
            callback(x1, y1); // 每走一步,执行回调

            if (x1 === x2 && y1 === y2) break;
            const e2 = 2 * err;
            if (e2 >= dy) {
                err += dy;
                x1 += sx;
            }
            if (e2 <= dx) {
                err += dx;
                y1 += sy;
            }
        }
    }

    /** 绘制实线(修改 imageData) */
    private drawLine(x1: number, y1: number, x2: number, y2: number): void {
        // 直接调用迭代器,回调函数就是 setPixel
        this.walkBresenham(x1, y1, x2, y2, (x, y) => this.setPixel(x, y));
    }

    /**
     * 在离屏画布上画一层预览,再整层叠回主画布.
     * 离屏画布初始全透明,回调画下的记号盖到主画布上,透明处不覆盖 -- 所以主画布
     * 必须先恢复成"鼠标刚按下"时的干净快照(由调用方 putImageData).
     * 离屏 canvas 只作临时缓冲,不进文档也不是站点元素,故直接用
     * document.createElement,不走 miko_ui 的 create_element.
     */
    private drawPreviewLayer(draw: (ctx: CanvasRenderingContext2D) => void): void {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.canvas.width;
        tempCanvas.height = this.canvas.height;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.imageSmoothingEnabled = false;
        draw(tempCtx);
        this.ctx.drawImage(tempCanvas, 0, 0);
    }

    /**
     * 实时预览直线(不修改实际图像数据)
     * @param endX - 终点X坐标
     * @param endY - 终点Y坐标
     */
    private previewLine(endX: number, endY: number): void {
        if (!this.previewImageData || !this.startPos) return;
        const start = this.startPos;
        // 1. 恢复预览前状态,擦掉上一帧预览
        this.ctx.putImageData(this.previewImageData, 0, 0);

        // 2. 在离屏画布上逐点画预览(直线用 fillRect,颜色只能走 fillStyle)
        this.drawPreviewLayer((tempCtx) => {
            tempCtx.fillStyle = this.config.previewColor;
            tempCtx.globalAlpha = this.config.previewOpacity;
            this.walkBresenham(start.x, start.y, endX, endY, (x, y) => {
                tempCtx.fillRect(x, y, 1, 1);
            });
        });
    }

    /** 矩形绘制逻辑 */
    private drawRectangle(x1: number, y1: number, x2: number, y2: number): void {
        // 计算矩形边界
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const top = Math.min(y1, y2);
        const bottom = Math.max(y1, y2);
        // 绘制顶部和底部边框
        for (let x = left; x <= right; x++) {
            this.setPixel(x, top);
            this.setPixel(x, bottom);
        }
        // 绘制左右边框 排除角点避免重复
        for (let y = top + 1; y < bottom; y++) {
            this.setPixel(left, y);
            this.setPixel(right, y);
        }
    }

    /**
     * 预览矩形(不修改实际图像数据)
     * @param endX - 终点X坐标
     * @param endY - 终点Y坐标
     */
    private previewRectangle(endX: number, endY: number): void {
        if (!this.previewImageData || !this.startPos) return;
        const start = this.startPos;
        // 1. 恢复预览前状态,擦掉上一帧预览
        this.ctx.putImageData(this.previewImageData, 0, 0);

        // 2. 在离屏画布上描出预览矩形(离屏画布初始透明,只有描边会叠到主画布)
        this.drawPreviewLayer((tempCtx) => {
            tempCtx.strokeStyle = this.config.previewColor;
            tempCtx.globalAlpha = this.config.previewOpacity;
            tempCtx.lineWidth = OLED_PREVIEW_STROKE_WIDTH;

            // 加半像素偏移,让 1px 描边落在像素上而不是跨在像素缝里(见 OLED_PREVIEW_HALF_PIXEL)
            const x = Math.min(start.x, endX) + OLED_PREVIEW_HALF_PIXEL;
            const y = Math.min(start.y, endY) + OLED_PREVIEW_HALF_PIXEL;
            const w = Math.abs(endX - start.x);
            const h = Math.abs(endY - start.y);
            tempCtx.strokeRect(x, y, w, h);
        });
    }

    // ======================
    // 数据生成模块
    // ======================
    /**
     * 页内第 bit 位对应的画布行号.
     * LSB 模式的页顶是 bit0,MSB 模式的页顶是 bit7(见 OLED_MSB_TOP_BIT)--
     * "页顶"落在哪一位上两种约定相反,导入 / 导出共用这一个换算.
     */
    private pageRowY(page: number, bit: number): number {
        return this.byteOrderMode === 'lsb'
            ? page * OLED_PAGE_ROWS + bit
            : page * OLED_PAGE_ROWS + (OLED_MSB_TOP_BIT - bit);
    }

    private generateEmbeddedData(): string {
        const pageCount = this.canvas.height / OLED_PAGE_ROWS;
        const buffer = new Uint8Array(this.canvas.width * pageCount);
        // 逐页逐列把一竖排像素按位序压成一个字节
        for (let page = 0; page < pageCount; page++) {
            for (let x = 0; x < this.canvas.width; x++) {
                let byte = 0;
                for (let bit = 0; bit < OLED_BITS_PER_BYTE; bit++) {
                    const y = this.pageRowY(page, bit);
                    const idx = (y * this.canvas.width + x) * OLED_BYTES_PER_PIXEL;
                    // 屏幕亮起的青为 1,未亮的中性灰为 0
                    const isLit =
                        this.imageData.data[idx] === OLED_COLOR_LIT.r &&
                        this.imageData.data[idx + 1] === OLED_COLOR_LIT.g &&
                        this.imageData.data[idx + 2] === OLED_COLOR_LIT.b;
                    byte |= (isLit ? 1 : 0) << bit;
                }
                buffer[page * this.canvas.width + x] = byte;
            }
        }

        // 格式化为 C 源码
        let cSource = `const uint8_t ${OLED_EXPORT_ARRAY_NAME}[${OLED_EXPORT_ARRAY_LENGTH}] = {\n    `;
        buffer.forEach((byte, i) => {
            cSource += `0x${byte.toString(OLED_HEX_RADIX).padStart(OLED_HEX_DIGITS_PER_BYTE, '0')}`;
            cSource += i !== buffer.length - 1 ? ', ' : '';
            if ((i + 1) % OLED_BYTES_PER_SOURCE_LINE === 0) cSource += '\n    ';
        });
        cSource += '\n};';

        return cSource;
    }

    // ======================
    // 缓冲数据转画布图像
    // ======================
    private updateCanvasFromBuffer(buffer: Uint8Array): void {
        // 先整块重置为未亮起的中性灰
        this.fillImageData(OLED_COLOR_UNLIT);
        // 逐页逐列把字节的每一位摊回像素(位序换算见 pageRowY)
        const pageCount = this.canvas.height / OLED_PAGE_ROWS;
        for (let page = 0; page < pageCount; page++) {
            for (let x = 0; x < this.canvas.width; x++) {
                const byte = buffer[page * this.canvas.width + x];
                for (let bit = 0; bit < OLED_BITS_PER_BYTE; bit++) {
                    const y = this.pageRowY(page, bit);
                    const isLit = (byte & (1 << bit)) !== 0;
                    const index = (y * this.canvas.width + x) * OLED_BYTES_PER_PIXEL;
                    fillRgb(this.imageData.data, index, isLit ? OLED_COLOR_LIT : OLED_COLOR_UNLIT);
                }
            }
        }
        // 更新画布显示
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    // ======================
    // 鼠标 / 键盘 / 窗口 事件处理
    // ======================

    // 重新测量画布在视口中的边界矩形(构造 / 鼠标进入 / 滚动 / 窗口 resize 时调用)
    private updateCanvasRect(): void {
        this.canvasRect = this.canvas.getBoundingClientRect();
    }

    /**
     * 将鼠标坐标转换为画布像素坐标
     * @param event - 鼠标事件对象
     * @returns 包含x,y的像素坐标对象
     */
    private getPixelPosition(event: MouseEvent): PixelPos {
        // 夹到 [0, 尺寸 - 1]:指针压在画布外沿或边框上时也能得到合法像素,
        // 下游(updateIndicator / 绘制)因此可以直接使用,不必再夹一次.
        return {
            x: Math.min(
                this.canvas.width - 1,
                Math.max(
                    0,
                    Math.floor(
                        ((event.clientX - this.canvasRect.left) / this.canvasRect.width) * this.canvas.width
                    )
                )
            ),
            y: Math.min(
                this.canvas.height - 1,
                Math.max(
                    0,
                    Math.floor(
                        ((event.clientY - this.canvasRect.top) / this.canvasRect.height) * this.canvas.height
                    )
                )
            ),
        };
    }

    // 更新指示器位置(pos 已由 getPixelPosition 夹进画布范围)
    private updateIndicator(pos: PixelPos): void {
        const pixelWidth = this.canvasRect.width / this.canvas.width;
        const pixelHeight = this.canvasRect.height / this.canvas.height;

        // 精确对齐像素边界
        this.indicator.style.left = `${this.canvasRect.left + pos.x * pixelWidth}px`;
        this.indicator.style.top = `${this.canvasRect.top + pos.y * pixelHeight}px`;

        // 动态调整指示器尺寸
        this.indicator.style.width = `${Math.ceil(pixelWidth)}px`;
        this.indicator.style.height = `${Math.ceil(pixelHeight)}px`;

        // 保持可见性
        this.indicator.style.display = OLED_DISPLAY_VISIBLE;
        this.coordsDisplay.style.display = OLED_DISPLAY_VISIBLE;
    }

    // ======================
    // coordsDisplay
    // ======================
    /**
     * 更新坐标显示 实时显示鼠标坐标
     * @param pos - 包含x,y的坐标对象
     */
    private updateCoordsDisplay(pos: PixelPos): void {
        this.coordsDisplay.textContent = `${OLED_COORDS_PREFIX}(X:${pos.x},Y:${pos.y})`;
    }

    // ---- 事件回调(箭头函数保持 this 指向) ----

    private onMouseEnter = (): void => {
        this.updateCanvasRect();
    };

    private onMouseLeave = (): void => {
        // 隐藏画笔
        this.indicator.style.display = OLED_DISPLAY_HIDDEN;
        // 重置坐标指示
        this.coordsDisplay.textContent = OLED_COORDS_EMPTY;
    };

    private onMouseDown = (e: MouseEvent): void => {
        const pos = this.getPixelPosition(e);
        // 根据当前工具类型执行对应的绘制操作
        switch (this.currentTool) {
            case 'free':
                // 自由画笔: 直接设置当前像素并更新画布, 同时记录最后位置用于连续绘制
                this.setPixel(pos.x, pos.y);
                this.ctx.putImageData(this.imageData, 0, 0);
                this.lastPos = pos;
                break;
            case 'line':
                // 直线工具: 首次点击记录起点并保存预览状态, 再次点击绘制实际直线
                if (!this.startPos) {
                    this.startPos = pos;
                    this.previewImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
                } else {
                    this.drawLine(this.startPos.x, this.startPos.y, pos.x, pos.y);
                    this.ctx.putImageData(this.imageData, 0, 0);
                    this.startPos = null;
                }
                break;
            case 'rectangle':
                // 矩形工具: 首次点击记录起点并保存预览状态, 再次点击绘制实际矩形边框
                if (!this.startPos) {
                    this.startPos = pos;
                    this.previewImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
                } else {
                    this.drawRectangle(this.startPos.x, this.startPos.y, pos.x, pos.y);
                    this.ctx.putImageData(this.imageData, 0, 0);
                    this.startPos = null;
                }
                break;
        }
    };

    private onMouseMove = (e: MouseEvent): void => {
        const pos = this.getPixelPosition(e);
        this.updateCoordsDisplay(pos);
        this.updateIndicator(pos);

        // 直线预览模式
        if (this.currentTool === 'line' && this.startPos) {
            this.previewLine(pos.x, pos.y);
            return; // 阻断自由绘制逻辑
        }
        // 自由绘制模式(仅在非直线工具时生效)
        else if (this.currentTool === 'free' && (e.buttons & OLED_MOUSE_BUTTON_MASK)) {
            if (this.lastPos) {
                // 两次采样之间可能跨过多个像素,用直线补齐这一段,快速移动时不会漏点
                this.drawLine(this.lastPos.x, this.lastPos.y, pos.x, pos.y);
            } else {
                this.setPixel(pos.x, pos.y);
            }
            this.ctx.putImageData(this.imageData, 0, 0);
            this.lastPos = pos;
        }
        // 矩形预览模式
        else if (this.currentTool === 'rectangle' && this.startPos) {
            this.previewRectangle(pos.x, pos.y);
            return;
        }
    };

    private onKeyDown = (e: KeyboardEvent): void => {
        // 按下 `ESC` 终止正在进行的直线 / 矩形绘制预览
        if (
            e.key === 'Escape' &&
            (this.currentTool === 'line' || this.currentTool === 'rectangle') &&
            this.startPos
        ) {
            // 恢复预览前状态
            if (this.previewImageData) {
                this.ctx.putImageData(this.previewImageData, 0, 0);
            }
            // 重置绘制状态
            this.startPos = null;
            this.previewImageData = null;
        }
    };

    private onScroll = (): void => {
        this.updateCanvasRect();
    };

    private onResize = (): void => {
        if (this.resizeTimer) clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => this.updateCanvasRect(), OLED_RESIZE_DEBOUNCE_MS);
    };
}

// ======================
// 挂载
// ======================
/**
 * 把 OLED 像素画板挂到宿主上(独立标签页窗格,见 src/main.ts).
 *
 * 分工与 clock / RBT 一致:标记由 ui/oled_panel.ts 的纯函数生成,这里只负责
 * "插进宿主 + 起行为".宿主由 common/ui/site_shell.ts 交回,所以不查 DOM.
 *
 * 用 replaceChildren 而不是 append:宿主就是本模块的面板容器(标签页窗格本身),
 * 重复挂载时整体替换,不会留下两份同 id 的标记.
 */
export function mountOLED(host: HTMLElement): void {
    const panel = createOledPanel();
    host.replaceChildren(panel.root);
    new OLEDCanvas(panel);
}
