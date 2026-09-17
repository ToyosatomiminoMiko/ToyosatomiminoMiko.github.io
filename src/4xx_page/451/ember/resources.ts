/**
 * GPU 资源: 粒子缓冲(含 CPU 侧种子数据)与两张乒乓历史纹理.
 * 只做创建/重分布/销毁,不碰管线,也不碰主循环.
 */
import { PARTICLE_STRIDE } from './config';

export interface ParticleStore {
    /** 常驻显存的粒子状态 */
    buffer: GPUBuffer;
    /** CPU 侧副本,resize 时按新宽度重新铺开用 */
    seedData: Float32Array;
}

const FLOATS_PER_PARTICLE = PARTICLE_STRIDE / 4;

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
        seedData[o + 0] = Math.random() * cssWidth;          // x 逻辑像素
        seedData[o + 1] = Math.random() * cssHeight;         // y 逻辑像素
        seedData[o + 2] = (Math.random() - 0.5) * 96;        // vx
        seedData[o + 3] = -(42 + Math.random() * 132);       // vy
        seedData[o + 4] = 1.8 + Math.random() * 6;           // size
        seedData[o + 5] = Math.random() * 1.5;               // age
        seedData[o + 6] = 1.6 + Math.random() * 2.2;         // life
        seedData[o + 7] = Math.random() * Math.PI * 2;       // flick
        seedData[o + 8] = i + Math.random();                 // seed
        // [9..11] 颜色由着色器按调色板生成
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

/** 把所有粒子重置到底部重生带(画面尺寸变化后调用,避免粒子留在屏幕外) */
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
        data[o + 0] = Math.random() * cssWidth;
        data[o + 1] = cssHeight + 10 + Math.random() * cssHeight * 0.5;
        data[o + 5] = Math.random() * 0.3;      // age 归零附近, 保持错开
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
