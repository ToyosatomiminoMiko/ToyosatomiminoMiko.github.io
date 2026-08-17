/**
 * 选项与列表解析辅助函数.
 * 从 DslCompiler 拆出,负责 DSL 选项、数字列表和顶层分隔解析.
 */
import type { OptionPair } from '../ast/types';

const SHOW_KINDS = new Set(['point', 'normal', 'tangent_plane']);

export function findOption(options: OptionPair[], name: string): string | undefined {
    return options.find((item) => item.name === name)?.value;
}

/**
 * DSL option 白名单校验.
 *
 * 数学工具最危险的行为不是报错，而是用户写错一个字段后静默使用默认值。
 * 这里同时拒绝未知选项和重复选项，让编译期错误尽量靠近源码问题。
 */
export function assertKnownOptions(
    options: OptionPair[],
    allowedNames: readonly string[],
    context: string,
): void {
    const allowed = new Set<string>(allowedNames);
    const seen = new Set<string>();

    for (const option of options) {
        if (!allowed.has(option.name)) {
            throw new Error(`${context} 包含未知选项: ${option.name}`);
        }
        if (seen.has(option.name)) {
            throw new Error(`${context} 包含重复选项: ${option.name}`);
        }
        seen.add(option.name);
    }
}

export function stripQuotes(value: string): string {
    return value.replace(/^["']|["']$/g, '');
}

export function parseNumberList(raw: string, context: string): number[] {
    const body = raw.trim();
    if (!body) {
        throw new Error(`${context} 不能为空`);
    }
    const items = body.replace(/[[\]]/g, '').split(',');
    if (items.length === 0 || items.some((item) => item.trim() === '')) {
        throw new Error(`${context} 包含空元素: ${raw}`);
    }
    const values = items.map((item) => Number(item.trim()));
    if (values.some((value) => !Number.isFinite(value))) {
        throw new Error(`${context} 不是有效的数字列表: ${raw}`);
    }
    return values;
}

export function optionalNumber(
    raw: string | undefined,
    context: string,
): number | undefined {
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new Error(`${context} 不是有效数字: ${raw}`);
    }
    return value;
}

export function parsePositiveInteger(
    raw: string | undefined,
    context: string,
): number | undefined {
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${context} 必须是正整数,当前为 ${raw}`);
    }
    return value;
}

/**
 * 带硬上限的正整数解析.
 * 正整数本身只是类型约束,不能防止用户输入一个会耗尽内存的巨大 segments.
 */
export function parseCappedPositiveInteger(
    raw: string | undefined,
    context: string,
    max: number,
): number | undefined {
    const value = parsePositiveInteger(raw, context);
    if (value !== undefined && value > max) {
        throw new Error(`${context} 不能超过 ${max},当前为 ${raw}`);
    }
    return value;
}

export function parsePositiveIntegerList(raw: string, context: string): number[] {
    const values = parseNumberList(raw, context);
    if (values.some((value) => !Number.isInteger(value) || value <= 0)) {
        throw new Error(`${context} 中的每个值都必须是正整数: ${raw}`);
    }
    return values;
}

/**
 * 带硬上限的向量场 grid 解析.
 * 单独限制每轴还不够,必须再限制三维点数乘积,避免 1000 * 1000 * 1000
 * 这类在单轴校验下仍可通过的分配炸弹.
 */
export function parseCappedPositiveIntegerList(
    raw: string,
    context: string,
    maxAxis: number,
    maxTotal: number,
): number[] {
    const values = parsePositiveIntegerList(raw, context);
    if (values.some((value) => value > maxAxis)) {
        throw new Error(`${context} 中的每个值都不能超过 ${maxAxis}: ${raw}`);
    }

    const total = values.reduce(
        (product, value) => product * BigInt(value),
        BigInt(1),
    );
    if (total > BigInt(maxTotal)) {
        throw new Error(`${context} 的网格点总数不能超过 ${maxTotal}: ${raw}`);
    }
    return values;
}

export function toFiniteNumber(raw: string, context: string): number {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new Error(`${context} 不是有效数字: ${raw}`);
    }
    return value;
}

/**
 * 解析 boolean 选项.
 *
 * 这里只接受明确的 true/false；空字符串、1/0、yes/no 都属于 DSL 错误。
 */
export function parseBooleanOption(
    options: OptionPair[],
    name: string,
    context: string,
    defaultValue: boolean,
): boolean {
    const raw = findOption(options, name);
    if (raw === undefined) return defaultValue;

    const normalized = raw.trim();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new Error(`${context} 只能是 true 或 false，当前为 ${raw}`);
}

export function parseShowOption(
    options: OptionPair[],
): Array<'point' | 'normal' | 'tangent_plane'> {
    const raw = findOption(options, 'show');
    if (!raw) return ['point', 'normal'];

    // 不再过滤未知项。show 里的拼写错误必须直接报错，
    // 否则 gradient 的 normal/tangent_plane 可能被用户误认为已经绘制。
    const items = raw.replace(/[[\]]/g, '').split(',').map((item) => item.trim());
    if (items.length === 0 || items.some((item) => item.length === 0)) {
        throw new Error(`show 选项不能为空: ${raw}`);
    }

    for (const item of items) {
        if (!SHOW_KINDS.has(item)) {
            throw new Error(`show 选项包含未知种类: ${item}`);
        }
    }

    return items as Array<'point' | 'normal' | 'tangent_plane'>;
}

export function splitTopLevel(source: string, separator: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let parenDepth = 0;
    let bracketDepth = 0;

    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '(') parenDepth += 1;
        else if (ch === ')') parenDepth -= 1;
        else if (ch === '[') bracketDepth += 1;
        else if (ch === ']') bracketDepth -= 1;
        else if (ch === separator && parenDepth === 0 && bracketDepth === 0) {
            parts.push(source.slice(start, i));
            start = i + 1;
        }
    }

    parts.push(source.slice(start));
    return parts;
}
