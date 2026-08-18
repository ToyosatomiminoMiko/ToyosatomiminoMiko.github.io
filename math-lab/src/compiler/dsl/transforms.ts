/**
 * 场景矩阵与变换解析。
 *
 * 矩阵语法解析与常量求值由 Rust/WASM 完成；这里只负责把扁平的 16 个
 * 数值重新组织为 Mat4，并解析 DSL 的 transform 组合语法。
 */
import type { MatrixOps } from '../../math/tensor/SceneTransform';
import { evaluateMatrixExpr, evaluateNumber } from './expression';
import { splitTopLevel } from './options';

export type Mat4 = number[][];

function flatToMat4(values: number[]): Mat4 | null {
    if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
        return null;
    }
    return [
        values.slice(0, 4),
        values.slice(4, 8),
        values.slice(8, 12),
        values.slice(12, 16),
    ];
}

export function cloneMat4(matrix: Mat4): Mat4 {
    return matrix.map((row) => [...row]);
}

export function evaluateMatrix(raw: string): Mat4 | null {
    try {
        return flatToMat4(evaluateMatrixExpr(raw));
    } catch {
        return null;
    }
}

function parseTransformFunction(part: string, ops: MatrixOps): Mat4 | null {
    const match = /^(translate|scale|rotate)\s*\(\s*\[([^\]]*)\]\s*\)$/.exec(part);
    if (!match) return null;

    const values = match[2].split(',').map((item) => evaluateNumber(item.trim()));
    if (values.some((value) => value === null) || values.length !== 3) return null;
    const numbers = values as number[];

    switch (match[1]) {
        case 'translate':
            return ops.translate(numbers);
        case 'scale':
            return ops.scale(numbers);
        case 'rotate':
            return ops.rotate(numbers);
        default:
            return null;
    }
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
