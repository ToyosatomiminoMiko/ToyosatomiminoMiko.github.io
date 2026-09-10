import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { WebGLGeometries } from 'three/src/renderers/webgl/WebGLGeometries.js';

/**
 * 曲面采样走真实 Worker/WASM,这里只关心"结果回到主线程后 BufferGeometry
 * 是否让线框失效"这一段,因此把共享 client 换成假实现.
 */
vi.mock('../../math/compute/workers/SurfaceComputeClient', () => ({
    surfaceComputeClient: {
        request: vi.fn(),
        dispose: vi.fn(),
    },
}));

import { surfaceComputeClient } from '../../math/compute/workers/SurfaceComputeClient';
import { SurfaceMesh } from './SurfaceMesh';
import type { SurfaceWorkerResponse } from '../../math/compute/workers/SurfaceWorker';

const COLS = 2;
const ROWS = 2;
const TRIANGLES = 8;
/** 每次 update 用的采样范围(值本身不影响本测试) */
const RANGE: [number, number, number, number] = [-1, 1, -1, 1];

function makeResponse(triangleCount = TRIANGLES): SurfaceWorkerResponse {
    const vertexCount = (COLS + 1) * (ROWS + 1);
    const positions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
        positions[i * 3] = i;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = i * 0.5;
    }
    const normals = new Float32Array(vertexCount * 3);
    // 2x2 网格 -> 最多 4 个单元 -> 8 个三角形
    const all = [
        0, 1, 4, 0, 4, 3,
        1, 2, 5, 1, 5, 4,
        3, 4, 7, 3, 7, 6,
        4, 5, 8, 4, 8, 7,
    ];
    return {
        id: 1,
        positions,
        normals,
        validIndices: new Uint32Array(all.slice(0, triangleCount * 3)),
        zMin: 0,
        zMax: 4,
        computeMs: 0,
    };
}

/**
 * 真实的 three.js 线框索引缓存.`getWireframeAttribute` 这条路径不触碰 GL,
 * 所以传最小桩即可复现渲染器每帧的取值行为.
 *
 * three.js 只在 `缓存 version < geometry.index.version` 时重建线框索引
 * (WebGLGeometries.getWireframeAttribute),这正是本文件要守住的不变量.
 */
function createWireframeCache() {
    const gl = {} as unknown as WebGLRenderingContext;
    const attributes = new WebGLAttributes(gl);
    // @types/three 的构造签名是 3 参(运行时另有第 4 参 bindingStates,本测试用不到)
    return new WebGLGeometries(gl, attributes, { memory: { geometries: 0 } } as never);
}

function createMesh() {
    // 首帧:采样结果还没回来,几何体用的是构造器里的空占位索引;
    // three.js 会在这一帧为 wireframe 材质缓存一份空的线框索引.
    const mesh = new SurfaceMesh(COLS, ROWS, '测试曲面', '#ffffff');
    const wireframeCache = createWireframeCache();
    expect(mesh.geometry.index?.count).toBe(0);
    expect(wireframeCache.getWireframeAttribute(mesh.geometry).count).toBe(0);
    return { mesh, wireframeCache };
}

async function runOnce(mesh: SurfaceMesh, expectedIndexCount: number): Promise<void> {
    mesh.update('x+y', [], RANGE[0], RANGE[1], RANGE[2], RANGE[3]);
    await vi.waitFor(() => {
        expect(mesh.geometry.index?.count).toBe(expectedIndexCount);
    });
}

describe('SurfaceMesh 线框网格', () => {
    beforeEach(() => {
        vi.mocked(surfaceComputeClient.request).mockReset();
    });

    it('首次采样结果到达后线框缓存即失效,无需再运行一次', async () => {
        const response = makeResponse();
        vi.mocked(surfaceComputeClient.request).mockResolvedValue(response);

        const { mesh, wireframeCache } = createMesh();

        await runOnce(mesh, response.validIndices.length);

        // 关键断言:首帧那份空线框缓存必须被判为过期并重建,
        // 否则线框会一直绑在空索引上,表现为"首次运行看不到网格,
        // 必须再点一次运行才有网格".
        expect(mesh.geometry.index?.version).toBeGreaterThan(0);
        expect(wireframeCache.getWireframeAttribute(mesh.geometry).count)
            .toBe(response.validIndices.length * 2);

        mesh.dispose();
    });

    it('后续更新中索引长度变化时,线框缓存同样会失效', async () => {
        // 第二次结果的有效单元变少(曲面出现 NaN/渐近线断开),
        // 索引长度变化 -> 必须换新的 BufferAttribute.
        const full = makeResponse();
        const partial = makeResponse(2);
        vi.mocked(surfaceComputeClient.request)
            .mockResolvedValueOnce(full)
            .mockResolvedValueOnce(partial);

        const { mesh, wireframeCache } = createMesh();

        await runOnce(mesh, full.validIndices.length);
        expect(wireframeCache.getWireframeAttribute(mesh.geometry).count)
            .toBe(full.validIndices.length * 2);

        await runOnce(mesh, partial.validIndices.length);
        expect(wireframeCache.getWireframeAttribute(mesh.geometry).count)
            .toBe(partial.validIndices.length * 2);

        mesh.dispose();
    });
});
