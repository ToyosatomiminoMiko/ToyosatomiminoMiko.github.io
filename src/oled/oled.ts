// ================================================================
// OLED 像素画板(封装为 OLEDCanvas 类)
//
// 挂载形态与地铁车窗控制台 / 时钟一致:宿主是**空标签页窗格**(由
// src/common/ui/site_shell.ts 建好并交回引用),标记由 ui/oled_panel.ts 生成,
// 本文件只做行为 -- 画板需要的每个元素都由 OledPanel 一次交回,
// 不再有 `document.getElementById` / `querySelectorAll` 之类的"回头查 DOM".
// ================================================================

import { h } from '@/common/dom';
import type {
    PixelPos,
    DrawTool,
    ByteOrderMode,
    PixelColorMode,
    OLEDConfig,
    ImportResult,
    BresenhamCallback,
} from './types';
import { createOledPanel, type OledPanel } from './ui/oled_panel';
import {
    OLED_BITS_PER_BYTE,
    OLED_BUFFER_BYTES,
    OLED_BYTE_ORDER_TEXT,
    OLED_BYTES_PER_PIXEL,
    OLED_BYTES_PER_SOURCE_LINE,
    OLED_CHANNEL_A_OFFSET,
    OLED_COLOR_MODES,
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
    OLED_PNG_FILENAME,
    OLED_PREVIEW_COMPOSITE_OPERATION,
    OLED_PREVIEW_HALF_PIXEL,
    OLED_PREVIEW_STROKE_WIDTH,
    OLED_RESIZE_DEBOUNCE_MS,
    OLED_VALUE_BLACK,
    OLED_VALUE_WHITE,
    fillRgb,
} from './config';

// ---------- 默认配置 ----------
/** 默认配置(集中定义于 oled/config.ts,保证画布尺寸/预览色只有一处定义) */
const DEFAULT_CONFIG: OLEDConfig = OLED_DEFAULT_CONFIG;

export class OLEDCanvas {
    // ---- DOM 引用(全部由面板交回,构造函数里一次接好) ----
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly indicator: HTMLElement;
    private readonly coordsDisplay: HTMLElement;
    private readonly exportTextarea: HTMLTextAreaElement;
    private readonly importTextarea: HTMLTextAreaElement;
    private readonly copyBtn: HTMLButtonElement;
    private readonly byteOrderBtn: HTMLButtonElement;
    private readonly colorBtn: HTMLButtonElement;
    private readonly pngBtn: HTMLButtonElement;
    private readonly refillBtn: HTMLButtonElement;
    private readonly exportBtn: HTMLButtonElement;
    private readonly importBtn: HTMLButtonElement;
    private readonly toolRadios: readonly HTMLInputElement[];

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

    // 初始化白色画布
    private imageData: ImageData;

    // 坐标转换系统
    private canvasRect: DOMRect;

    // 窗口事件监听
    private resizeTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly config: OLEDConfig;

    constructor(panel: OledPanel, config: Partial<OLEDConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        // DOM 引用全部来自面板(ui/oled_panel.ts 生成标记时一并交回):
        // 这里既不查 id,也不做"找不到元素"的容错分支 -- 标记与行为同源之后,
        // 元素必然存在,原先的 OLED_CANVAS_MISSING_MESSAGE 也随之失去意义.
        this.canvas = panel.canvas;
        this.indicator = panel.indicator;
        this.coordsDisplay = panel.coordsDisplay;
        this.exportTextarea = panel.exportTextarea;
        this.importTextarea = panel.importTextarea;
        this.copyBtn = panel.copyButton;
        this.byteOrderBtn = panel.byteOrderButton;
        this.colorBtn = panel.colorButton;
        this.pngBtn = panel.pngButton;
        this.refillBtn = panel.refillButton;
        this.exportBtn = panel.exportButton;
        this.importBtn = panel.importButton;
        this.toolRadios = panel.toolRadios;

        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error(OLED_CONTEXT_UNAVAILABLE);
        this.ctx = ctx;

        // 设置物理像素尺寸(实际分辨率)
        this.canvas.width = this.config.width;   // Embedded 的典型宽度
        this.canvas.height = this.config.height; // Embedded 的典型高度

        // 初始化白色画布
        this.imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
        // 填充白色背景(RGBA格式)
        for (let i = 0; i < this.imageData.data.length; i += OLED_BYTES_PER_PIXEL) {
            fillRgb(this.imageData.data, i, OLED_VALUE_WHITE);
            // A(完全不透明)
            this.imageData.data[i + OLED_CHANNEL_A_OFFSET] = OLED_VALUE_WHITE;
        }
        this.ctx.putImageData(this.imageData, 0, 0);

        // 获取初始边界矩形
        this.canvasRect = this.canvas.getBoundingClientRect();

        // 绑定事件
        this.bindEvents();
        this.updateCanvasRect();
    }

    /*
    操作逻辑
    */
    // ======================
    // 事件绑定
    // ======================
    private bindEvents(): void {
        // --- 按钮事件(元素引用来自面板,不再按 id 查找) ---
        this.refillBtn.addEventListener('click', () => this.refill());
        this.colorBtn.addEventListener('click', () => this.toggleColor());
        this.pngBtn.addEventListener('click', () => this.downloadPNG());
        this.byteOrderBtn.addEventListener('click', () => this.toggleByteOrder());
        this.copyBtn.addEventListener('click', () => this.copyExport());
        this.exportBtn.addEventListener('click', () => this.exportData());
        this.importBtn.addEventListener('click', () => {
            const result = this.importDataFromText();
            alert((result.success ? '✅' : '❌') + result.message);
        });

        // --- 工具 radio(面板交回的三项,顺序即 free / line / rectangle) ---
        this.toolRadios.forEach(radio => {
            radio.addEventListener('change', () => this.setTool(radio.value as DrawTool));
        });

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
        // 按下`ESC`终止直线绘制
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
    /** 清除画板 */
    refill(): void {
        const val = OLED_COLOR_MODES[this.pixelColorMode].pixelValue;
        for (let i = 0; i < this.imageData.data.length; i += OLED_BYTES_PER_PIXEL) {
            fillRgb(this.imageData.data, i, val);
        }
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    /** 画笔颜色切换 */
    toggleColor(): void {
        this.pixelColorMode = this.pixelColorMode === 'dark' ? 'light' : 'dark';
        const mode = OLED_COLOR_MODES[this.pixelColorMode];
        this.colorBtn.textContent = mode.buttonText;
        this.colorBtn.style.color = mode.buttonTextColor;
        this.colorBtn.style.backgroundColor = mode.buttonBackgroundColor;
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

    /** 数据导出 */
    exportData(): string {
        const cSource = this.generateEmbeddedData();
        this.exportTextarea.value = cSource;
        return cSource;
    }

    /** 下载PNG */
    downloadPNG(): void {
        // 这里的 <a> 是"临时下载触发器",不属于页面标记,但同样是 DOM 构造,
        // 照全站约定用 h() 而不是 document.createElement.
        const link = h('a', {
            attrs: { download: OLED_PNG_FILENAME, href: this.canvas.toDataURL('image/png') },
        });
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /** 复制导出数据到剪贴板(带视觉反馈) */
    async copyExport(): Promise<void> {
        const textarea = this.exportTextarea;
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

    /** 数据导入 */
    importDataFromText(): ImportResult {
        const input = this.importTextarea.value;
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

    // ======================
    // 绘图核心逻辑
    // ======================
    /**
     * 设置单个像素颜色
     * @param x - X坐标
     * @param y - Y坐标
     */
    private setPixel(x: number, y: number): void {
        const index = (y * this.canvas.width + x) * OLED_BYTES_PER_PIXEL;
        const val = OLED_COLOR_MODES[this.pixelColorMode].pixelValue;
        // 注意:保留Alpha通道不变
        fillRgb(this.imageData.data, index, val);
    }

    // Bresenham 直线通用迭代器 (核心抽离)
    /**
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
     * 实时预览直线(不修改实际图像数据)
     * @param endX - 终点X坐标
     * @param endY - 终点Y坐标
     */
    private previewLine(endX: number, endY: number): void {
        if (!this.previewImageData || !this.startPos) return;
        // 1. 恢复预览前状态
        this.ctx.putImageData(this.previewImageData, 0, 0);

        // 2. 创建临时canvas实现预览效果
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.canvas.width;
        tempCanvas.height = this.canvas.height;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.imageSmoothingEnabled = false;

        // 使用混合模式保持二值化核心
        tempCtx.globalCompositeOperation = OLED_PREVIEW_COMPOSITE_OPERATION;
        tempCtx.fillStyle = this.config.previewColor; // 直线必须fillStyle
        tempCtx.globalAlpha = this.config.previewOpacity;

        // 3. 调用迭代器,在临时画布上画红色半透明点
        this.walkBresenham(this.startPos.x, this.startPos.y, endX, endY, (x, y) => {
            tempCtx.fillRect(x, y, 1, 1);
        });

        // 4. 叠加到主画布
        this.ctx.drawImage(tempCanvas, 0, 0);
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

    /** 预览矩形 */
    private previewRectangle(endX: number, endY: number): void {
        if (!this.previewImageData || !this.startPos) return;
        // ===========================================
        // 1. 把主画布恢复到"鼠标刚按下时"的状态
        // previewImageData 是从 mousedown 时捕获的干净快照
        // 这一步会擦除上一帧的预览矩形
        // ===========================================
        this.ctx.putImageData(this.previewImageData, 0, 0);

        // ===========================================
        // 2. 创建一个完全独立的离屏 canvas
        // 它和主画布没有任何关系
        // ===========================================
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.canvas.width;   // 128
        tempCanvas.height = this.canvas.height; // 64
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.imageSmoothingEnabled = false;

        // ===========================================
        // 3. 在离屏 canvas 上绘制红色预览矩形
        // 离屏 canvas 初始是透明的(所有像素 RGBA = 0,0,0,0)
        // 所以只会有红色矩形,其余区域透明
        // ===========================================
        tempCtx.strokeStyle = this.config.previewColor;
        tempCtx.globalAlpha = this.config.previewOpacity;
        tempCtx.lineWidth = OLED_PREVIEW_STROKE_WIDTH;

        const x = Math.min(this.startPos.x, endX) + OLED_PREVIEW_HALF_PIXEL;
        const y = Math.min(this.startPos.y, endY) + OLED_PREVIEW_HALF_PIXEL;
        const w = Math.abs(endX - this.startPos.x);
        const h = Math.abs(endY - this.startPos.y);
        tempCtx.strokeRect(x, y, w, h);

        // ===========================================
        // 4. 将离屏 canvas 叠加到主画布上
        // 透明区域不会影响主画布
        // 红色半透明矩形会叠加显示
        // ⚠️ 这不会修改 imageData 对象
        // ===========================================
        this.ctx.drawImage(tempCanvas, 0, 0);
    }

    // ======================
    // 数据生成模块
    // ======================
    private generateEmbeddedData(): string {
        const buffer = new Uint8Array(this.canvas.width * (this.canvas.height / OLED_PAGE_ROWS)); // 128列 x 8页
        // 遍历每个页(8页,每页8行)
        for (let page = 0; page < this.canvas.height / OLED_PAGE_ROWS; page++) {
            // 遍历每列(128列)
            for (let x = 0; x < this.canvas.width; x++) {
                let byte = 0;
                // 组合8个垂直像素为一个字节
                for (let bit = 0; bit < OLED_BITS_PER_BYTE; bit++) {
                    const y = this.byteOrderMode === 'lsb'
                        ? page * OLED_PAGE_ROWS + bit           // LSB
                        : page * OLED_PAGE_ROWS + (OLED_MSB_TOP_BIT - bit);      // MSB
                    const idx = (y * this.canvas.width + x) * OLED_BYTES_PER_PIXEL;
                    // 判断像素颜色(黑色为1)
                    const isBlack =
                        this.imageData.data[idx] === OLED_VALUE_BLACK &&
                        this.imageData.data[idx + 1] === OLED_VALUE_BLACK &&
                        this.imageData.data[idx + 2] === OLED_VALUE_BLACK;
                    // 要求最高位bit7对应页顶部的像素
                    byte |= (isBlack ? 1 : 0) << bit;
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
        // 重置画布为白色
        for (let i = 0; i < this.imageData.data.length; i += OLED_BYTES_PER_PIXEL) {
            fillRgb(this.imageData.data, i, OLED_VALUE_WHITE);
        }
        // 解析缓冲数据
        for (let page = 0; page < this.canvas.height / OLED_PAGE_ROWS; page++) {
            for (let x = 0; x < this.canvas.width; x++) {
                const byte = buffer[page * this.canvas.width + x];
                for (let bit = 0; bit < OLED_BITS_PER_BYTE; bit++) {
                    const y = this.byteOrderMode === 'lsb'
                        ? page * OLED_PAGE_ROWS + bit           // LSB
                        : page * OLED_PAGE_ROWS + (OLED_MSB_TOP_BIT - bit);      // MSB
                    const isBlack = (byte & (1 << bit)) !== 0; // 注意位顺序
                    const index = (y * this.canvas.width + x) * OLED_BYTES_PER_PIXEL;
                    fillRgb(this.imageData.data, index, isBlack ? OLED_VALUE_BLACK : OLED_VALUE_WHITE);
                }
            }
        }
        // 更新画布显示
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    // ======================
    // 鼠标 / 键盘 / 窗口 事件处理
    // ======================

    // 更新画布位置信息(窗口变化时调用)
    private updateCanvasRect(): void {
        this.canvasRect = this.canvas.getBoundingClientRect();
    }

    /**
     * 将鼠标坐标转换为画布像素坐标
     * @param event - 鼠标事件对象
     * @returns 包含x,y的像素坐标对象
     */
    private getPixelPosition(event: MouseEvent): PixelPos {
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

    // 更新指示器位置
    private updateIndicator(pos: PixelPos): void {
        const pixelWidth = this.canvasRect.width / this.canvas.width;
        const pixelHeight = this.canvasRect.height / this.canvas.height;

        // 添加边界检查
        const clampedX = Math.max(0, Math.min(this.canvas.width - 1, pos.x));
        const clampedY = Math.max(0, Math.min(this.canvas.height - 1, pos.y));

        // 精确对齐像素边界
        this.indicator.style.left = `${this.canvasRect.left + clampedX * pixelWidth}px`;
        this.indicator.style.top = `${this.canvasRect.top + clampedY * pixelHeight}px`;

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
            default:
                // 其他工具不处理按下事件
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
                // 鼠标移动过快采样低画直线
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
        // 按下`ESC`终止直线绘制
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
 * 重复挂载时整体替换,不会留下两份同 id 的标记(原先是 index.html 里的静态标记,
 * 不存在这个问题;换成模块生成后必须自己保证只留一份).
 */
export function mountOLED(host: HTMLElement): void {
    const panel = createOledPanel();
    host.replaceChildren(panel.root);
    new OLEDCanvas(panel);
}
