/**
 * 积分任务编译。
 * 把 DSL 中的 integral 声明转成渲染层可消费的 IntegralTask。
 */
import type { IntegralStatement } from '../ast/types';
import type { IntegralMethod, IntegralTask, SceneObject } from '../ir/types';
import { NUMERIC_CONFIG } from '../../config/numericConfig';
import { findOption, parseNumberList, parsePositiveInteger } from './options';

const INTEGRAL_METHODS = new Set<IntegralMethod>(['trapezoid', 'simpson', 'riemann', 'lebesgue']);

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

    const segments = parsePositiveInteger(
        findOption(statement.options, 'segments'),
        `积分 ${statement.name} 的 segments`,
    ) ?? NUMERIC_CONFIG.integral.defaultSegments;
    if (method === 'simpson' && segments % 2 !== 0) {
        throw new Error(`积分 ${statement.name} 的辛普森法要求分段数必须为偶数,当前为 ${segments}`);
    }
    const layers = parsePositiveInteger(
        findOption(statement.options, 'layers'),
        `积分 ${statement.name} 的 layers`,
    ) ?? Math.min(NUMERIC_CONFIG.integral.defaultLayersCap, segments);
    const show = findOption(statement.options, 'show') !== 'false'
        && NUMERIC_CONFIG.integral.showDefault;

    return {
        name: statement.name,
        objectId: source.id,
        sourceKind: source.kind,
        method,
        range,
        segments,
        layers,
        show,
    };
}
