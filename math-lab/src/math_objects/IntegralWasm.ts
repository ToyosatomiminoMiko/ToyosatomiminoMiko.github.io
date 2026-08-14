import type { Range1D } from './types';
import * as math from 'mathjs';
import { logWarning } from '../service/logger';

type Method =
    | 'trapz1d' | 'simpson1d' | 'riemann1d_left' | 'riemann1d_right' | 'riemann1d_mid' | 'lebesgue1d'
    | 'trapz2d' | 'simpson2d' | 'riemann2d_left' | 'lebesgue2d';

type Request = {
    id: number;
    method: Method;
    expr: string;
    coeffs: Record<string, number>;
    a?: number;
    b?: number;
    n?: number;
    layers?: number;
    sampleN?: number;
    xa?: number;
    xb?: number;
    ya?: number;
    yb?: number;
    m?: number;
};

type Response = {
    id: number;
    value?: number;
    error?: string;
    samples?: Float64Array;
    sampleShape?: '1d-grid' | '1d-mid' | '2d-grid' | '2d-corner';
    n?: number;
    m?: number;
};

export type IntegralSampleShape = NonNullable<Response['sampleShape']>;

export type IntegralResult = {
    value: number;
    samples?: Float64Array;
    sampleShape?: IntegralSampleShape;
    n?: number;
    m?: number;
};

// ---------- Worker 管理 ----------
let worker: Worker | null = null;
let workerAlive = false;
let nextId = 1;
const pending = new Map<
    number,
    { resolve: (v: IntegralResult) => void; reject: (e: Error) => void }
>();

function createWorker(): Worker {
    const w = new Worker(
        new URL('./IntegralWorker.ts', import.meta.url),
        { type: 'module' },
    );
    w.onmessage = (e: MessageEvent<Response>) => {
        const { id, value, error, samples, sampleShape, n, m } = e.data;
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (error) {
            p.reject(new Error(error));
        } else {
            p.resolve({ value: value!, samples, sampleShape, n, m });
        }
    };
    w.onerror = (e) => {
        workerAlive = false;
        worker = null;
        pending.forEach(p => p.reject(new Error(e.message || 'Worker 崩溃')));
        pending.clear();
    };
    workerAlive = true;
    return w;
}

function getWorker(): Worker {
    if (!worker || !workerAlive) {
        worker = createWorker();
    }
    return worker;
}

function callWasm(
    method: Method,
    expr: string,
    coeffs: Record<string, number>,
    params: Record<string, number>,
): Promise<IntegralResult> {
    const id = nextId++;
    const w = getWorker();
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ id, method, expr, coeffs, ...params } satisfies Request);
    });
}

// ============================================================
// 纯 mathjs fallback
// ============================================================

function compileFallback(expr: string): math.EvalFunction {
    return math.parse(expr).compile();
}

function fallbackScope(coeffs: Record<string, number>): Record<string, number> {
    return { ...coeffs };
}

function sample1DFallback(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Float64Array {
    const compiled = compileFallback(expr);
    const scope = fallbackScope(coeffs);
    const h = (b - a) / n;
    const values = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) {
        scope.x = a + i * h;
        const y = compiled.evaluate(scope);
        values[i] = typeof y === 'number' && isFinite(y) ? y : NaN;
    }
    return values;
}

function sampleMid1DFallback(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Float64Array {
    const compiled = compileFallback(expr);
    const scope = fallbackScope(coeffs);
    const h = (b - a) / n;
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        scope.x = a + (i + 0.5) * h;
        const y = compiled.evaluate(scope);
        values[i] = typeof y === 'number' && isFinite(y) ? y : NaN;
    }
    return values;
}

function sample2DFallback(
    expr: string,
    coeffs: Record<string, number>,
    xa: number,
    xb: number,
    ya: number,
    yb: number,
    n: number,
    m: number,
): Float64Array {
    const compiled = compileFallback(expr);
    const scope = fallbackScope(coeffs);
    const hx = (xb - xa) / n;
    const hy = (yb - ya) / m;
    const stride = n + 1;
    const values = new Float64Array((n + 1) * (m + 1));
    for (let j = 0; j <= m; j++) {
        scope.y = ya + j * hy;
        for (let i = 0; i <= n; i++) {
            scope.x = xa + i * hx;
            const z = compiled.evaluate(scope);
            values[j * stride + i] = typeof z === 'number' && isFinite(z) ? z : NaN;
        }
    }
    return values;
}

function sample2DCornerFallback(
    expr: string,
    coeffs: Record<string, number>,
    xa: number,
    xb: number,
    ya: number,
    yb: number,
    n: number,
    m: number,
): Float64Array {
    const compiled = compileFallback(expr);
    const scope = fallbackScope(coeffs);
    const hx = (xb - xa) / n;
    const hy = (yb - ya) / m;
    const values = new Float64Array(n * m);
    for (let j = 0; j < m; j++) {
        scope.y = ya + j * hy;
        for (let i = 0; i < n; i++) {
            scope.x = xa + i * hx;
            const z = compiled.evaluate(scope);
            values[j * n + i] = typeof z === 'number' && isFinite(z) ? z : NaN;
        }
    }
    return values;
}

function trapz1dFallback(values: Float64Array, a: number, b: number): number {
    const n = values.length - 1;
    if (n <= 0) return 0;
    const h = (b - a) / n;
    let sum = values[0] + values[n];
    for (let i = 1; i < n; i++) sum += 2 * values[i];
    return (h / 2) * sum;
}

function simpson1dFallback(values: Float64Array, a: number, b: number): number {
    const n = values.length - 1;
    if (n % 2 !== 0) throw new Error('辛普森法要求 N 为偶数');
    const h = (b - a) / n;
    let sum = values[0] + values[n];
    for (let i = 1; i < n; i++) sum += (i % 2 === 0 ? 2 : 4) * values[i];
    return (h / 3) * sum;
}

function riemannLeft1DFallback(values: Float64Array, a: number, b: number): number {
    const n = values.length - 1;
    const h = (b - a) / n;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[i];
    return sum * h;
}

function riemannRight1DFallback(values: Float64Array, a: number, b: number): number {
    const n = values.length - 1;
    const h = (b - a) / n;
    let sum = 0;
    for (let i = 1; i <= n; i++) sum += values[i];
    return sum * h;
}

function riemannMid1DFallback(values: Float64Array, a: number, b: number): number {
    const n = values.length;
    const h = (b - a) / n;
    let sum = 0;
    for (const v of values) sum += v;
    return sum * h;
}

function lebesgue1dFallback(
    values: Float64Array,
    a: number,
    b: number,
    layers: number,
): number {
    const n = values.length - 1;
    const h = (b - a) / n;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const y of values) {
        if (isFinite(y)) {
            yMin = Math.min(yMin, y);
            yMax = Math.max(yMax, y);
        }
    }
    if (!isFinite(yMin) || !isFinite(yMax)) return 0;

    const scanMeasure = (predicate: (y: number) => boolean): number => {
        let measure = 0;
        let inInterval = false;
        for (let i = 0; i < values.length; i++) {
            const y = values[i];
            const meets = isFinite(y) && predicate(y);
            if (meets && !inInterval) inInterval = true;
            else if (!meets && inInterval) {
                measure += h;
                inInterval = false;
            }
        }
        if (inInterval) measure += h;
        return measure;
    };

    let sum = 0;
    if (yMax > 1e-12) {
        const dy = yMax / layers;
        for (let k = 0; k < layers; k++) {
            const threshold = k * dy;
            sum += scanMeasure(y => y > threshold) * dy;
        }
    }
    if (yMin < -1e-12) {
        const dy = -yMin / layers;
        for (let k = 0; k < layers; k++) {
            const threshold = k * dy;
            sum -= scanMeasure(y => y < -threshold) * dy;
        }
    }
    return sum;
}

function trapz2dFallback(
    values: Float64Array,
    xa: number, xb: number,
    ya: number, yb: number,
    n: number, m: number,
): number {
    const hx = (xb - xa) / n;
    const hy = (yb - ya) / m;
    let sum = 0;
    for (let j = 0; j <= m; j++) {
        const wy = (j === 0 || j === m) ? 1 : 2;
        for (let i = 0; i <= n; i++) {
            const wx = (i === 0 || i === n) ? 1 : 2;
            sum += wx * wy * values[j * (n + 1) + i];
        }
    }
    return (hx * hy / 4) * sum;
}

function simpson2dFallback(
    values: Float64Array,
    xa: number, xb: number,
    ya: number, yb: number,
    n: number, m: number,
): number {
    if (n % 2 !== 0 || m % 2 !== 0) throw new Error('辛普森法要求 N, M 均为偶数');
    const weight = (idx: number, total: number): number => {
        if (idx === 0 || idx === total) return 1;
        return idx % 2 === 0 ? 2 : 4;
    };
    const hx = (xb - xa) / n;
    const hy = (yb - ya) / m;
    let sum = 0;
    for (let j = 0; j <= m; j++) {
        for (let i = 0; i <= n; i++) {
            sum += weight(i, n) * weight(j, m) * values[j * (n + 1) + i];
        }
    }
    return (hx * hy / 9) * sum;
}

function riemann2dLeftFallback(
    values: Float64Array,
    xa: number, xb: number,
    ya: number, yb: number,
    n: number, m: number,
): number {
    const hx = (xb - xa) / n;
    const hy = (yb - ya) / m;
    let sum = 0;
    for (const v of values) sum += v;
    return sum * hx * hy;
}

function lebesgue2dFallback(
    values: Float64Array,
    xa: number, xb: number,
    ya: number, yb: number,
    gridSize: number,
    layers: number,
): number {
    const hx = (xb - xa) / gridSize;
    const hy = (yb - ya) / gridSize;
    const area = hx * hy;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const z of values) {
        if (isFinite(z)) {
            zMin = Math.min(zMin, z);
            zMax = Math.max(zMax, z);
        }
    }
    if (!isFinite(zMin) || !isFinite(zMax)) return 0;

    const measure = (predicate: (z: number) => boolean): number => {
        let result = 0;
        for (let j = 0; j < gridSize; j++) {
            for (let i = 0; i < gridSize; i++) {
                const z = values[j * (gridSize + 1) + i];
                if (isFinite(z) && predicate(z)) result += area;
            }
        }
        return result;
    };

    let sum = 0;
    if (zMax > 1e-12) {
        const dy = zMax / layers;
        for (let k = 0; k < layers; k++) {
            const threshold = k * dy;
            sum += measure(z => z > threshold) * dy;
        }
    }
    if (zMin < -1e-12) {
        const dy = -zMin / layers;
        for (let k = 0; k < layers; k++) {
            const threshold = k * dy;
            sum -= measure(z => z < -threshold) * dy;
        }
    }
    return sum;
}

// ---------- 公共 API ----------

export async function trapz1d(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<IntegralResult> {
    try {
        return await callWasm('trapz1d', expr, coeffs, { a, b, n });
    } catch (error) {
        logWarning('积分 fallback', 'trapz1d', error);
        return { value: trapz1dFallback(sample1DFallback(expr, coeffs, a, b, n), a, b) };
    }
}

export async function simpson1d(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<IntegralResult> {
    try {
        return await callWasm('simpson1d', expr, coeffs, { a, b, n });
    } catch (error) {
        logWarning('积分 fallback', 'simpson1d', error);
        return { value: simpson1dFallback(sample1DFallback(expr, coeffs, a, b, n), a, b) };
    }
}

export async function riemann1dLeft(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<IntegralResult> {
    try {
        return await callWasm('riemann1d_left', expr, coeffs, { a, b, n });
    } catch (error) {
        logWarning('积分 fallback', 'riemann1d_left', error);
        return { value: riemannLeft1DFallback(sample1DFallback(expr, coeffs, a, b, n), a, b) };
    }
}

export async function riemann1dRight(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<IntegralResult> {
    try {
        return await callWasm('riemann1d_right', expr, coeffs, { a, b, n });
    } catch (error) {
        logWarning('积分 fallback', 'riemann1d_right', error);
        return { value: riemannRight1DFallback(sample1DFallback(expr, coeffs, a, b, n), a, b) };
    }
}

export async function riemann1dMid(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<IntegralResult> {
    try {
        return await callWasm('riemann1d_mid', expr, coeffs, { a, b, n });
    } catch (error) {
        logWarning('积分 fallback', 'riemann1d_mid', error);
        return { value: riemannMid1DFallback(sampleMid1DFallback(expr, coeffs, a, b, n), a, b) };
    }
}

export async function lebesgue1d(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    layers: number,
    sampleN: number,
): Promise<IntegralResult> {
    try {
        return await callWasm('lebesgue1d', expr, coeffs, { a, b, layers, sampleN });
    } catch (error) {
        logWarning('积分 fallback', 'lebesgue1d', error);
        return {
            value: lebesgue1dFallback(
                sample1DFallback(expr, coeffs, a, b, sampleN),
                a,
                b,
                layers,
            ),
        };
    }
}

export async function trapz2d(
    expr: string,
    coeffs: Record<string, number>,
    xRange: Range1D,
    yRange: Range1D,
    n: number,
    m: number,
): Promise<IntegralResult> {
    try {
        return await callWasm('trapz2d', expr, coeffs, {
            xa: xRange[0],
            xb: xRange[1],
            ya: yRange[0],
            yb: yRange[1],
            n,
            m,
        });
    } catch (error) {
        logWarning('积分 fallback', 'trapz2d', error);
        return {
            value: trapz2dFallback(
                sample2DFallback(expr, coeffs, xRange[0], xRange[1], yRange[0], yRange[1], n, m),
                xRange[0], xRange[1], yRange[0], yRange[1], n, m,
            ),
        };
    }
}

export async function simpson2d(
    expr: string,
    coeffs: Record<string, number>,
    xRange: Range1D,
    yRange: Range1D,
    n: number,
    m: number,
): Promise<IntegralResult> {
    try {
        return await callWasm('simpson2d', expr, coeffs, {
            xa: xRange[0],
            xb: xRange[1],
            ya: yRange[0],
            yb: yRange[1],
            n,
            m,
        });
    } catch (error) {
        logWarning('积分 fallback', 'simpson2d', error);
        return {
            value: simpson2dFallback(
                sample2DFallback(expr, coeffs, xRange[0], xRange[1], yRange[0], yRange[1], n, m),
                xRange[0], xRange[1], yRange[0], yRange[1], n, m,
            ),
        };
    }
}

export async function riemann2dLeft(
    expr: string,
    coeffs: Record<string, number>,
    xRange: Range1D,
    yRange: Range1D,
    n: number,
    m: number,
): Promise<IntegralResult> {
    try {
        return await callWasm('riemann2d_left', expr, coeffs, {
            xa: xRange[0],
            xb: xRange[1],
            ya: yRange[0],
            yb: yRange[1],
            n,
            m,
        });
    } catch (error) {
        logWarning('积分 fallback', 'riemann2d_left', error);
        return {
            value: riemann2dLeftFallback(
                sample2DCornerFallback(expr, coeffs, xRange[0], xRange[1], yRange[0], yRange[1], n, m),
                xRange[0], xRange[1], yRange[0], yRange[1], n, m,
            ),
        };
    }
}

export async function lebesgue2d(
    expr: string,
    coeffs: Record<string, number>,
    xRange: Range1D,
    yRange: Range1D,
    layers: number,
    sampleN: number,
): Promise<IntegralResult> {
    try {
        return await callWasm('lebesgue2d', expr, coeffs, {
            xa: xRange[0],
            xb: xRange[1],
            ya: yRange[0],
            yb: yRange[1],
            layers,
            sampleN,
        });
    } catch (error) {
        logWarning('积分 fallback', 'lebesgue2d', error);
        return {
            value: lebesgue2dFallback(
                sample2DFallback(expr, coeffs, xRange[0], xRange[1], yRange[0], yRange[1], sampleN, sampleN),
                xRange[0], xRange[1], yRange[0], yRange[1], sampleN, layers,
            ),
        };
    }
}
