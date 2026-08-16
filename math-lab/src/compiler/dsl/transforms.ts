import * as math from 'mathjs';
import type { MatrixOps } from '../../math/tensor/SceneTransform';
import { evaluateNumber } from './expression';
import { splitTopLevel } from './options';

export type Mat4 = number[][];

export function cloneMat4(matrix: Mat4): Mat4 {
    return matrix.map((row) => [...row]);
}

export function evaluateMatrix(raw: string): Mat4 | null {
    try {
        const value = math.evaluate(raw) as unknown;
        const rows = value && typeof (value as { toArray?: () => unknown }).toArray === 'function'
            ? (value as { toArray: () => unknown }).toArray()
            : value;

        if (Array.isArray(rows) && rows.length === 4) {
            const matrix = rows.map((row) => (Array.isArray(row) ? row.map(Number) : []));
            if (
                matrix.every(
                    (row) => row.length === 4 && row.every((entry) => Number.isFinite(entry)),
                )
            ) {
                return matrix as Mat4;
            }
        }
    } catch {
        return null;
    }
    return null;
}

function parseTransformFunction(part: string, ops: MatrixOps): Mat4 | null {
    const match = /^(translate|scale|rotate)\s*\(\s*\[([^\]]*)\]\s*\)$/.exec(part);
    if (!match) return null;

    const values = match[2].split(',').map((item) => evaluateNumber(item.trim()));
    if (values.some((value) => value === null) || values.length !== 3) return null;
    const numbers = values as number[];

    if (match[1] === 'translate') return ops.translate(numbers);
    if (match[1] === 'scale') return ops.scale(numbers);
    return ops.rotate(numbers);
}

export function parseTransformExpression(
    raw: string,
    matrices: Map<string, Mat4>,
    ops: MatrixOps,
): Mat4 | null {
    const expression = raw.trim();
    const asTransformMatch = /^as_transform\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/.exec(expression);
    if (asTransformMatch) {
        const matrix = matrices.get(asTransformMatch[1]);
        return matrix ? cloneMat4(matrix) : null;
    }

    const parts = splitTopLevel(expression, '*').map((part) => part.trim());
    if (parts.length === 0) return null;

    let result = ops.identity();
    for (const part of parts) {
        const matrix = parseTransformFunction(part, ops);
        if (!matrix) return null;
        result = ops.multiply(result, matrix);
    }
    return result;
}

export function resolveObjectTransform(
    raw: string | undefined,
    transforms: Map<string, Mat4>,
    matrices: Map<string, Mat4>,
): Mat4 | null {
    if (!raw) return null;
    const value = raw.trim();

    const asTransformMatch = /^as_transform\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/.exec(value);
    if (asTransformMatch) {
        const matrix = matrices.get(asTransformMatch[1]);
        if (matrix) return cloneMat4(matrix);
        throw new Error(`对象 transform 引用了不存在的矩阵 ${asTransformMatch[1]}`);
    }

    const transform = transforms.get(value);
    if (transform) return cloneMat4(transform);
    throw new Error(`对象 transform 引用了不存在的变换 ${value}`);
}
