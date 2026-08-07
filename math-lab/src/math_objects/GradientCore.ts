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

// 模块级缓存
let cachedExpr = '';
let surfaceCompiled: EvalFunction | null = null;
let fxCompiled: EvalFunction | null = null;
let fyCompiled: EvalFunction | null = null;

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
    const exprStr = surfaceNode.toString();

    if (exprStr !== cachedExpr) {
        // 符号求导 + 编译
        fxCompiled = math.derivative(surfaceNode, 'x').compile();
        fyCompiled = math.derivative(surfaceNode, 'y').compile();
        surfaceCompiled = surfaceNode.compile();
        cachedExpr = exprStr;
    }

    const scope: Record<string, number> = { x: x0, y: y0, ...(extraScope ?? {}) };

    const f0 = surfaceCompiled!.evaluate(scope) as number;
    const fx = fxCompiled!.evaluate(scope) as number;
    const fy = fyCompiled!.evaluate(scope) as number;

    // 法向量
    const nx = -fx, ny = -fy, nz = 1;
    const norm = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const normalDirection: [number, number, number] =
        norm < 1e-12 ? [0, 0, 1] : [nx / norm, ny / norm, nz / norm];

    // 切平面:只在 pin 时需要,这里懒构建
    // 但为了接口兼容,仍返回 node(后续可优化掉)
    const constantPart = f0 - fx * x0 - fy * y0;
    const tangentPlaneNode = math.parse(
        `(${constantPart}) + (${fx}) * x + (${fy}) * y`
    );

    return { fx, fy, f0, normalDirection, tangentPlaneNode };
}