/*
图层贴图上传面板(声明式).

结构与文案来自 ../config.ts 的 UPLOAD_LAYERS 等模型,本模块只做两件事:

  1. 把模型变成元素(与 ui/settings.ts 同风格:纯函数,建出元素并交回引用,
     事件绑定交给调用方);
  2. 把一个 PNG 文件解码成 RGBA8 像素(浏览器侧解码,wasm 侧只收原始像素).

真正的"换图"不由本模块做:调用方(metro_window.ts)拿到像素后调 wasm 的
setLayerImage -- 那些纹理是 wgpu 的 GPU 资源,只有 wasm 内部能改.所以这里
不 import wasm,不碰渲染状态,模块边界与 settings.ts 一致.

一行的结构:

    <div class="upload">
      <div class="upload-meta">
        <label class="upload-label">层名 <small>说明 + 默认文件名</small></label>
        <span class="upload-status">默认素材</span>
      </div>
      <div class="upload-actions">
        <input class="upload-file" type="file" accept="image/png">
        <button class="upload-reset" type="button">恢复默认</button>
      </div>
    </div>
*/

import {
    UPLOAD_ACCEPT,
    UPLOAD_FILE_HINT_PREFIX,
    UPLOAD_INPUT_ID_PREFIX,
    UPLOAD_LAYERS,
    UPLOAD_LEGEND,
    UPLOAD_NOTE,
    UPLOAD_RESET_LABEL,
    UPLOAD_STATUS_DEFAULT,
    UPLOADS_PANEL_ID,
    type UploadLayerSpec,
} from '@/metro_window/src/config';
import { h, type DomChild } from '@/metro_window/src/ui/dom';

/** 一行上传控件:根元素 + 输入框 / 状态行 / 恢复按钮 + 它的声明式配置 */
export interface UploadControl {
    readonly spec: UploadLayerSpec;
    /** 最外层 <div class="upload"> */
    readonly root: HTMLDivElement;
    /** 选文件框 <input type="file"> */
    readonly input: HTMLInputElement;
    /** 该层的状态文案(文件名 / 尺寸 / 报错都写这里) */
    readonly status: HTMLSpanElement;
    /** 恢复默认 <button> */
    readonly reset: HTMLButtonElement;
}

/** 整块上传面板,以及行为代码要绑事件的元素引用 */
export interface UploadPanel {
    readonly root: HTMLFieldSetElement;
    readonly controls: readonly UploadControl[];
}

/** 一行:层名(左) + 状态(右)一行,选文件与恢复默认一行 */
function createUploadRow(spec: UploadLayerSpec): UploadControl {
    const inputId = `${UPLOAD_INPUT_ID_PREFIX}${spec.name}`;

    // 小字里带上"默认素材叫什么":画师按层分开交付,用户要能一眼对上文件.
    const noteParts: string[] = [];
    if (spec.hint !== undefined) noteParts.push(spec.hint);
    noteParts.push(`${UPLOAD_FILE_HINT_PREFIX}${spec.file}`);
    const labelChildren: DomChild[] = [spec.label, h('small', { text: noteParts.join(' · ') })];
    const label = h('label', { class: 'upload-label', attrs: { for: inputId } }, labelChildren);

    const status = h('span', { class: 'upload-status', text: UPLOAD_STATUS_DEFAULT });

    // 选文件框:accept 只是文件选择框的过滤器,真正的类型判断在调用方按 MIME 再做一次.
    const input = h('input', {
        class: 'upload-file',
        attrs: { id: inputId, type: 'file', accept: UPLOAD_ACCEPT },
    });
    // type="button" 明确写出来:这个按钮不该有任何"提交"语义.
    const reset = h('button', {
        class: 'upload-reset',
        attrs: { type: 'button' },
        text: UPLOAD_RESET_LABEL,
    });

    const root = h('div', { class: 'upload' }, [
        h('div', { class: 'upload-meta' }, [label, status]),
        h('div', { class: 'upload-actions' }, [input, reset]),
    ]);
    return { spec, root, input, status, reset };
}

/**
 * 建出整块上传面板:
 *
 *     <fieldset class="uploads" id="uploadPanel">   <- root,初始 disabled
 *       <legend>🖼 图层贴图</legend>
 *       <p class="upload-note">说明</p>
 *       <div class="upload"> ... 每层一行(来自 UPLOAD_LAYERS)...
 *     </fieldset>
 *
 * 与设置面板分开成两块 fieldset / 两个宿主:一个是"调参",一个是"换素材",
 * 合成一块会让"参数"和"文件"混在一起(见 config.ts 的 MOUNT_IDS 注释).
 * 初始 disabled:wasm 与 WebGPU 就绪前不可操作,挂载流程完成后打开.
 */
export function createUploadPanel(): UploadPanel {
    const controls = UPLOAD_LAYERS.map(createUploadRow);
    const root = h(
        'fieldset',
        { class: 'uploads', attrs: { id: UPLOADS_PANEL_ID } },
        [
            h('legend', { text: UPLOAD_LEGEND }),
            h('p', { class: 'upload-note', text: UPLOAD_NOTE }),
            ...controls.map((control) => control.root),
        ],
    );
    root.disabled = true;
    return { root, controls };
}

/** 解码结果:RGBA8 像素与原始尺寸(尺寸要一并发给 wasm,由它算字节数) */
export interface DecodedImage {
    readonly width: number;
    readonly height: number;
    readonly rgba: Uint8Array;
}

/**
 * 把一个图片文件解码成 RGBA8 像素.
 *
 * 为什么在前端解码:浏览器自带 PNG 解码器,而 wasm 侧只有 `png` crate,
 * 再养一套纯属重复;而且这样一来**文件根本不用上传服务器**(没有后端).
 *
 * 通道语义与 Rust 侧对得上:canvas 的 `getImageData` 给的是**未预乘**的 RGBA8,
 * 和 `textures::decode_png` 交给 `create_texture` 的字节完全一致(PNG 有 alpha
 * 就用 alpha,没有就是 255).`createImageBitmap` 会按文件里的方向信息摆正像素,
 * 不需要额外的 flip.
 *
 * 这张中间图只活在本函数里:返回前 bitmap 一定被 close(),canvas 交给 GC.
 * 调用方拿到的是与 ImageData 共用底层缓冲的 Uint8Array(没有多一次拷贝),
 * 但 wasm 侧 `write_texture` 在这行返回前就已把像素拷进暂存区,所以之后
 * 这段缓冲随便回收.
 */
export async function decodeImageToRgba(file: Blob): Promise<DecodedImage> {
    const bitmap: ImageBitmap = await createImageBitmap(file);
    try {
        const { width, height } = bitmap;
        const context = createRgbaContext(width, height);
        context.drawImage(bitmap, 0, 0);
        const image: ImageData = context.getImageData(0, 0, width, height);
        return { width, height, rgba: new Uint8Array(image.data.buffer) };
    } finally {
        bitmap.close();
    }
}

/**
 * 拿一个"能 drawImage + getImageData"的 2D 上下文.
 *
 * 优先 OffscreenCanvas:它不往文档里插元素,也不受页面 CSS 影响(尺寸就是
 * 我们设的像素尺寸);老浏览器没有它时退回一个**不入文档**的 <canvas>.
 * 两条路都在这里显式写宽高:canvas 的默认尺寸是 300x150,不设就会把图缩掉.
 */
function createRgbaContext(
    width: number,
    height: number,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
    if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        if (context) return context;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('无法创建 2D 画布上下文,图片解码失败');
    }
    return context;
}
