/**
 * 积分任务编译.
 * 把 DSL 中的 integral 声明转成渲染层可消费的 IntegralTask.
 */
import type { IntegralStatement } from '../ast/types';
import type { IntegralMethod, IntegralTask, SceneObject } from '../ir/types';
import { NUMERIC_CONFIG } from '../../config/numericConfig';
import {
    assertKnownOptions,
    findOption,
    parseBooleanOption,
    parseCappedPositiveInteger,
    parseNumberList,
} from './options';

const INTEGRAL_METHODS = new Set<IntegralMethod>(['trapezoid', 'simpson', 'riemann', 'lebesgue']);
const INTEGRAL_OPTION_NAMES = ['method', 'range', 'segments', 'layers', 'show'] as const;

export function compileIntegralTask(
    statement: IntegralStatement,
    objectByName: Map<string, SceneObject>,
): IntegralTask {
    const source = objectByName.get(statement.source.trim());
    if (!source) {
        throw new Error(`积分 ${statement.name} 引用了不存在的对象 ${statement.source}`);
    }
    if (source.kind !== 'curve' && source.kind !== 'surface') {
        throw new Error(`积分 ${statement.name} 只能应用于 curve 或 surface`);
    }

    // DSL 必须严格失败:未知 option 或重复 option 是用户错误，
    // 不能静默忽略后按默认值画一张“看起来正确”的图.
    assertKnownOptions(
        statement.options,
        INTEGRAL_OPTION_NAMES,
        `积分 ${statement.name}`,
    );

    const rawMethod = findOption(statement.options, 'method') ?? NUMERIC_CONFIG.integral.defaultMethod;
    if (!INTEGRAL_METHODS.has(rawMethod as IntegralMethod)) {
        throw new Error(`未知积分方法: ${rawMethod}`);
    }
    const method = rawMethod as IntegralMethod;

    const rawRange = findOption(statement.options, 'range');
    let range: [number, number] | [number, number, number, number];
    if (source.kind === 'curve') {
        const rangeValues = rawRange
            ? parseNumberList(rawRange, `积分 ${statement.name} 的 range`)
            : [...NUMERIC_CONFIG.integral.defaultRange1D];
        if (rangeValues.length !== 2) {
            throw new Error(`积分 ${statement.name} 的 range 需要 2 个数值`);
        }
        if (rangeValues[0] >= rangeValues[1]) {
            throw new Error(`积分 ${statement.name} 需要有效的一维区间 a < b`);
        }
        range = [rangeValues[0], rangeValues[1]];
    } else {
        const rangeValues = rawRange
            ? parseNumberList(rawRange, `积分 ${statement.name} 的 range`)
            : [...NUMERIC_CONFIG.integral.defaultRange2D];
        if (rangeValues.length !== 4) {
            throw new Error(`积分 ${statement.name} 的 range 需要 4 个数值`);
        }
        if (rangeValues[0] >= rangeValues[1] || rangeValues[2] >= rangeValues[3]) {
            throw new Error(`积分 ${statement.name} 需要有效的二维区间`);
        }
        range = [rangeValues[0], rangeValues[1], rangeValues[2], rangeValues[3]];
    }

    // 一维与二维积分的资源风险完全不同.
    // 二维积分按 n*m 采样，必须使用更小的独立上限;
    // 一维积分则可以允许更大的 segments，只受线性缓冲限制.
    const maxSegments = source.kind === 'curve'
        ? NUMERIC_CONFIG.limits.integral.maxSegments1D
        : NUMERIC_CONFIG.limits.integral.maxSegments2D;
    const segments = parseCappedPositiveInteger(
        findOption(statement.options, 'segments'),
        `积分 ${statement.name} 的 segments`,
        maxSegments,
    ) ?? NUMERIC_CONFIG.integral.defaultSegments;
    if (method === 'simpson' && segments % 2 !== 0) {
        throw new Error(`积分 ${statement.name} 的辛普森法要求分段数必须为偶数,当前为 ${segments}`);
    }
    const layers = parseCappedPositiveInteger(
        findOption(statement.options, 'layers'),
        `积分 ${statement.name} 的 layers`,
        NUMERIC_CONFIG.limits.integral.maxLayers,
    ) ?? Math.min(NUMERIC_CONFIG.integral.defaultLayersCap, segments);
    const show = parseBooleanOption(
        statement.options,
        'show',
        `积分 ${statement.name} 的 show`,
        NUMERIC_CONFIG.integral.showDefault,
    );

    return {
        name: statement.name,
        objectId: source.id,
        sourceKind: source.kind,
        method,
        range,
        segments,
        layers,
        show,
        enabled: true,
    };
}
