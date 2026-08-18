/**
 * 积分计算 Worker.
 * 采样、求值与积分值计算全部由 Rust/WASM 完成,不再使用外部 JS 数学库。
 */
import init, {
    integrate1d,
    integrate2d,
} from "../../../wasm/math_rs/math_rs";

type IntegralRequest = {
    id: number;
    method:
    | 'trapz1d' | 'simpson1d' | 'riemann1d_left' | 'riemann1d_right' | 'riemann1d_mid' | 'lebesgue1d'
    | 'trapz2d' | 'simpson2d' | 'riemann2d_left' | 'lebesgue2d';
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

type IntegralResponse = {
    id: number;
    value?: number;
    error?: string;
    samples?: Float64Array;
    sampleShape?: '1d-grid' | '1d-mid' | '2d-grid' | '2d-corner';
    n?: number;
    m?: number;
};

const wasmInit = init();
const workerScope = self as unknown as {
    postMessage(message: IntegralResponse, transfer?: Transferable[]): void;
};

function coeffArgs(coeffs: Record<string, number>): [string[], Float64Array] {
    const names = Object.keys(coeffs).sort();
    return [names, new Float64Array(names.map((name) => coeffs[name]))];
}

self.onmessage = async (e: MessageEvent<IntegralRequest>) => {
    const req = e.data;
    try {
        await wasmInit;
        const [coeffNames, coeffValues] = coeffArgs(req.coeffs);
        const result = compute(req, coeffNames, coeffValues);
        const resp: IntegralResponse = {
            id: req.id,
            value: result.value,
            samples: Float64Array.from(result.samples),
            sampleShape: result.sampleShape,
            n: result.n,
            m: result.m || undefined,
        };
        workerScope.postMessage(resp, [resp.samples!.buffer]);
    } catch (err) {
        const resp: IntegralResponse = {
            id: req.id,
            error: (err as Error).message,
        };
        workerScope.postMessage(resp);
    }
};

function compute(
    req: IntegralRequest,
    coeffNames: string[],
    coeffValues: Float64Array,
): {
    value: number;
    samples: Float64Array;
    sampleShape: '1d-grid' | '1d-mid' | '2d-grid' | '2d-corner';
    n: number;
    m?: number;
} {
    const is1D =
        req.method === 'trapz1d'
        || req.method === 'simpson1d'
        || req.method === 'riemann1d_left'
        || req.method === 'riemann1d_right'
        || req.method === 'riemann1d_mid'
        || req.method === 'lebesgue1d';

    if (is1D) {
        const isLebesgue = req.method === 'lebesgue1d';
        const sampleN = isLebesgue ? req.sampleN! : req.n!;
        const layers = isLebesgue ? req.layers! : req.n!;
        const result = integrate1d(
            req.expr,
            coeffNames,
            coeffValues,
            req.a!,
            req.b!,
            sampleN,
            layers,
            req.method,
        );
        return {
            value: result.value,
            samples: Float64Array.from(result.samples),
            sampleShape: result.sample_shape as '1d-grid' | '1d-mid',
            n: result.n,
        };
    }

    const isLebesgue = req.method === 'lebesgue2d';
    const n = isLebesgue ? req.sampleN! : req.n!;
    const m = isLebesgue ? req.sampleN! : req.m!;
    const layers = isLebesgue ? req.layers! : req.n!;
    const result = integrate2d(
        req.expr,
        coeffNames,
        coeffValues,
        req.xa!,
        req.xb!,
        req.ya!,
        req.yb!,
        n,
        m,
        layers,
        req.method,
    );
    return {
        value: result.value,
        samples: Float64Array.from(result.samples),
        sampleShape: result.sample_shape as '2d-grid' | '2d-corner',
        n: result.n,
        m: result.m,
    };
}
