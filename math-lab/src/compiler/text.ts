/**
 * 纯文本工具.
 *
 * `splitTopLevel` 需要同时被 DSL 选项解析和 MATLAB 兼容层使用,放在这里
 * 避免每个模块各自维护一份带括号深度计数的复制.
 */
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

/** 按顶层空白切分(括号深度归零时才把空白当作分隔符). */
export function splitTopLevelWhitespace(source: string): string[] {
    const parts: string[] = [];
    let tokenStart = 0;
    let inToken = false;
    let parenDepth = 0;
    let bracketDepth = 0;

    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '(') parenDepth += 1;
        else if (ch === ')') parenDepth -= 1;
        else if (ch === '[') bracketDepth += 1;
        else if (ch === ']') bracketDepth -= 1;

        if (/\s/.test(ch) && parenDepth === 0 && bracketDepth === 0) {
            if (inToken) {
                parts.push(source.slice(tokenStart, i));
                inToken = false;
            }
        } else if (!inToken) {
            tokenStart = i;
            inToken = true;
        }
    }

    if (inToken) parts.push(source.slice(tokenStart));
    return parts;
}

/**
 * 从 `openIndex` 开始找与之配对的闭合括号.
 *
 * 只接受 `(`/`[` 作为起始字符,返回闭合下标;找不到时返回 -1.
 */
export function findMatchingDelimiter(source: string, openIndex: number): number {
    const open = source[openIndex];
    const close = open === '(' ? ')' : open === '[' ? ']' : null;
    if (close === null) return -1;

    let depth = 0;
    for (let i = openIndex; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === open) depth += 1;
        else if (ch === close) {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}
