type MatlabAlias = 'surf' | 'plot' | 'quiver3' | 'divergence' | 'curl' | 'gradient';

type MatlabNormalizer = {
    anonymousCounters: Map<string, number>;
};

/**
 * 每次归一化都创建独立上下文，避免模块级可变全局状态。
 *
 * 旧实现把匿名计数器放在模块顶层，导致调用顺序会隐式影响结果：
 * 直接调用 normalizeMatlabCalls 和先调用 normalizeMatlabSyntax 可能共享状态。
 * 现在计数器跟随一次归一化过程，函数可以安全地独立调用。
 */
function createMatlabNormalizer(): MatlabNormalizer {
    return { anonymousCounters: new Map<string, number>() };
}

function nextAnonymousName(normalizer: MatlabNormalizer, prefix: string): string {
    const next = (normalizer.anonymousCounters.get(prefix) ?? 0) + 1;
    normalizer.anonymousCounters.set(prefix, next);
    return `_matlab_${prefix}_${next}`;
}

function findMatchingBracket(source: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '[') depth += 1;
        else if (ch === ']') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function findMatchingParen(source: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function splitTopLevel(source: string, separator: string): string[] {
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

function splitTopLevelWhitespace(source: string): string[] {
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

function normalizeMatlabAtom(atom: string): string {
    const trimmed = atom.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return `[${normalizeMatlabBracketContent(trimmed.slice(1, -1))}]`;
    }
    return trimmed;
}

function normalizeMatlabRow(row: string): string {
    const commaParts = splitTopLevel(row, ',');
    if (commaParts.length === 1 && /\s/.test(commaParts[0].trim())) {
        return splitTopLevelWhitespace(commaParts[0])
            .map(normalizeMatlabAtom)
            .join(', ');
    }

    return commaParts
        .map((part) => normalizeMatlabAtom(part))
        .join(', ');
}

function normalizeMatlabBracketContent(inner: string): string {
    const rows = splitTopLevel(inner, ';');
    if (rows.length > 1) {
        return rows.map((row) => `[${normalizeMatlabRow(row)}]`).join(', ');
    }
    return normalizeMatlabRow(inner);
}

/** 把 MATLAB 空格分隔向量和 `;` 分隔矩阵归一化成逗号分隔形式. */
export function normalizeMatlabMatrixLiterals(source: string): string {
    let result = '';
    let i = 0;

    while (i < source.length) {
        if (source[i] === '[') {
            const end = findMatchingBracket(source, i);
            if (end === -1) {
                result += source.slice(i);
                break;
            }
            result += `[${normalizeMatlabBracketContent(source.slice(i + 1, end))}]`;
            i = end + 1;
        } else {
            result += source[i];
            i += 1;
        }
    }

    return result;
}

/** 去掉 `.*`\`./`\`.^` 中的点号. */
export function normalizeElementwise(source: string): string {
    return source
        .replace(/\.\*/g, '*')
        .replace(/\.\//g, '/')
        .replace(/\.\^/g, '^');
}

/** 删除 `syms ...;` 声明. */
export function removeSyms(source: string): string {
    return source.replace(/\bsyms\s+[^;\n]*;?/g, '');
}

function buildCanonicalStatement(
    normalizer: MatlabNormalizer,
    fn: MatlabAlias,
    assignedName: string,
    args: string[],
): string {
    const name = assignedName || nextAnonymousName(normalizer, fn);

    switch (fn) {
        case 'surf': {
            const f = args[2] ?? '0';
            return `surface ${name} = ${f};`;
        }
        case 'plot': {
            const y = args[1] ?? '0';
            return `curve ${name} = ${y};`;
        }
        case 'quiver3': {
            const u = args[3] ?? '0';
            const v = args[4] ?? '0';
            const w = args[5] ?? '0';
            return `vector_field ${name} = [${u}, ${v}, ${w}];`;
        }
        case 'gradient': {
            const f = args[0] ?? '0';
            return `gradient ${name} = grad(${f});`;
        }
        case 'divergence': {
            const f = args[0] ?? '0';
            return `divergence ${name} = div(${f});`;
        }
        case 'curl': {
            const f = args[0] ?? '0';
            return `curl ${name} = curl(${f});`;
        }
    }
}

/** 把 MATLAB 风格的绘图 / 微分算子调用改写成 `.miko` 声明. */
export function normalizeMatlabCalls(
    source: string,
    normalizer: MatlabNormalizer = createMatlabNormalizer(),
): string {
    const pattern = /(?:([A-Za-z_][A-Za-z0-9_]*)\s*=\s*)?\b(surf|plot|quiver3|divergence|curl|gradient)\s*\(/g;
    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(source)) !== null) {
        const openParen = pattern.lastIndex - 1;
        const closeParen = findMatchingParen(source, openParen);
        if (closeParen === -1) continue;

        const assignedName = match[1] ? match[1].replace(/\s*=\s*$/, '').trim() : '';
        const fn = match[2] as MatlabAlias;
        const args = splitTopLevel(source.slice(openParen + 1, closeParen), ',')
            .map((arg) => arg.trim());

        let end = closeParen + 1;
        let semicolonIndex = end;
        while (semicolonIndex < source.length && /\s/.test(source[semicolonIndex])) {
            semicolonIndex += 1;
        }
        if (source[semicolonIndex] === ';') {
            end = semicolonIndex + 1;
        }

        result += source.slice(lastIndex, match.index);
        result += buildCanonicalStatement(normalizer, fn, assignedName, args);
        lastIndex = end;
        pattern.lastIndex = end;
    }

    result += source.slice(lastIndex);
    return result;
}

/** MATLAB 兼容入口:依次做归一化，结果交给 `.miko` parser. */
export function normalizeMatlabSyntax(source: string): string {
    const normalizer = createMatlabNormalizer();
    let result = source;
    result = removeSyms(result);
    result = normalizeElementwise(result);
    result = normalizeMatlabMatrixLiterals(result);
    result = normalizeMatlabCalls(result, normalizer);
    return result;
}
