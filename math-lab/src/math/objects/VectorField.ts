import { parse, type MathNode } from 'mathjs';
import type { Coefficient } from '../../compiler/ir/types';
import { extractCoefficients } from './coefficientUtils';
import { sample_vector_field as wasmSampleVectorField } from '../../wasm/ml_wasm';
import { ensureWasmReady } from '../../runtime/wasmRuntime';
import { logWarning } from '../../service/logger';

let wasmReady = false;
const wasmInit = ensureWasmReady().then(() => {
    wasmReady = true;
}).catch(() => {
    wasmReady = false;
});

void wasmInit;

/**
 * 合并三个分量表达式中提取的系数,去重并生成 Coefficient 对象
 * 默认值为 0,取值范围 [-10, 10],步长 0.1
 */
function mergeCoefficients(
    namesP: string[],
    namesQ: string[],
    namesR: string[]
): Coefficient[] {
    const combined = new Map<string, Coefficient>();
    const allNames = new Set([...namesP, ...namesQ, ...namesR]);

    for (const name of allNames) {
        combined.set(name, {
            name,
            value: 0,
            min: -10,
            max: 10,
            step: 0.1,
        });
    }

    return Array.from(combined.values());
}

/**
 * 解析向量场三个分量表达式字符串
 * 返回编译后的 MathNode 和提取出的系数列表
 */
// 修改 parseVectorField 函数体(约第 56-76 行)
export function parseVectorField(components: [string, string, string]): {
    nodeP: MathNode;
    nodeQ: MathNode;
    nodeR: MathNode;
    coefficients: Coefficient[];
} {
    const [pStr, qStr, rStr] = components;

    const nodeP = parse(pStr);
    const nodeQ = parse(qStr);
    const nodeR = parse(rStr);

    // 使用统一的系数提取(排除 x, y, z)
    const VECTOR_VARS = new Set(['x', 'y', 'z']);
    const namesP = extractCoefficients(nodeP, VECTOR_VARS).map(c => c.name);
    const namesQ = extractCoefficients(nodeQ, VECTOR_VARS).map(c => c.name);
    const namesR = extractCoefficients(nodeR, VECTOR_VARS).map(c => c.name);

    const coefficients = mergeCoefficients(namesP, namesQ, namesR);

    return { nodeP, nodeQ, nodeR, coefficients };
}

/**
 * 在三维网格上采样向量场
 * @param nodes - 包含 P, Q, R 三个 MathNode 的对象
 * @param coefficients - 系数数组(当前值将作为 scope 传入)
 * @param range - 每个轴的范围 [min, max]
 * @param gridSize - 每个轴的采样点数 [nx, ny, nz]
 * @returns Float32Array,长度为 nx*ny*nz*3,存储顺序为 [vx, vy, vz, vx, vy, vz, ...]
 */
export function sampleVectorField(
    nodes: { P: MathNode; Q: MathNode; R: MathNode },
    coefficients: Coefficient[],
    range: { x: [number, number]; y: [number, number]; z: [number, number] },
    gridSize: [number, number, number],
): Float32Array {
    if (wasmReady) {
        try {
            return wasmSampleVectorField(
                nodes.P.toString(),
                nodes.Q.toString(),
                nodes.R.toString(),
                coefficients.map((coefficient) => coefficient.name),
                new Float64Array(coefficients.map((coefficient) => coefficient.value)),
                range.x[0], range.x[1],
                range.y[0], range.y[1],
                range.z[0], range.z[1],
                gridSize[0], gridSize[1], gridSize[2],
            );
        } catch (error) {
            logWarning('VectorField', 'WASM 向量场采样失败,回退到 mathjs:', error);
        }
    }

    return sampleVectorFieldFallback(nodes, coefficients, range, gridSize);
}

function sampleVectorFieldFallback(
    nodes: { P: MathNode; Q: MathNode; R: MathNode },
    coefficients: Coefficient[],
    range: { x: [number, number]; y: [number, number]; z: [number, number] },
    gridSize: [number, number, number],
): Float32Array {
    const [nx, ny, nz] = gridSize;
    const [xMin, xMax] = range.x;
    const [yMin, yMax] = range.y;
    const [zMin, zMax] = range.z;

    if (
        !Number.isInteger(nx) || !Number.isInteger(ny) || !Number.isInteger(nz)
        || nx <= 0 || ny <= 0 || nz <= 0
    ) {
        throw new Error('向量场 grid 必须由正整数组成');
    }
    if (xMin >= xMax || yMin >= yMax || zMin >= zMax) {
        throw new Error('向量场 range 必须满足 min < max');
    }

    // 单点维度不参与步长计算,保持与 WASM 采样一致的行为.
    const stepX = nx > 1 ? (xMax - xMin) / (nx - 1) : 0;
    const stepY = ny > 1 ? (yMax - yMin) / (ny - 1) : 0;
    const stepZ = nz > 1 ? (zMax - zMin) / (nz - 1) : 0;

    const totalPoints = nx * ny * nz;
    const result = new Float32Array(totalPoints * 3);

    // 构建系数 scope(所有系数作为键值对)
    const coeffScope: Record<string, number> = {};
    for (const c of coefficients) {
        coeffScope[c.name] = c.value;
    }

    // 使用 mathjs 的 evaluate 方法,需要传入一个包含所有变量的 scope
    // 为了避免每次新建对象,我们可以重用 scope 并更新 x,y,z
    const scope = { ...coeffScope };

    let idx = 0;
    for (let iz = 0; iz < nz; iz++) {
        const z = zMin + iz * stepZ;
        scope.z = z;
        for (let iy = 0; iy < ny; iy++) {
            const y = yMin + iy * stepY;
            scope.y = y;
            for (let ix = 0; ix < nx; ix++) {
                const x = xMin + ix * stepX;
                scope.x = x;

                // 计算三个分量值
                const vx = nodes.P.evaluate(scope);
                const vy = nodes.Q.evaluate(scope);
                const vz = nodes.R.evaluate(scope);

                result[idx++] = vx;
                result[idx++] = vy;
                result[idx++] = vz;
            }
        }
    }

    return result;
}
