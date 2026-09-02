/**
 * SceneIR -> LaTeX 公式的纯函数层.
 *
 * 只消费 IR 里的纯数据,不碰 DOM/Three.js;每个对象返回一段可直接交给
 * KaTeX 的字符串。表达式本体由 Rust/WASM 的 `latex_expression` 生成,
 * 这里只负责补上对象语义(curve 是 y=…,surface 是 z=…,积分是 ∫…).
 */
import type { IntegralTask, SceneObject } from '../ir/types';
import { cachedLatexExpression } from './expression';

function latexNumber(value: number): string {
    if (!Number.isFinite(value)) return String(value);
    return String(value);
}

/**
 * 实体对象表达式行对应的 LaTeX.
 *
 * 目前只对真正“携带表达式”的对象生成公式:
 * - curve / surface:标量函数;
 * - vector_field / point / vector:数组/向量;
 * - 体积对象(sphere/box/conic)在 IR 中只有数值化后的几何参数,
 *   继续使用 ObjectListController 里的纯文本摘要,避免给出误导性方程.
 */
export function sceneObjectLatex(object: SceneObject): string | null {
    try {
        switch (object.kind) {
            case 'curve':
                return `y=${cachedLatexExpression(object.expr)}`;
            case 'surface':
                return `z=${cachedLatexExpression(object.expr)}`;
            case 'vector_field': {
                const components = object.components
                    .map((component) => cachedLatexExpression(component))
                    .join(',\\ ');
                return `\\mathbf{F}\\left(x,y,z\\right)=\\left(${components}\\right)`;
            }
            case 'point':
            case 'vector':
                // point/vector 的 expr 是 `[x, y, z]` / `[[起点], [方向]]`,
                // Rust 打印器会把嵌套数组也转成 LaTeX,保留原始符号参数.
                return cachedLatexExpression(object.expr);
            case 'sphere':
            case 'box':
            case 'conic':
                return null;
        }
    } catch {
        // DSL 编译阶段已经校验过表达式;这里只做展示,失败时回退纯文本.
        return null;
    }
}

/**
 * 积分任务对应的积分式(不含方法名,方法名由 UI 拼在公式后面).
 *
 * 只返回 LaTeX 正文;找不到被积对象时返回 null,由 UI 回退到文字摘要.
 */
export function integralLatex(
    task: IntegralTask,
    objects: SceneObject[],
): string | null {
    try {
        const source = objects.find((object) => object.id === task.objectId);
        if (!source) return null;

        if (source.kind === 'curve' && task.range.length === 2) {
            const [a, b] = task.range as [number, number];
            return [
                `\\int_{${latexNumber(a)}}^{${latexNumber(b)}}`,
                cachedLatexExpression(source.expr),
                '\\mathrm{d}x',
            ].join(' ');
        }

        if (source.kind === 'surface' && task.range.length === 4) {
            const [xa, xb, ya, yb] = task.range as [
                number,
                number,
                number,
                number,
            ];
            return [
                `\\int_{${latexNumber(xa)}}^{${latexNumber(xb)}}`,
                `\\int_{${latexNumber(ya)}}^{${latexNumber(yb)}}`,
                cachedLatexExpression(source.expr),
                '\\mathrm{d}y\\,\\mathrm{d}x',
            ].join(' ');
        }

        return null;
    } catch {
        return null;
    }
}
