import * as math from 'mathjs';
import type { MathNode, EvalFunction } from 'mathjs';
/**
 * 梯度计算结果
 */
export interface GradientResult {
    /** ∂f/∂x 在 (x₀, y₀) 的值 */
    fx: number;
    /** ∂f/∂y 在 (x₀, y₀) 的值 */
    fy: number;
    /** f(x₀, y₀) 函数值 */
    f0: number;
    /** 归一化法向量 [nx, ny, nz] */
    normalDirection: [number, number, number];
    /** 切平面表达式树 可直接用于添加 3D 曲面 */
    tangentPlaneNode: MathNode;
}

const compiledCache = new WeakMap<
    MathNode,
    { surface: EvalFunction; fx: EvalFunction; fy: EvalFunction }
>();
/**
 * 对二元函数 z = f(x, y) 在点 (x₀, y₀) 处计算梯度,法向量和切平面
 *
 * 数学原理:
 *   定义 F(x,y,z) = z - f(x,y)  ->  曲面是 F=0 的等值面
 *
 *   梯度 ∇F = (-∂f/∂x,  -∂f/∂y,  1)
 *
 *   法向量 = ∇F / |∇F|   (归一化)
 *
 *   切平面方程:
 *     z = f(x₀,y₀) + ∂f/∂x·(x - x₀) + ∂f/∂y·(y - y₀)
 *
 * @param surfaceNode  z = f(x,y) 的表达式树(mathjs MathNode)
 * @param x0           点 P 的 x 坐标
 * @param y0           点 P 的 y 坐标
 * @returns GradientResult 包含偏导数,法向量,切平面表达式
 */
export function computeGradient(
    surfaceNode: MathNode,
    x0: number,
    y0: number,
    extraScope?: Record<string, number>
): GradientResult {
    // performance.mark('gradient-core-start');
    let entry = compiledCache.get(surfaceNode);

    if (!entry) {
        // 对偏导做化简,缩小表达式树
        const fxNode = math.simplify(math.derivative(surfaceNode, 'x'));
        const fyNode = math.simplify(math.derivative(surfaceNode, 'y'));
        entry = {
            surface: surfaceNode.compile(),
            fx: fxNode.compile(),
            fy: fyNode.compile(),
        };
        compiledCache.set(surfaceNode, entry);
    }

    const scope: Record<string, number> = { x: x0, y: y0, ...(extraScope ?? {}) };

    const f0 = entry.surface.evaluate(scope) as number;
    const fx = entry.fx.evaluate(scope) as number;
    const fy = entry.fy.evaluate(scope) as number;

    // 法向量
    const nx = -fx, ny = -fy, nz = 1;
    const norm = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const normalDirection: [number, number, number] =
        norm < 1e-12 ? [0, 0, 1] : [nx / norm, ny / norm, nz / norm];
    // 切平面:用 mathjs API 构建,避免 string → parse
    const constantPart = f0 - fx * x0 - fy * y0;
    const tangentPlaneNode = new math.OperatorNode('+', 'add', [
        new math.ConstantNode(constantPart),
        new math.OperatorNode('*', 'multiply', [
            new math.ConstantNode(fx),
            new math.SymbolNode('x'),
        ]),
        new math.OperatorNode('*', 'multiply', [
            new math.ConstantNode(fy),
            new math.SymbolNode('y'),
        ]),
    ]);
    // performance.mark('gradient-core-end');
    // performance.measure('-gradient-core', 'gradient-core-start', 'gradient-core-end');
    return { fx, fy, f0, normalDirection, tangentPlaneNode };
}