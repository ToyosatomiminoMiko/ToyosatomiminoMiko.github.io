import type { IntegralStatement } from '../ast/types';
import type { IntegralMethod, IntegralTask, SceneObject } from '../ir/types';
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

    const rawMethod = findOption(statement.options, 'method') ?? 'riemann';
    if (!INTEGRAL_METHODS.has(rawMethod as IntegralMethod)) {
        throw new Error(`未知积分方法: ${rawMethod}`);
    }
    const method = rawMethod as IntegralMethod;

    const rawRange = findOption(statement.options, 'range');
    let range: [number, number] | [number, number, number, number];
    if (source.kind === 'curve') {
        const rangeValues = rawRange
            ? parseNumberList(rawRange, `积分 ${statement.name} 的 range`)
            : [-4, 4];
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
            : [-3, 3, -3, 3];
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
    ) ?? 32;
    if (method === 'simpson' && segments % 2 !== 0) {
        throw new Error(`积分 ${statement.name} 的辛普森法要求分段数必须为偶数,当前为 ${segments}`);
    }
    const layers = parsePositiveInteger(
        findOption(statement.options, 'layers'),
        `积分 ${statement.name} 的 layers`,
    ) ?? Math.min(32, segments);
    const show = findOption(statement.options, 'show') !== 'false';

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
