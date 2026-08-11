import { parse, type MathNode } from 'mathjs';
import type { Coefficient } from './types';

/**
 * 从单个 MathNode 中提取所有自由变量的名称(排除 x, y, z 和数字常量)
 */
function extractCoefficientsFromNode(node: MathNode): string[] {
    const names = new Set<string>();

    function traverse(n: MathNode) {
        if (n.type === 'SymbolNode') {
            const name = (n as any).name as string;
            if (!['x', 'y', 'z'].includes(name) && !isBuiltInConstant(name)) {
                names.add(name);
            }
        }
        // 递归遍历子节点(OperatorNode / FunctionNode 等有 args)
        const children = (n as any).args as MathNode[] | undefined;
        children?.forEach(traverse);
    }

    traverse(node);
    return Array.from(names);
}

/**
 * 判断是否为 Math.js 内置常量或函数名(可根据需要扩充)
 */
function isBuiltInConstant(name: string): boolean {
    const builtIns = new Set([
        'pi', 'PI', 'e', 'E', 'true', 'false', 'null',
        'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
        'sinh', 'cosh', 'tanh', 'exp', 'log', 'log10',
        'sqrt', 'abs', 'ceil', 'floor', 'round',
    ]);
    return builtIns.has(name);
}

/**
 * 合并三个分量表达式中提取的系数,去重并生成 Coefficient 对象
 * 默认值为 0,取值范围 [-10, 10],步长 0.1
 */
function mergeCoefficients(
    namesP: string[],
    namesQ: string[],
    namesR: string[]
): Coefficient[] {
    const combined = new Map<string, Coefficient>();
    const allNames = new Set([...namesP, ...namesQ, ...namesR]);

    for (const name of allNames) {
        combined.set(name, {
            name,
            value: 0,
            min: -10,
            max: 10,
            step: 0.1,
        });
    }

    return Array.from(combined.values());
}

/**
 * 解析向量场三个分量表达式字符串
 * 返回编译后的 MathNode 和提取出的系数列表
 */
export function parseVectorField(components: [string, string, string]): {
    nodeP: MathNode;
    nodeQ: MathNode;
    nodeR: MathNode;
    coefficients: Coefficient[];
} {
    const [pStr, qStr, rStr] = components;

    // 解析表达式为 MathNode
    const nodeP = parse(pStr);
    const nodeQ = parse(qStr);
    const nodeR = parse(rStr);

    // 分别提取系数
    const namesP = extractCoefficientsFromNode(nodeP);
    const namesQ = extractCoefficientsFromNode(nodeQ);
    const namesR = extractCoefficientsFromNode(nodeR);

    // 合并去重
    const coefficients = mergeCoefficients(namesP, namesQ, namesR);

    return { nodeP, nodeQ, nodeR, coefficients };
}

/**
 * 在三维网格上采样向量场
 * @param nodes - 包含 P, Q, R 三个 MathNode 的对象
 * @param coefficients - 系数数组(当前值将作为 scope 传入)
 * @param range - 每个轴的范围 [min, max]
 * @param gridSize - 每个轴的采样点数 [nx, ny, nz]
 * @returns Float32Array,长度为 nx*ny*nz*3,存储顺序为 [vx, vy, vz, vx, vy, vz, ...]
 */
export function sampleVectorField(
    nodes: { P: MathNode; Q: MathNode; R: MathNode },
    coefficients: Coefficient[],
    range: { x: [number, number]; y: [number, number]; z: [number, number] },
    gridSize: [number, number, number],
): Float32Array {
    const [nx, ny, nz] = gridSize;
    const [xMin, xMax] = range.x;
    const [yMin, yMax] = range.y;
    const [zMin, zMax] = range.z;

    // 预计算步长
    const stepX = (xMax - xMin) / (nx - 1);
    const stepY = (yMax - yMin) / (ny - 1);
    const stepZ = (zMax - zMin) / (nz - 1);

    const totalPoints = nx * ny * nz;
    const result = new Float32Array(totalPoints * 3);

    // 构建系数 scope(所有系数作为键值对)
    const coeffScope: Record<string, number> = {};
    for (const c of coefficients) {
        coeffScope[c.name] = c.value;
    }

    // 使用 mathjs 的 evaluate 方法,需要传入一个包含所有变量的 scope
    // 为了避免每次新建对象,我们可以重用 scope 并更新 x,y,z
    const scope = { ...coeffScope };

    let idx = 0;
    for (let iz = 0; iz < nz; iz++) {
        const z = zMin + iz * stepZ;
        scope.z = z;
        for (let iy = 0; iy < ny; iy++) {
            const y = yMin + iy * stepY;
            scope.y = y;
            for (let ix = 0; ix < nx; ix++) {
                const x = xMin + ix * stepX;
                scope.x = x;

                // 计算三个分量值
                const vx = nodes.P.evaluate(scope);
                const vy = nodes.Q.evaluate(scope);
                const vz = nodes.R.evaluate(scope);

                result[idx++] = vx;
                result[idx++] = vy;
                result[idx++] = vz;
            }
        }
    }

    return result;
}