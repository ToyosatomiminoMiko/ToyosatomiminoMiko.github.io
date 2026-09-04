/**
 * 数值计算门面.
 * 当前先把积分计算收口到这里,后续再把曲线/曲面/向量场采样逐步迁入.
 */
import type {
    IntegralTask,
    SceneObject,
} from '../../compiler/ir/types';
import { coefficientsToRecord } from '../coefficientUtils';
import {
    integrate as runIntegral,
    type IntegralResult,
} from './IntegralWasm';
import { curveComputeClient } from './workers/CurveComputeClient';

export type IntegralSource = Extract<SceneObject, { kind: 'curve' | 'surface' }>;

export type CurveSampleRequest = {
    expr: string;
    coeffNames: string[];
    coeffValues: number[];
    range: [number, number];
    segments: number;
};

/** 各维度允许的 IR 方法集合;编译器已保证输入合法,这里只做防御. */
const SUPPORTED_1D = new Set<IntegralTask['method']>([
    'trapezoid',
    'simpson',
    'riemann:left',
    'riemann:right',
    'riemann:mid',
    'lebesgue',
]);
const SUPPORTED_2D = new Set<IntegralTask['method']>([
    'trapezoid',
    'simpson',
    'riemann:left',
    'lebesgue',
]);

export class MathComputeEngine {
    async sampleCurve(request: CurveSampleRequest): Promise<Float32Array> {
        // 曲线采样与曲面/向量场保持一致:交给 Worker 执行,避免高 segments
        // 或大量曲线时阻塞主线程.失败直接上抛,由渲染层统一上报诊断,
        // 不再做主线程静默兜底(否则 Worker 故障会被悄悄掩盖).
        return curveComputeClient.request(request);
    }

    async integrate(task: IntegralTask, source: IntegralSource): Promise<IntegralResult> {
        const is2D = task.range.length === 4;
        const supported = is2D ? SUPPORTED_2D : SUPPORTED_1D;
        if (!supported.has(task.method)) {
            throw new Error(
                `${is2D ? '二维' : '一维'}积分不支持方法 ${task.method}`,
            );
        }

        // 方法语义名,range,分段直接透传给 Worker;lebesgue 的超采样与
        // n/m/layers 归一化由 IntegralWasm 内部完成.
        return runIntegral({
            method: task.method,
            expr: source.expr,
            coeffs: coefficientsToRecord(source.coefficients),
            range: task.range as [number, number] | [number, number, number, number],
            segments: task.segments,
            layers: task.layers,
        });
    }

    dispose(): void {
        // 本类只是计算门面,不拥有任何共享 worker.
        // worker 生命周期由应用级 dispose 统一处理.
    }
}
