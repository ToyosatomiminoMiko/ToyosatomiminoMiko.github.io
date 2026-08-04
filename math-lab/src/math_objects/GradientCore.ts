import * as math from 'mathjs';
import type { MathNode } from 'mathjs';

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
    /** 切平面表达式树，可直接用于添加 3D 曲面 */
    tangentPlaneNode: MathNode;
}

/**
 * 对二元函数 z = f(x, y) 在点 (x₀, y₀) 处计算梯度,法向量和切平面
 *
 * 数学原理:
 *   定义 F(x,y,z) = z - f(x,y)  ->  曲面是 F=0 的等值面
 *
 *   梯度 ∇F = (-∂f/∂x,  -∂f/∂y,  1)
 *
 *   法向量 = ∇F / |∇F|   （归一化）
 *
 *   切平面方程:
 *     z = f(x₀,y₀) + ∂f/∂x·(x - x₀) + ∂f/∂y·(y - y₀)
 *
 * @param surfaceNode  z = f(x,y) 的表达式树（mathjs MathNode）
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
    // ---------- 1. 符号求偏导 ----------
    const fxNode = math.derivative(surfaceNode, 'x');
    const fyNode = math.derivative(surfaceNode, 'y');

    // ---------- 2. 数值评估 ----------
    const scope: Record<string, number> = { x: x0, y: y0, ...(extraScope ?? {}) };

    const f0 = surfaceNode.evaluate(scope) as number;
    const fx = fxNode.evaluate(scope) as number;
    const fy = fyNode.evaluate(scope) as number;

    // ---------- 3. 法向量 ----------
    // ∇F = (-∂f/∂x, -∂f/∂y, 1)
    const nx = -fx;
    const ny = -fy;
    const nz = 1;

    const norm = Math.sqrt(nx * nx + ny * ny + nz * nz);

    let normalDirection: [number, number, number];
    if (norm < 1e-12) {
        // 退化情况:法向量为零（如常数函数），用默认方向
        normalDirection = [0, 0, 1];
    } else {
        normalDirection = [nx / norm, ny / norm, nz / norm];
    }

    // ---------- 4. 切平面表达式 ----------
    // z = f0 + fx*(x - x0) + fy*(y - y0)
    // 展开为: (f0 - fx*x0 - fy*y0) + fx*x + fy*y
    const constantPart = f0 - fx * x0 - fy * y0;

    // 用 math.parse 构建表达式树
    // 格式: (constantPart) + (fx)*x + (fy)*y
    const tangentStr =
        `(${constantPart}) + (${fx}) * x + (${fy}) * y`;
    const tangentPlaneNode = math.parse(tangentStr);

    return {
        fx,
        fy,
        f0,
        normalDirection,
        tangentPlaneNode,
    };
}