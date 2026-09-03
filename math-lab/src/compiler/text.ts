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
