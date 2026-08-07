import init, {
    trapz1d_values,
    simpson1d_values,
    riemann1d_left_values,
    riemann1d_right_values,
    riemann1d_mid_values,
    lebesgue1d_values,
    trapz2d_values,
    simpson2d_values,
    riemann2d_left_values,
    lebesgue2d_values,
} from "../wasm/ml_wasm.js";
import * as math from 'mathjs';

// ---------- 类型 ----------

type IntegralRequest = {
    id: number;
    method:
    | 'trapz1d' | 'simpson1d' | 'riemann1d_left' | 'riemann1d_right' | 'riemann1d_mid' | 'lebesgue1d'
    | 'trapz2d' | 'simpson2d' | 'riemann2d_left' | 'lebesgue2d';
    expr: string;
    coeffs: Record<string, number>;
    /* 一维 */
    a?: number;
    b?: number;
    n?: number;
    layers?: number;
    sampleN?: number;
    /* 二维 */
    xa?: number; xb?: number;
    ya?: number; yb?: number;
    m?: number;
};

type IntegralResponse = {
    id: number;
    value?: number;
    error?: string;
};

// ---------- WASM 初始化 ----------
const wasmInit = init();

// ---------- 表达式编译缓存 ----------
let compiledCache: {
    expr: string;
    coeffsKey: string;
    compiled: math.EvalFunction;
} | null = null;

function coeffsToKey(coeffs: Record<string, number>): string {
    return JSON.stringify(coeffs, Object.keys(coeffs).sort());
}

function getCompiled(expr: string, coeffs: Record<string, number>): math.EvalFunction {
    const key = coeffsToKey(coeffs);
    if (compiledCache && compiledCache.expr === expr && compiledCache.coeffsKey === key) {
        return compiledCache.compiled;
    }
    const node = math.parse(expr);
    const compiled = node.compile();
    compiledCache = { expr, coeffsKey: key, compiled };
    return compiled;
}

// ---------- 1D 采样 ----------

function sample1D(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Float64Array {
    const compiled = getCompiled(expr, coeffs);
    const scope: Record<string, number> = { ...coeffs };
    const h = (b - a) / n;
    const values = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) {
        scope.x = a + i * h;
        const y = compiled.evaluate(scope);
        values[i] = typeof y === 'number' && isFinite(y) ? y : NaN;
    }
    return values;
}

/** 黎曼中点专用:采样 n 个中点值 */
function sampleMid1D(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Float64Array {
    const compiled = getCompiled(expr, coeffs);
    const scope: Record<string, number> = { ...coeffs };
    const h = (b - a) / n;
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        scope.x = a + (i + 0.5) * h;
        const y = compiled.evaluate(scope);
        values[i] = typeof y === 'number' && isFinite(y) ? y : NaN;
    }
    return values;
}

// ---------- 2D 采样 ----------

function sample2D(
    expr: string,
    coeffs: Record<string, number>,
    xa: number, xb: number,
    ya: number, yb: number,
    n: number, m: number,
): Float64Array {
    const compiled = getCompiled(expr, coeffs);
    const scope: Record<string, number> = { ...coeffs };
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

/** 黎曼 2D 左端点专用:采样 n×m 个角落点 */
function sample2DCorner(
    expr: string,
    coeffs: Record<string, number>,
    xa: number, xb: number,
    ya: number, yb: number,
    n: number, m: number,
): Float64Array {
    const compiled = getCompiled(expr, coeffs);
    const scope: Record<string, number> = { ...coeffs };
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

// ---------- 消息处理 ----------

self.onmessage = async (e: MessageEvent<IntegralRequest>) => {
    const req = e.data;
    try {
        await wasmInit;
        const value = compute(req);
        const resp: IntegralResponse = { id: req.id, value };
        self.postMessage(resp);
    } catch (err) {
        const resp: IntegralResponse = {
            id: req.id,
            error: (err as Error).message,
        };
        self.postMessage(resp);
    }
};

// ---------- 路由分发 ----------

function compute(req: IntegralRequest): number {
    const { method, expr, coeffs } = req;

    switch (method) {
        // ---- 一维 ----
        case 'trapz1d': {
            const vals = sample1D(expr, coeffs, req.a!, req.b!, req.n!);
            return trapz1d_values(vals, req.a!, req.b!);
        }
        case 'simpson1d': {
            if (req.n! % 2 !== 0) throw new Error('辛普森法要求 N 为偶数');
            const vals = sample1D(expr, coeffs, req.a!, req.b!, req.n!);
            return simpson1d_values(vals, req.a!, req.b!);
        }
        case 'riemann1d_left': {
            const vals = sample1D(expr, coeffs, req.a!, req.b!, req.n!);
            return riemann1d_left_values(vals, req.a!, req.b!);
        }
        case 'riemann1d_right': {
            const vals = sample1D(expr, coeffs, req.a!, req.b!, req.n!);
            return riemann1d_right_values(vals, req.a!, req.b!);
        }
        case 'riemann1d_mid': {
            const vals = sampleMid1D(expr, coeffs, req.a!, req.b!, req.n!);
            return riemann1d_mid_values(vals, req.a!, req.b!);
        }
        case 'lebesgue1d': {
            const vals = sample1D(expr, coeffs, req.a!, req.b!, req.sampleN!);
            return lebesgue1d_values(vals, req.a!, req.b!, req.layers!);
        }

        // ---- 二维 ----
        case 'trapz2d': {
            const vals = sample2D(expr, coeffs, req.xa!, req.xb!, req.ya!, req.yb!, req.n!, req.m!);
            return trapz2d_values(vals, req.xa!, req.xb!, req.ya!, req.yb!, req.n!, req.m!);
        }
        case 'simpson2d': {
            if (req.n! % 2 !== 0 || req.m! % 2 !== 0)
                throw new Error('辛普森法要求 N, M 均为偶数');
            const vals = sample2D(expr, coeffs, req.xa!, req.xb!, req.ya!, req.yb!, req.n!, req.m!);
            return simpson2d_values(vals, req.xa!, req.xb!, req.ya!, req.yb!, req.n!, req.m!);
        }
        case 'riemann2d_left': {
            const vals = sample2DCorner(expr, coeffs, req.xa!, req.xb!, req.ya!, req.yb!, req.n!, req.m!);
            return riemann2d_left_values(vals, req.xa!, req.xb!, req.ya!, req.yb!, req.n!, req.m!);
        }
        case 'lebesgue2d': {
            const vals = sample2D(expr, coeffs, req.xa!, req.xb!, req.ya!, req.yb!, req.sampleN!, req.sampleN!);
            return lebesgue2d_values(vals, req.xa!, req.xb!, req.ya!, req.yb!, req.sampleN!, req.layers!);
        }

        default:
            throw new Error(`未知积分方法: ${method}`);
    }
}