/**
 * 选项与列表解析辅助函数。
 * 从 DslCompiler 拆出，负责 DSL 选项、数字列表和顶层分隔解析。
 */
import type { OptionPair } from '../ast/types';

const SHOW_KINDS = new Set(['point', 'normal', 'tangent_plane']);

export function findOption(options: OptionPair[], name: string): string | undefined {
    return options.find((item) => item.name === name)?.value;
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

export function optionalNumber(raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
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

export function parsePositiveIntegerList(raw: string, context: string): number[] {
    const values = parseNumberList(raw, context);
    if (values.some((value) => !Number.isInteger(value) || value <= 0)) {
        throw new Error(`${context} 中的每个值都必须是正整数: ${raw}`);
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

export function parseShowOption(
    options: OptionPair[],
): Array<'point' | 'normal' | 'tangent_plane'> {
    const raw = findOption(options, 'show');
    if (!raw) return ['point', 'normal'];

    const items = raw
        .replace(/[[\]]/g, '')
        .split(',')
        .map((item) => item.trim())
        .filter((item): item is 'point' | 'normal' | 'tangent_plane' =>
            SHOW_KINDS.has(item),
        );
    return items.length > 0 ? items : ['point', 'normal'];
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
