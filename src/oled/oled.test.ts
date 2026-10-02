/**
 * OLED 行为层(oled/oled.ts 的 OLEDCanvas)里**几何与落笔**那部分契约(进程内,
 * 跑在 happy-dom 里).
 *
 * 为什么要把画布几何桩出来:happy-dom 不做布局,`getBoundingClientRect()` 恒为 0,
 * 而这层要验的恰恰是"屏幕坐标 -> 画布像素"的换算.所以这里把画布的**内容盒**
 * (left/top/clientWidth/clientHeight)钉成已知值,再派发真的鼠标事件,断言两件事:
 *
 *   1. 红框(div#pixelIndicator)左上角落在"指针那颗像素"的格子左上角上,尺寸正好
 *      一颗像素 -- 口径必须是**内容盒**(边框盒含 1px 描边,按它算会一路偏到右下角);
 *   2. 自由绘制落笔落在**同一颗像素**上(换算与红框同源,所以两者必须一致).
 *
 * 真引擎里的像素级验证(真 CSS 级联 + 真布局 + 滚轮 + transition 归零)在
 * scripts/smoke_home.mjs,不在这一层重复.
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { OLEDCanvas } from '@/oled/oled';
import { OLED_COLOR_LIT, OLED_DISPLAY_HIDDEN, OLED_DISPLAY_VISIBLE } from '@/oled/config';
import { createOledPanel, type OledPanel } from '@/oled/ui/oled_panel';
import { renderPanel } from '@/test_support/panel_test_helpers';

/** 画布内容盒在视口里的位置与尺寸(测试桩用的几何) */
interface CanvasBox {
    /** 内容盒左上角 X(边框盒 left + 左边框宽) */
    left: number;
    /** 内容盒左上角 Y */
    top: number;
    /** 内容盒宽(CSS px) */
    width: number;
    /** 内容盒高(CSS px) */
    height: number;
}

/**
 * happy-dom 没有真 canvas(`getContext('2d')` 返回空),而本层要验"落笔落在哪颗
 * 像素上"就非得有一块能读写像素的画布.这里给一块**够用的**实现:ImageData 是一块
 * 真的 Uint8ClampedArray,putImageData / getImageData 直接按 RGBA 搬字节,
 * fillRect / drawImage 用写像素模拟(本层只用到这几个调用).不追求与浏览器逐位一致
 * -- 真正的像素操作归真引擎,scripts/smoke_home.mjs 里另有一层.
 */
interface StubImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

/** 造一块"够用"的 2D 上下文(见 StubImageData 的说明) */
function createStubContext(): Record<string, unknown> {
    const image: StubImageData = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    /** 把 source 的一整块字节搬到 destination 的 (dx, dy) 上(越界处丢弃) */
    const blit = (
        source: Uint8ClampedArray, sw: number, sh: number,
        destination: Uint8ClampedArray, dw: number, dh: number,
        dx: number, dy: number,
    ): void => {
        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const targetX = dx + x;
                const targetY = dy + y;
                if (targetX < 0 || targetY < 0 || targetX >= dw || targetY >= dh) continue;
                for (let channel = 0; channel < 4; channel++) {
                    destination[(targetY * dw + targetX) * 4 + channel] =
                        source[(y * sw + x) * 4 + channel];
                }
            }
        }
    };
    const createImageData = (width: number, height: number): StubImageData =>
        ({ data: new Uint8ClampedArray(width * height * 4), width, height });
    const context: Record<string, unknown> = {
        fillStyle: '#000000',
        strokeStyle: '#000000',
        globalAlpha: 1,
        lineWidth: 1,
        imageSmoothingEnabled: false,
        createImageData,
        putImageData: (source: StubImageData, dx: number, dy: number): void => {
            blit(source.data, source.width, source.height, image.data, image.width, image.height, dx, dy);
        },
        getImageData: (x: number, y: number, w: number, h: number): StubImageData => {
            const out = createImageData(w, h);
            blit(image.data, image.width, image.height, out.data, w, h, -x, -y);
            return out;
        },
        fillRect: (x: number, y: number, w: number, h: number): void => {
            const fill = context.fillStyle as string;
            for (let py = y; py < y + h; py++) {
                for (let px = x; px < x + w; px++) {
                    if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
                    const base = (py * image.width + px) * 4;
                    // 预览只用到 #rrggbb
                    image.data[base] = parseInt(fill.slice(1, 3), 16);
                    image.data[base + 1] = parseInt(fill.slice(3, 5), 16);
                    image.data[base + 2] = parseInt(fill.slice(5, 7), 16);
                    image.data[base + 3] = 255;
                }
            }
        },
        // 矩形预览的描边:本层不断言预览像素,留空实现
        strokeRect: (): void => { /* 见上 */ },
        clearRect: (): void => {
            for (let i = 0; i < image.data.length; i++) image.data[i] = 0;
        },
        drawImage: (source: HTMLCanvasElement): void => {
            const sourceImage = (source.getContext('2d') as unknown as
                { __image?: StubImageData }).__image;
            if (sourceImage) {
                blit(sourceImage.data, sourceImage.width, sourceImage.height,
                    image.data, image.width, image.height, 0, 0);
            }
        },
        /** 画布被写 width/height 时(由下面 property setter 转发)按新尺寸重铺像素 */
        __resize: (width: number, height: number): void => {
            image.data = new Uint8ClampedArray(width * height * 4);
            image.width = width;
            image.height = height;
        },
        __image: image,
    };
    return context;
}

/**
 * 把面板挂进文档并把画布几何钉成给定值.
 *
 * clientLeft / clientTop 固定为 1,因为 public/css/index.css 给画布画了 1px 描边 --
 * 内容盒口径的换算就是靠这两个值把描边扣掉,桩里必须带上,否则测不到那条换算.
 */
function mountWithBox(box: CanvasBox): OledPanel {
    const panel = renderPanel(createOledPanel);
    const context = createStubContext() as unknown as {
        __image: StubImageData;
        __resize: (width: number, height: number) => void;
    };
    // 画布一被写 width/height(OLEDCanvas 构造函数第一件事)就按新尺寸重铺像素
    Object.defineProperty(panel.canvas, 'width', {
        configurable: true,
        get: () => context.__image.width,
        set: (value: number) => context.__resize(value, context.__image.height),
    });
    Object.defineProperty(panel.canvas, 'height', {
        configurable: true,
        get: () => context.__image.height,
        set: (value: number) => context.__resize(context.__image.width, value),
    });
    panel.canvas.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];

    Object.defineProperty(panel.canvas, 'clientLeft', { value: 1, configurable: true });
    Object.defineProperty(panel.canvas, 'clientTop', { value: 1, configurable: true });
    Object.defineProperty(panel.canvas, 'clientWidth', { value: box.width, configurable: true });
    Object.defineProperty(panel.canvas, 'clientHeight', { value: box.height, configurable: true });
    moveCanvasTo(panel, box);

    new OLEDCanvas(panel);
    return panel;
}

/** 只改画布几何(模拟滚动 / 卡片重新排布把画布挪走),不重新挂载 */
function moveCanvasTo(panel: OledPanel, box: CanvasBox): void {
    panel.canvas.getBoundingClientRect = () => ({
        left: box.left, top: box.top,
        width: box.width + 2, height: box.height + 2,
        right: box.left + box.width + 2, bottom: box.top + box.height + 2,
        x: box.left, y: box.top, toJSON: () => ({}),
    }) as DOMRect;
}

/** 指针事件:clientX/clientY 是视口坐标,buttons 用位掩码(1 = 左键按下) */
function mouse(panel: OledPanel, type: string, clientX: number, clientY: number, buttons = 0): void {
    panel.canvas.dispatchEvent(
        new MouseEvent(type, { bubbles: true, clientX, clientY, buttons }),
    );
}

/** 指针压在第 (x, y) 颗像素**中心**时的视口坐标 */
function centerOf(box: CanvasBox, x: number, y: number): { clientX: number; clientY: number } {
    return {
        clientX: box.left + 1 + (x + 0.5) * (box.width / 128),
        clientY: box.top + 1 + (y + 0.5) * (box.height / 64),
    };
}

/** 读画布上某个像素的颜色(R/G/B) */
function pixelAt(panel: OledPanel, x: number, y: number): number[] {
    const data = panel.canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
    return [data[0], data[1], data[2]];
}

/** 画布 1024×512(128×64 像素,每颗 8×8),内容盒左上角 (80, 122) */
const BOX: CanvasBox = { left: 80, top: 122, width: 1024, height: 512 };

describe('OLED:红框光标与画布像素格对齐', () => {
    it('红框落在指针那颗像素的格子上,尺寸正好一颗像素(内容盒口径)', () => {
        const panel = mountWithBox(BOX);
        // 第 3 列第 5 行那颗像素的中心:内容盒原点 (81, 123) + 中心
        const { clientX, clientY } = centerOf(BOX, 3, 5);
        mouse(panel, 'mousemove', clientX, clientY);

        expect(panel.indicator.style.left).toBe(`${81 + 3 * 8}px`);
        expect(panel.indicator.style.top).toBe(`${123 + 5 * 8}px`);
        expect(panel.indicator.style.width).toBe('8px');
        expect(panel.indicator.style.height).toBe('8px');
        expect(panel.indicator.style.display).toBe(OLED_DISPLAY_VISIBLE);
        expect(panel.coordsDisplay.textContent).toBe('coordinate:(X:3,Y:5)');
    });

    it('画布右下角那颗像素也不偏(边框盒口径会在这一头差出 3px 以上)', () => {
        const panel = mountWithBox(BOX);
        const { clientX, clientY } = centerOf(BOX, 127, 63);
        mouse(panel, 'mousemove', clientX, clientY);

        // 内容盒口径:81 + 127×8 = 1097,123 + 63×8 = 627
        // 边框盒口径(改回 rect.left + x × rect.width/128)会得到 1095.5 / 625.5
        expect(panel.indicator.style.left).toBe('1097px');
        expect(panel.indicator.style.top).toBe('627px');
        expect(panel.coordsDisplay.textContent).toBe('coordinate:(X:127,Y:63)');
    });

    it('每像素不是整数(窄屏)时,尺寸用原样的每像素宽,不四舍五入', () => {
        // 640 / 128 = 5,400 / 64 = 6.25:末列仍要正好压在 127 颗像素之外
        const box: CanvasBox = { left: 10, top: 20, width: 640, height: 400 };
        const panel = mountWithBox(box);
        const { clientX, clientY } = centerOf(box, 127, 63);
        mouse(panel, 'mousemove', clientX, clientY);

        expect(panel.indicator.style.left).toBe(`${11 + 127 * 5}px`);
        expect(panel.indicator.style.top).toBe(`${21 + 63 * 6.25}px`);
        expect(panel.indicator.style.width).toBe('5px');
        expect(panel.indicator.style.height).toBe('6.25px');
    });

    it('画布还没上屏(内容盒尺寸为 0)时不摆红框,也不写 Inf/NaN', () => {
        const panel = mountWithBox({ left: 0, top: 0, width: 0, height: 0 });
        mouse(panel, 'mousemove', 40, 40);

        expect(panel.indicator.style.display).toBe(OLED_DISPLAY_HIDDEN);
        expect(panel.indicator.style.left).toBe('');
    });
});

describe('OLED:自由绘制落笔', () => {
    it('落笔落在指针那颗像素上,颜色是画笔色', () => {
        const panel = mountWithBox(BOX);
        const { clientX, clientY } = centerOf(BOX, 3, 5);
        mouse(panel, 'mousedown', clientX, clientY, 1);

        expect(pixelAt(panel, 3, 5)).toEqual([OLED_COLOR_LIT.r, OLED_COLOR_LIT.g, OLED_COLOR_LIT.b]);
        // 邻格没被误写
        expect(pixelAt(panel, 4, 5)).not.toEqual([OLED_COLOR_LIT.r, OLED_COLOR_LIT.g, OLED_COLOR_LIT.b]);
    });

    it('拖动时把两次采样之间的像素补齐(Bresenham 补线)', () => {
        const panel = mountWithBox(BOX);
        const from = centerOf(BOX, 0, 0);
        mouse(panel, 'mousedown', from.clientX, from.clientY, 1);

        const to = centerOf(BOX, 4, 4);
        mouse(panel, 'mousemove', to.clientX, to.clientY, 1);

        // 对角线上四颗像素都要亮
        for (const i of [1, 2, 3, 4]) {
            expect(pixelAt(panel, i, i), `(${i},${i})`).toEqual([OLED_COLOR_LIT.r, OLED_COLOR_LIT.g, OLED_COLOR_LIT.b]);
        }
    });

    it('指针离开画布后再回来,不会补一条横贯画面的直线', () => {
        const panel = mountWithBox(BOX);
        const start = centerOf(BOX, 0, 1);
        mouse(panel, 'mousedown', start.clientX, start.clientY, 1);
        const drag = centerOf(BOX, 6, 5);
        mouse(panel, 'mousemove', drag.clientX, drag.clientY, 1);
        // 指针挪出画布(左键仍按着),再从右下角回来
        mouse(panel, 'mouseleave', 0, 0, 1);
        // 离开的当下:红框隐藏,坐标条归位,接续点(6,5)被丢掉
        expect(panel.coordsDisplay.textContent).toBe('coordinate:(X:-,Y:-)');
        expect(panel.indicator.style.display).toBe(OLED_DISPLAY_HIDDEN);

        const back = centerOf(BOX, 9, 9);
        mouse(panel, 'mousemove', back.clientX, back.clientY, 1);

        // 回来的那一颗照画;中间的连线(7,7)不该有
        expect(pixelAt(panel, 9, 9)).toEqual([OLED_COLOR_LIT.r, OLED_COLOR_LIT.g, OLED_COLOR_LIT.b]);
        expect(pixelAt(panel, 7, 7)).not.toEqual([OLED_COLOR_LIT.r, OLED_COLOR_LIT.g, OLED_COLOR_LIT.b]);
    });

    it('指针离开画布后红框藏起来', () => {
        const panel = mountWithBox(BOX);
        const { clientX, clientY } = centerOf(BOX, 2, 2);
        mouse(panel, 'mousemove', clientX, clientY);
        expect(panel.indicator.style.display).toBe(OLED_DISPLAY_VISIBLE);

        mouse(panel, 'mouseleave', 0, 0);
        expect(panel.indicator.style.display).toBe(OLED_DISPLAY_HIDDEN);
        expect(panel.coordsDisplay.textContent).toBe('coordinate:(X:-,Y:-)');
    });
});

describe('OLED:画布位置变化后红框跟得上', () => {
    it('滚动:指针没动,红框跟着画布落到同一颗像素(而不是留在旧坐标)', () => {
        const panel = mountWithBox(BOX);
        const { clientX, clientY } = centerOf(BOX, 40, 20);
        mouse(panel, 'mousemove', clientX, clientY);
        expect(panel.indicator.style.left).toBe(`${81 + 40 * 8}px`);
        expect(panel.indicator.style.top).toBe(`${123 + 20 * 8}px`);

        // 页面往上滚 60px:画布在视口里跟着上移(不派发 mousemove)
        const scrolled: CanvasBox = { ...BOX, top: BOX.top - 60 };
        moveCanvasTo(panel, scrolled);
        window.dispatchEvent(new Event('scroll'));

        expect(panel.indicator.style.left).toBe(`${81 + 40 * 8}px`);
        expect(panel.indicator.style.top).toBe(`${63 + 20 * 8}px`);
    });

    it('卡片重新排布(画布在两次 mousemove 之间挪了位)时,下一次移动按新位置换算', () => {
        const panel = mountWithBox(BOX);
        const first = centerOf(BOX, 10, 10);
        mouse(panel, 'mousemove', first.clientX, first.clientY);
        expect(panel.coordsDisplay.textContent).toBe('coordinate:(X:10,Y:10)');

        // 编辑器被拖高 / 展开,画布被顶下去 100px(没有 scroll / resize 事件)
        const moved: CanvasBox = { ...BOX, top: BOX.top + 100 };
        moveCanvasTo(panel, moved);
        // 用**新**位置算出来的同一颗像素中心再移动一次
        const again = centerOf(moved, 10, 10);
        mouse(panel, 'mousemove', again.clientX, again.clientY);

        expect(panel.coordsDisplay.textContent).toBe('coordinate:(X:10,Y:10)');
        expect(panel.indicator.style.top).toBe(`${123 + 100 + 10 * 8}px`);
    });

    it('指针不在画布上时,滚动不会把红框又摆出来', () => {
        const panel = mountWithBox(BOX);
        const { clientX, clientY } = centerOf(BOX, 4, 4);
        mouse(panel, 'mousemove', clientX, clientY);
        mouse(panel, 'mouseleave', 0, 0);

        moveCanvasTo(panel, { ...BOX, top: BOX.top - 80 });
        window.dispatchEvent(new Event('scroll'));

        expect(panel.indicator.style.display).toBe(OLED_DISPLAY_HIDDEN);
        expect(panel.indicator.style.left).toBe(`${81 + 4 * 8}px`);
    });
});
