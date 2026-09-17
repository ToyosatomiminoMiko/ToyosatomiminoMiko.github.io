/**
 * GPU 资源: 粒子缓冲(含 CPU 侧种子数据)与两张乒乓历史纹理.
 * 只做创建/重分布/销毁,不碰管线,也不碰主循环.
 */
import { PARTICLE_FIELD, PARTICLE_STRIDE, SEED_LIFE_MAX, SEED_LIFE_MIN } from './config';

export interface ParticleStore {
    /** 常驻显存的粒子状态 */
    buffer: GPUBuffer;
    /** CPU 侧副本,resize 时按新宽度重新铺开用 */
    seedData: Float32Array;
}

const F = PARTICLE_FIELD;
const FLOATS_PER_PARTICLE = PARTICLE_STRIDE / 4;

/**
 * 首帧用的近似暖色.
 * 着色器重生时会用 emberPalette() 覆盖, 这里只是别让刚打开的页面空一片黑.
 * 刻意不在 TS 里复刻整套调色板 -- 两份调色板迟早会不一致.
 */
const SEED_COLOR_WARM: readonly [number, number, number] = [1.0, 0.494, 0.227]; // #ff7e3a
const SEED_COLOR_DEEP: readonly [number, number, number] = [0.753, 0.255, 0.063]; // #c04110

/** 初始铺满整屏,并给每颗粒子一个稳定种子(之后重生全部在 GPU 上计算) */
export function createParticleStore(
    device: GPUDevice,
    particleCount: number,
    cssWidth: number,
    cssHeight: number
): ParticleStore {
    const seedData = new Float32Array(particleCount * FLOATS_PER_PARTICLE);
    for (let i = 0; i < particleCount; i++) {
        const o = i * FLOATS_PER_PARTICLE;
        const rise = 46 + Math.random() * 50;                // 与 RISE_MIN/MAX 同量级
        const warm = Math.random();

        seedData[o + F.posX] = Math.random() * cssWidth;
        seedData[o + F.posY] = Math.random() * cssHeight;
        seedData[o + F.velX] = (Math.random() - 0.5) * 96;
        seedData[o + F.velY] = -rise * (1.5 + Math.random() * 0.9);
        seedData[o + F.size] = 1.5 + Math.random() * 6;
        seedData[o + F.age] = Math.random() * 4;
        seedData[o + F.life] = SEED_LIFE_MIN + Math.random() * (SEED_LIFE_MAX - SEED_LIFE_MIN);
        seedData[o + F.flick] = Math.random() * Math.PI * 2;
        seedData[o + F.seed] = i + Math.random();
        // [9..11] 是 vec3 的对齐填充, 必须留空
        seedData[o + F.colorR] = SEED_COLOR_WARM[0] + (SEED_COLOR_DEEP[0] - SEED_COLOR_WARM[0]) * warm;
        seedData[o + F.colorG] = SEED_COLOR_WARM[1] + (SEED_COLOR_DEEP[1] - SEED_COLOR_WARM[1]) * warm;
        seedData[o + F.colorB] = SEED_COLOR_WARM[2] + (SEED_COLOR_DEEP[2] - SEED_COLOR_WARM[2]) * warm;
        seedData[o + F.rise] = rise;
    }

    const buffer = device.createBuffer({
        label: '451-particles',
        // COPY_SRC 仅为调试期把粒子状态读回 CPU 用, 不影响性能
        size: seedData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(buffer, 0, seedData);

    return { buffer, seedData };
}

/**
 * 把粒子挪到画面下方的重生带(窗口尺寸变化后调用).
 * 位置在屏幕外 + age 归零, 于是下一帧 compute 就会判定越界并走一遍 respawn(),
 * 位置/颜色/寿命随之全部由着色器重新给出.
 */
export function reseedParticleStore(
    device: GPUDevice,
    store: ParticleStore,
    particleCount: number,
    cssWidth: number,
    cssHeight: number
): void {
    const data = store.seedData;
    for (let i = 0; i < particleCount; i++) {
        const o = i * FLOATS_PER_PARTICLE;
        data[o + F.posX] = Math.random() * cssWidth;
        data[o + F.posY] = cssHeight + 10 + Math.random() * 80;
        data[o + F.age] = Math.random() * 0.3;      // 错开一点, 避免同时熄灭
    }
    device.queue.writeBuffer(store.buffer, 0, data);
}

/** 两张离屏纹理乒乓轮换,避免"同一次 pass 里采样自己" */
export function createHistoryTextures(
    device: GPUDevice,
    physWidth: number,
    physHeight: number,
    format: GPUTextureFormat
): GPUTexture[] {
    // COPY_SRC 只用于把离屏图像读回调试(不影响正常渲染路径)
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;

    const textures = [0, 1].map((i) =>
        device.createTexture({
            label: `451-history-${i}`,
            size: { width: physWidth, height: physHeight },
            format,
            usage,
        })
    );

    // 前一帧内容未定义, 先清空一次避免首帧采样到垃圾数据
    for (const texture of textures) {
        const encoder = device.createCommandEncoder();
        encoder
            .beginRenderPass({
                colorAttachments: [
                    {
                        view: texture.createView(),
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        loadOp: 'clear',
                        storeOp: 'store',
                    },
                ],
            })
            .end();
        device.queue.submit([encoder.finish()]);
    }

    return textures;
}
