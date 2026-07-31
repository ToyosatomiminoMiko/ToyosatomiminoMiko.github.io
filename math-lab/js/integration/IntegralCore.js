// 二维复合梯形法 
export function trapz2d(f, xRange, yRange, N, M) {
    const [a, b] = xRange;
    const [c, d] = yRange;
    const hx = (b - a) / N;
    const hy = (d - c) / M;

    // 优化:预判边界条件,减少循环内的 if 判断
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

// 二维复合辛普森法 
export function simpson2d(f, xRange, yRange, N, M) {
    const [a, b] = xRange;
    const [c, d] = yRange;

    if (N % 2 !== 0 || M % 2 !== 0) {
        throw new Error("辛普森法要求 N 和 M 必须为偶数!");
    }

    const hx = (b - a) / N;
    const hy = (d - c) / M;

    // 获取一维权重:两端1,奇索引4,偶索引2
    const getW = (idx, total) => {
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

// 一维复合梯形法 
export function trapz1d(f, a, b, N) {
    const h = (b - a) / N;
    let sum = 0;
    for (let i = 0; i <= N; i++) {
        const x = a + i * h;
        const w = (i === 0 || i === N) ? 1 : 2;
        sum += w * f(x);
    }
    return (h / 2) * sum;
}

// 一维复合辛普森法 
export function simpson1d(f, a, b, N) {
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

// 一维黎曼和(左端点)
export function riemann1dLeft(f, a, b, N) {
    const h = (b - a) / N;
    let sum = 0;
    for (let i = 0; i < N; i++) {
        const x = a + i * h;          // 左端点
        sum += f(x);
    }
    return sum * h;
}

// 一维黎曼和(右端点)
export function riemann1dRight(f, a, b, N) {
    const h = (b - a) / N;
    let sum = 0;
    for (let i = 1; i <= N; i++) {
        const x = a + i * h;          // 右端点
        sum += f(x);
    }
    return sum * h;
}

// 一维黎曼和(中点)
export function riemann1dMid(f, a, b, N) {
    const h = (b - a) / N;
    let sum = 0;
    for (let i = 0; i < N; i++) {
        const x = a + (i + 0.5) * h;  // 中点
        sum += f(x);
    }
    return sum * h;
}

// 二维黎曼和(左下方角)
export function riemann2dLeft(f, xRange, yRange, N, M) {
    const [a, b] = xRange;
    const [c, d] = yRange;
    const hx = (b - a) / N;
    const hy = (d - c) / M;
    let sum = 0;
    for (let j = 0; j < M; j++) {
        const y = c + j * hy;
        for (let i = 0; i < N; i++) {
            const x = a + i * hx;
            sum += f(x, y);
        }
    }
    return sum * hx * hy;
}

// ⚠️ 数组越界问题??? samples 数组可能比 sampleN 短
// 一维勒贝格 layers: 层数(值域等分数); sampleN: 采样精度
export function lebesgue1d(f, a, b, layers, sampleN) {
    const h = (b - a) / sampleN;
    let yMin = Infinity, yMax = -Infinity;
    const samples = [];
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
    // 正部: ∫₀^{yMax} μ({f > t}) dt
    if (yMax > 1e-12) {
        const dy = yMax / layers;
        for (let k = 0; k < layers; k++) {
            const threshold = k * dy;   // 从 0 往上
            let measure = 0;
            for (let i = 0; i < sampleN; i++) {
                if (isFinite(samples[i].y) && samples[i].y > threshold) {
                    measure += h;
                }
            }
            sum += measure * dy;
        }
    }
    // 负部:∫₀^{-yMin} μ({f < -t}) dt
    if (yMin < -1e-12) {
        const dy = -yMin / layers;
        for (let k = 0; k < layers; k++) {
            const threshold = k * dy;   // 从 0 往上
            let measure = 0;
            for (let i = 0; i < sampleN; i++) {
                if (isFinite(samples[i].y) && samples[i].y < -threshold) {
                    measure += h;
                }
            }
            sum -= measure * dy;   // 减去负部贡献
        }
    }

    return sum;
}

// ----- 二维勒贝格积分(简化版) -----
// 按函数值分层,测量每层对应的 (x,y) 区域面积
export function lebesgue2d(f, xRange, yRange, layers, sampleN) {
    const [a, b] = xRange;
    const [c, d] = yRange;
    const hx = (b - a) / sampleN;
    const hy = (d - c) / sampleN;

    let zMin = Infinity, zMax = -Infinity;
    const grid = [];
    for (let j = 0; j <= sampleN; j++) {
        const y = c + j * hy;
        const row = [];
        for (let i = 0; i <= sampleN; i++) {
            const x = a + i * hx;
            const z = f(x, y);
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
    //  正部
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
    //  负部
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
