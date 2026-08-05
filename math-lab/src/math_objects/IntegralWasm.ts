import type { Range1D } from './types';

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
};

// ---------- Worker 管理 ----------
let worker: Worker | null = null;
let workerAlive = false;
let nextId = 1;
const pending = new Map<
    number,
    { resolve: (v: number) => void; reject: (e: Error) => void }
>();

function createWorker(): Worker {
    const w = new Worker(
        new URL('./IntegralWorker.ts', import.meta.url),
        { type: 'module' },
    );
    w.onmessage = (e: MessageEvent<Response>) => {
        const { id, value, error } = e.data;
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (error) {
            p.reject(new Error(error));
        } else {
            p.resolve(value!);
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
): Promise<number> {
    const id = nextId++;
    const w = getWorker();
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ id, method, expr, coeffs, ...params } satisfies Request);
    });
}

// ---------- 公共 API ----------

export async function trapz1d(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<number> {
    return callWasm('trapz1d', expr, coeffs, { a, b, n });
}

export async function simpson1d(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<number> {
    return callWasm('simpson1d', expr, coeffs, { a, b, n });
}

export async function riemann1dLeft(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<number> {
    return callWasm('riemann1d_left', expr, coeffs, { a, b, n });
}

export async function riemann1dRight(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<number> {
    return callWasm('riemann1d_right', expr, coeffs, { a, b, n });
}

export async function riemann1dMid(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    n: number,
): Promise<number> {
    return callWasm('riemann1d_mid', expr, coeffs, { a, b, n });
}

export async function lebesgue1d(
    expr: string,
    coeffs: Record<string, number>,
    a: number,
    b: number,
    layers: number,
    sampleN: number,
): Promise<number> {
    return callWasm('lebesgue1d', expr, coeffs, { a, b, layers, sampleN });
}

export async function trapz2d(
    expr: string,
    coeffs: Record<string, number>,
    xRange: Range1D,
    yRange: Range1D,
    n: number,
    m: number,
): Promise<number> {
    return callWasm('trapz2d', expr, coeffs, {
        xa: xRange[0],
        xb: xRange[1],
        ya: yRange[0],
        yb: yRange[1],
        n,
        m,
    });
}

export async function simpson2d(
    expr: string,
    coeffs: Record<string, number>,
    xRange: Range1D,
    yRange: Range1D,
    n: number,
    m: number,
): Promise<number> {
    return callWasm('simpson2d', expr, coeffs, {
        xa: xRange[0],
        xb: xRange[1],
        ya: yRange[0],
        yb: yRange[1],
        n,
        m,
    });
}

export async function riemann2dLeft(
    expr: string,
    coeffs: Record<string, number>,
    xRange: Range1D,
    yRange: Range1D,
    n: number,
    m: number,
): Promise<number> {
    return callWasm('riemann2d_left', expr, coeffs, {
        xa: xRange[0],
        xb: xRange[1],
        ya: yRange[0],
        yb: yRange[1],
        n,
        m,
    });
}

export async function lebesgue2d(
    expr: string,
    coeffs: Record<string, number>,
    xRange: Range1D,
    yRange: Range1D,
    layers: number,
    sampleN: number,
): Promise<number> {
    return callWasm('lebesgue2d', expr, coeffs, {
        xa: xRange[0],
        xb: xRange[1],
        ya: yRange[0],
        yb: yRange[1],
        layers,
        sampleN,
    });
}