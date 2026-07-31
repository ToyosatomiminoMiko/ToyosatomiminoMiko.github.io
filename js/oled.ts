// ================================================================
// OLED 像素画板(封装为 OLEDCanvas 类)
// ================================================================

import type {
    PixelPos,
    DrawTool,
    ByteOrderMode,
    PixelColorMode,
    OLEDConfig,
    ImportResult,
    BresenhamCallback,
    ExportedData,
} from './oled.types';

// ---------- 默认配置 ----------
const DEFAULT_CONFIG: OLEDConfig = {
    canvasId: 'pixelCanvas',
    width: 128,
    height: 64,
    previewColor: '#FF0000',
    previewOpacity: 0.6,
};

export class OLEDCanvas {
    // ---- DOM 引用 ----
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly indicator: HTMLElement | null;
    private readonly coordsDisplay: HTMLElement | null;
    private readonly exportTextarea: HTMLTextAreaElement | null;
    private readonly importTextarea: HTMLTextAreaElement | null;
    private readonly copyBtn: HTMLButtonElement | null;
    private readonly byteOrderBtn: HTMLButtonElement | null;
    private readonly colorBtn: HTMLButtonElement | null;
    private readonly pngBtn: HTMLButtonElement | null;

    // ======================
    // 画布初始化
    // ======================
    // 画笔颜色
    private pixelColorMode: PixelColorMode = 'dark';

    // 'lsb' | 'msb' (低位/高位模式)
    private byteOrderMode: ByteOrderMode = 'lsb';

    // 绘图工具设置
    private currentTool: DrawTool = 'free';

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

    constructor(config: Partial<OLEDConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        // 获取 canvas 并验证
        const canvas = document.getElementById(this.config.canvasId);
        if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
            throw new Error(`[OLEDCanvas] 找不到 canvas 元素: #${this.config.canvasId}`);
        }
        this.canvas = canvas;

        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('[OLEDCanvas] Canvas 2D 上下文不可用');
        this.ctx = ctx;

        // 设置物理像素尺寸(实际分辨率)
        this.canvas.width = this.config.width;   // Embedded 的典型宽度
        this.canvas.height = this.config.height; // Embedded 的典型高度

        // 获取其他 DOM 元素(带容错但不中断)
        const getEl = <T extends HTMLElement>(id: string): T | null =>
            document.getElementById(id) as T | null;

        this.indicator = getEl('pixelIndicator');
        this.coordsDisplay = getEl('coordsDisplay');
        this.exportTextarea = getEl('exportOutput');
        this.importTextarea = getEl('importData');
        this.copyBtn = getEl('output-button');
        this.byteOrderBtn = getEl('byte-order-btn');
        this.colorBtn = getEl('change-color');
        this.pngBtn = getEl('output-png-btn');

        // 初始化白色画布
        this.imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
        // 填充白色背景(RGBA格式)
        for (let i = 0; i < this.imageData.data.length; i += 4) {
            this.imageData.data[i] = 255;     // R
            this.imageData.data[i + 1] = 255; // G
            this.imageData.data[i + 2] = 255; // B
            this.imageData.data[i + 3] = 255; // A(完全不透明)
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
        // --- 按钮事件 ---
        document.getElementById('refill-btn')
            ?.addEventListener('click', () => this.refill());
        if (this.colorBtn) {
            this.colorBtn.addEventListener('click', () => this.toggleColor());
        }
        if (this.pngBtn) {
            this.pngBtn.addEventListener('click', () => this.downloadPNG());
        }
        if (this.byteOrderBtn) {
            this.byteOrderBtn.addEventListener('click', () => this.toggleByteOrder());
        }
        if (this.copyBtn) {
            this.copyBtn.addEventListener('click', () => this.copyExport());
        }
        document.getElementById('export-btn')
            ?.addEventListener('click', () => this.exportData());
        document.getElementById('import-btn')
            ?.addEventListener('click', () => {
                const result = this.importDataFromText();
                alert((result.success ? '✅' : '❌') + result.message);
            });

        // --- 工具 radio(通过 name="tools" 查找) ---
        document.querySelectorAll<HTMLInputElement>('input[name="tools"]').forEach(radio => {
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
        for (let i = 0; i < this.imageData.data.length; i += 4) {
            const val = this.pixelColorMode === 'dark' ? 0 : 255;
            this.imageData.data[i] = val;
            this.imageData.data[i + 1] = val;
            this.imageData.data[i + 2] = val;
        }
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    /** 画笔颜色切换 */
    toggleColor(): void {
        this.pixelColorMode = this.pixelColorMode === 'dark' ? 'light' : 'dark';
        if (this.colorBtn) {
            if (this.pixelColorMode === 'dark') {
                this.colorBtn.textContent = '🔄️暗⬛';
                this.colorBtn.style.color = '#ffffff';
                this.colorBtn.style.backgroundColor = '#000000';
            } else {
                this.colorBtn.textContent = '🔄️亮⬜';
                this.colorBtn.style.color = '#000000';
                this.colorBtn.style.backgroundColor = '#ffffff';
            }
        }
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
        if (this.byteOrderBtn) {
            if (this.byteOrderMode === 'lsb') {
                this.byteOrderBtn.textContent = '⬇低位模式(LSB)';
            } else {
                this.byteOrderBtn.textContent = '⬆高位模式(MSB)';
            }
        }
    }

    /** 数据导出 */
    exportData(): string {
        const data = this.generateEmbeddedData();
        if (this.exportTextarea) {
            this.exportTextarea.value = data.cSource;
        }
        return data.cSource;
    }

    /** 下载PNG */
    downloadPNG(): void {
        const link = document.createElement('a');
        link.download = 'canvas.png';
        link.href = this.canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /** 复制导出数据到剪贴板(带视觉反馈) */
    async copyExport(): Promise<void> {
        const textarea = this.exportTextarea;
        if (!textarea) return;
        try {
            // 使用现代 Clipboard API
            await navigator.clipboard.writeText(textarea.value);
            // 添加视觉反馈
            if (this.copyBtn) {
                this.copyBtn.textContent = '✅已复制!';
                setTimeout(() => {
                    if (this.copyBtn) this.copyBtn.textContent = '复制到剪贴板';
                }, 4000);
            }
        } catch (err) {
            console.error('❌复制失败:', err);
            alert('❌复制失败,请手动选择文本后按 Ctrl+C');
        }
    }

    /** 数据导入 */
    importDataFromText(): ImportResult {
        const input = this.importTextarea?.value ?? '';
        try {
            // 提取十六进制数据
            const hexValues = input.match(/0x[0-9a-fA-F]{2}/g);
            if (!hexValues || hexValues.length !== 1024) {
                throw new Error('❌数据格式错误,需要包含1024个十六进制值');
            }
            // 转换到Uint8Array
            const buffer = new Uint8Array(hexValues.map(v => parseInt(v, 16)));
            // 更新画布数据
            this.updateCanvasFromBuffer(buffer);
            return { success: true, message: '✅数据格式正确,已导入!' };
        } catch (e) {
            const err = e as Error;
            return { success: false, message: `❌导入失败:${err.message}` };
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
        const index = (y * this.canvas.width + x) * 4;
        const val = this.pixelColorMode === 'dark' ? 0 : 255;
        this.imageData.data[index] = val;       // R
        this.imageData.data[index + 1] = val;   // G
        this.imageData.data[index + 2] = val;   // B
        // 注意:保留Alpha通道不变
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
        tempCtx.globalCompositeOperation = 'source-over';
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
        tempCtx.lineWidth = 1;

        const x = Math.min(this.startPos.x, endX) + 0.5;
        const y = Math.min(this.startPos.y, endY) + 0.5;
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
    private generateEmbeddedData(): ExportedData {
        const buffer = new Uint8Array(this.canvas.width * (this.canvas.height / 8)); // 128列 x 8页
        // 遍历每个页(8页,每页8行)
        for (let page = 0; page < this.canvas.height / 8; page++) {
            // 遍历每列(128列)
            for (let x = 0; x < this.canvas.width; x++) {
                let byte = 0;
                // 组合8个垂直像素为一个字节
                for (let bit = 0; bit < 8; bit++) {
                    const y = this.byteOrderMode === 'lsb'
                        ? page * 8 + bit           // LSB
                        : page * 8 + (7 - bit);      // MSB
                    const idx = (y * this.canvas.width + x) * 4;
                    // 判断像素颜色(黑色为1)
                    const isBlack =
                        this.imageData.data[idx] === 0 &&
                        this.imageData.data[idx + 1] === 0 &&
                        this.imageData.data[idx + 2] === 0;
                    // 要求最高位bit7对应页顶部的像素
                    byte |= (isBlack ? 1 : 0) << bit;
                }
                buffer[page * this.canvas.width + x] = byte;
            }
        }

        // 格式化为 C 源码
        let cSource = 'const uint8_t bitmap[1024] = {\n    ';
        buffer.forEach((byte, i) => {
            cSource += `0x${byte.toString(16).padStart(2, '0')}`;
            cSource += i !== buffer.length - 1 ? ', ' : '';
            if ((i + 1) % 16 === 0) cSource += '\n    ';
        });
        cSource += '\n};';

        return { buffer, cSource };
    }

    // ======================
    // 缓冲数据转画布图像
    // ======================
    private updateCanvasFromBuffer(buffer: Uint8Array): void {
        // 重置画布为白色
        for (let i = 0; i < this.imageData.data.length; i += 4) {
            this.imageData.data[i] = 255;
            this.imageData.data[i + 1] = 255;
            this.imageData.data[i + 2] = 255;
        }
        // 解析缓冲数据
        for (let page = 0; page < this.canvas.height / 8; page++) {
            for (let x = 0; x < this.canvas.width; x++) {
                const byte = buffer[page * this.canvas.width + x];
                for (let bit = 0; bit < 8; bit++) {
                    const y = this.byteOrderMode === 'lsb'
                        ? page * 8 + bit           // LSB
                        : page * 8 + (7 - bit);      // MSB
                    const isBlack = (byte & (1 << bit)) !== 0; // 注意位顺序
                    const index = (y * this.canvas.width + x) * 4;
                    this.imageData.data[index] = isBlack ? 0 : 255;
                    this.imageData.data[index + 1] = isBlack ? 0 : 255;
                    this.imageData.data[index + 2] = isBlack ? 0 : 255;
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
        if (!this.indicator) return;
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
        this.indicator.style.display = 'block';
        if (this.coordsDisplay) {
            this.coordsDisplay.style.display = 'block';
        }
    }

    // ======================
    // coordsDisplay
    // ======================
    /**
     * 更新坐标显示 实时显示鼠标坐标
     * @param pos - 包含x,y的坐标对象
     */
    private updateCoordsDisplay(pos: PixelPos): void {
        if (this.coordsDisplay) {
            this.coordsDisplay.textContent = `coordinate:(X:${pos.x},Y:${pos.y})`;
        }
    }

    // ---- 事件回调(箭头函数保持 this 指向) ----

    private onMouseEnter = (): void => {
        this.updateCanvasRect();
    };

    private onMouseLeave = (): void => {
        // 隐藏画笔
        if (this.indicator) {
            this.indicator.style.display = 'none';
        }
        // 重置坐标指示
        if (this.coordsDisplay) {
            this.coordsDisplay.textContent = 'coordinate:(X:-,Y:-)';
        }
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
        else if (this.currentTool === 'free' && (e.buttons & 3)) {
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
        this.resizeTimer = setTimeout(() => this.updateCanvasRect(), 100);
    };
}