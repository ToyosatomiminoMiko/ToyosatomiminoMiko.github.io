import type { Integral1DFn, Integral2DFn, Range1D } from './types';

// ================================================================
// 二维数值积分
// ================================================================

/** 二维复合梯形法 */
export function trapz2d(
    f: Integral2DFn,
    xRange: Range1D,
    yRange: Range1D,
    N: number,
    M: number,
): number {
    const [a, b] = xRange;
    const [c, d] = yRange;
    const hx = (b - a) / N;
    const hy = (d - c) / M;

    let sum = 0;
    for (let j = 0; j <= M; j++) {
        const y = c + j * hy;
        const wy = (j === 0 || j === M) ? 1 : 2;
        for (let i = 0; i <= N; i++) {
            const x = a + i * hx;
            const wx = (i === 0 || i === N) ? 1 : 2;
            sum += wx * wy * f(x, y);
        }
    }
    return (hx * hy / 4) * sum;
}

/** 二维复合辛普森法 */
export function simpson2d(
    f: Integral2DFn,
    xRange: Range1D,
    yRange: Range1D,
    N: number,
    M: number,
): number {
    const [a, b] = xRange;
    const [c, d] = yRange;

    if (N % 2 !== 0 || M % 2 !== 0) {
        throw new Error("辛普森法要求 N 和 M 必须为偶数!");
    }

    const hx = (b - a) / N;
    const hy = (d - c) / M;

    const getW = (idx: number, total: number) => {
        if (idx === 0 || idx === total) return 1;
        return idx % 2 === 1 ? 4 : 2;
    };

    let sum = 0;
    for (let j = 0; j <= M; j++) {
        const y = c + j * hy;
        const wy = getW(j, M);
        for (let i = 0; i <= N; i++) {
            const x = a + i * hx;
            const wx = getW(i, N);
            sum += wx * wy * f(x, y);
        }
    }
    return (hx * hy / 9) * sum;
}

// ================================================================
// 一维数值积分
// ================================================================

/** 一维复合梯形法 */
export function trapz1d(
    f: Integral1DFn,
    a: number,
    b: number,
    N: number,
): number {
    const h = (b - a) / N;
    let sum = 0;
    for (let i = 0; i <= N; i++) {
        const x = a + i * h;
        const w = (i === 0 || i === N) ? 1 : 2;
        sum += w * f(x);
    }
    return (h / 2) * sum;
}

/** 一维复合辛普森法 */
export function simpson1d(
    f: Integral1DFn,
    a: number,
    b: number,
    N: number,
): number {
    if (N % 2 !== 0) throw new Error('辛普森法要求 N 必须为偶数!');
    const h = (b - a) / N;
    let sum = 0;
    for (let i = 0; i <= N; i++) {
        const x = a + i * h;
        const w = (i === 0 || i === N) ? 1 : (i % 2 === 1 ? 4 : 2);
        sum += w * f(x);
    }
    return (h / 3) * sum;
}

/** 一维黎曼和(左端点) */
export function riemann1dLeft(
    f: Integral1DFn,
    a: number,
    b: number,
    N: number,
): number {
    const h = (b - a) / N;
    let sum = 0;
    for (let i = 0; i < N; i++) {
        sum += f(a + i * h);
    }
    return sum * h;
}

/** 一维黎曼和(右端点) */
export function riemann1dRight(
    f: Integral1DFn,
    a: number,
    b: number,
    N: number,
): number {
    const h = (b - a) / N;
    let sum = 0;
    for (let i = 1; i <= N; i++) {
        sum += f(a + i * h);
    }
    return sum * h;
}

/** 一维黎曼和(中点) */
export function riemann1dMid(
    f: Integral1DFn,
    a: number,
    b: number,
    N: number,
): number {
    const h = (b - a) / N;
    let sum = 0;
    for (let i = 0; i < N; i++) {
        sum += f(a + (i + 0.5) * h);
    }
    return sum * h;
}

// ================================================================
// 二维黎曼和
// ================================================================

/** 二维黎曼和(左下方角) */
export function riemann2dLeft(
    f: Integral2DFn,
    xRange: Range1D,
    yRange: Range1D,
    N: number,
    M: number,
): number {
    const [a, b] = xRange;
    const [c, d] = yRange;
    const hx = (b - a) / N;
    const hy = (d - c) / M;
    let sum = 0;
    for (let j = 0; j < M; j++) {
        const y = c + j * hy;
        for (let i = 0; i < N; i++) {
            sum += f(a + i * hx, y);
        }
    }
    return sum * hx * hy;
}

// ================================================================
// 勒贝格积分（一维/二维）
// ================================================================

/** 一维勒贝格积分（按水平测度分层） */
export function lebesgue1d(
    f: Integral1DFn,
    a: number,
    b: number,
    layers: number,
    sampleN: number,
): number {
    const h = (b - a) / sampleN;
    let yMin = Infinity;
    let yMax = -Infinity;
    const samples: { x: number; y: number }[] = [];

    for (let i = 0; i <= sampleN; i++) {
        const x = a + i * h;
        const y = f(x);
        if (isFinite(y)) {
            samples.push({ x, y });
            if (y < yMin) yMin = y;
            if (y > yMax) yMax = y;
        }
    }

    if (samples.length === 0) return 0;

    let sum = 0;

    // 正部
    if (yMax > 1e-12) {
        const dy = yMax / layers;
        for (let k = 0; k < layers; k++) {
            const threshold = k * dy;
            let measure = 0;
            for (let i = 0; i < sampleN; i++) {
                if (isFinite(samples[i].y) && samples[i].y > threshold) {
                    measure += h;
                }
            }
            sum += measure * dy;
        }
    }

    // 负部
    if (yMin < -1e-12) {
        const dy = -yMin / layers;
        for (let k = 0; k < layers; k++) {
            const threshold = k * dy;
            let measure = 0;
            for (let i = 0; i < sampleN; i++) {
                if (isFinite(samples[i].y) && samples[i].y < -threshold) {
                    measure += h;
                }
            }
            sum -= measure * dy;
        }
    }

    return sum;
}

/** 二维勒贝格积分（简化版，按值域分层） */
export function lebesgue2d(
    f: Integral2DFn,
    xRange: Range1D,
    yRange: Range1D,
    layers: number,
    sampleN: number,
): number {
    const [a, b] = xRange;
    const [c, d] = yRange;
    const hx = (b - a) / sampleN;
    const hy = (d - c) / sampleN;

    let zMin = Infinity;
    let zMax = -Infinity;
    const grid: number[][] = [];

    for (let j = 0; j <= sampleN; j++) {
        const y = c + j * hy;
        const row: number[] = [];
        for (let i = 0; i <= sampleN; i++) {
            const z = f(a + i * hx, y);
            if (isFinite(z)) {
                row.push(z);
                if (z < zMin) zMin = z;
                if (z > zMax) zMax = z;
            } else {
                row.push(NaN);
            }
        }
        grid.push(row);
    }

    let sum = 0;

    // 正部
    if (zMax > 1e-12) {
        const dz = zMax / layers;
        for (let k = 0; k < layers; k++) {
            const threshold = k * dz;
            let measure = 0;
            for (let j = 0; j < sampleN; j++) {
                for (let i = 0; i < sampleN; i++) {
                    const z = grid[j][i];
                    if (isFinite(z) && z > threshold) {
                        measure += hx * hy;
                    }
                }
            }
            sum += measure * dz;
        }
    }

    // 负部
    if (zMin < -1e-12) {
        const dz = -zMin / layers;
        for (let k = 0; k < layers; k++) {
            const threshold = k * dz;
            let measure = 0;
            for (let j = 0; j < sampleN; j++) {
                for (let i = 0; i < sampleN; i++) {
                    const z = grid[j][i];
                    if (isFinite(z) && z < -threshold) {
                        measure += hx * hy;
                    }
                }
            }
            sum -= measure * dz;
        }
    }

    return sum;
}