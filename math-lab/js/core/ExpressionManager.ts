// math-lab/js/core/ExpressionManager.ts
import * as math from 'mathjs';
import type { MathNode } from 'mathjs';
import { APP_CONFIG } from '../config/appConfig';
import type { Expression, Coefficient } from '../types';
import type { ColorManager } from '../config/appConfig';
import { differentiate } from '../derivative/DerivativeCore';

/**
 * ============================================================
 * 表达式管理器
 * 功能: 管理所有数学表达式的增/删/改/查
 * ============================================================
 */
export class ExpressionManager {
    colorManager: ColorManager;
    /** 表达式列表，存储所有表达式对象 */
    expressions: Expression[];
    /** 自增 ID 计数器 */
    nextId: number;

    constructor(colorManager: ColorManager) {
        this.colorManager = colorManager;
        this.expressions = [];
        this.nextId = 1;
        // 初始化预置示例表达式
        this.addDefaultExpressions();
    }

    /**
     * 添加预置表达式: 2 个 2D 示例 + 2 个 3D 示例
     * 用户首次打开页面时即可看到图形
     */
    addDefaultExpressions(): void {
        const defaults = APP_CONFIG.defaultExpressions;
        defaults['2d'].forEach(item => {
            this.add('2d', item.fn, this.colorManager.next());
        });
        defaults['3d'].forEach(item => {
            this.add('3d', item.fn, this.colorManager.next());
        });
    }

    /**
     * 解析表达式字符串，提取节点和系数
     */
    parse(
        raw: string,
        type: '2d' | '3d',
    ): { node: MathNode; coefficients: Coefficient[] } {
        const node = math.parse(raw);
        const coefficients = this._extractCoefficients(node, type);
        return { node, coefficients };
    }

    /**
     * 添加一个新表达式
     * @param type  - '2d' 或 '3d'
     * @param raw   - 原始表达式字符串
     * @param color - 十六进制颜色（可选）
     * @returns 新创建的表达式对象
     */
    add(type: '2d' | '3d', raw: string, color?: string): Expression {
        const { node, coefficients } = this.parse(raw, type);
        const expr: Expression = {
            id: this.nextId++,
            type,
            node,
            coefficients,
            color: color || this.colorManager.next(),
            enabled: true,
            derivative: null,
        };
        this.expressions.push(expr);
        return expr;
    }

    /**
     * 按 id 获取表达式
     */
    getById(id: number): Expression | undefined {
        return this.expressions.find(e => e.id === id);
    }

    /**
     * 按 id 删除表达式
     * @returns 是否成功删除
     */
    remove(id: number): boolean {
        const idx = this.expressions.findIndex(e => e.id === id);
        if (idx !== -1) {
            this.expressions.splice(idx, 1);
            return true;
        }
        return false;
    }

    /**
     * 切换表达式的可见性
     * @returns 切换后的 enabled 状态
     */
    toggle(id: number): boolean {
        const expr = this.expressions.find(e => e.id === id);
        if (expr) {
            expr.enabled = !expr.enabled;
            return expr.enabled;
        }
        return false;
    }

    /**
     * 按类型获取所有已启用的表达式
     */
    getByType(type: '2d' | '3d'): Expression[] {
        return this.expressions.filter(e => e.type === type && e.enabled);
    }

    /** 获取全部表达式（包括禁用中的） */
    getAll(): Expression[] {
        return this.expressions;
    }

    /**
     * 更新表达式的函数字符串（自动重新编译）
     * @param id       - 表达式 id
     * @param newRaw   - 新的表达式字符串
     * @returns 是否成功更新
     */
    updateFn(id: number, newRaw: string): boolean {
        const expr = this.expressions.find(e => e.id === id);
        if (!expr) return false;
        try {
            const { node, coefficients } = this.parse(newRaw, expr.type);
            expr.node = node;
            expr.coefficients = coefficients;
            expr.derivative = null;   // 导数失效
            return true;
        } catch (e) {
            throw new Error(`表达式编辑失败: ${(e as Error).message}`);
        }
    }

    /**
     * 更新某个系数的值
     * @returns 是否成功更新
     */
    setCoefficient(id: number, coeffName: string, newValue: number): boolean {
        const expr = this.expressions.find(e => e.id === id);
        if (!expr) return false;
        const coeff = expr.coefficients.find(c => c.name === coeffName);
        if (coeff) {
            coeff.value = newValue;
            return true;
        }
        return false;
    }

    /**
     * 对已有表达式求导，生成新表达式并加入列表
     * @param id       - 源表达式 id
     * @param variable - 求导变量 'x' 或 'y'
     * @returns 导函数表达式对象
     */
    deriveExpr(id: number, variable: 'x' | 'y'): Expression {
        const source = this.expressions.find(e => e.id === id);
        if (!source) throw new Error('源表达式不存在');

        // 核心：符号求导
        const derivNode = differentiate(source.node, variable);

        // 自动探测新表达式的系数
        const coefficients = this._extractCoefficients(derivNode, source.type);

        const expr: Expression = {
            id: this.nextId++,
            type: source.type,
            node: derivNode,
            coefficients,
            color: this.colorManager.next(),
            enabled: true,
            derivative: null,
        };
        this.expressions.push(expr);
        return expr;
    }

    /**
     * 更新表达式的颜色
     * @returns 是否成功更新
     */
    updateColor(id: number, newColor: string): boolean {
        const expr = this.expressions.find(e => e.id === id);
        if (expr) {
            expr.color = newColor;
            return true;
        }
        return false;
    }

    // =====================================================
    //  内部方法
    // =====================================================

    /**
     * 从表达式树中提取用户自定义系数（排除 x/y 变量和内置函数名）
     */
    private _extractCoefficients(
        node: MathNode,
        type: '2d' | '3d',
    ): Coefficient[] {
        const vars = new Set<string>(type === '2d' ? ['x'] : ['x', 'y']);
        const builtins = new Set([
            'sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'abs',
            'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
            'floor', 'ceil', 'round', 'sign', 'pow', 'max', 'min',
            'PI', 'E', 'i', 'Infinity', 'NaN',
        ]);
        const coeffSet = new Set<string>();

        node.traverse((n: MathNode) => {
            // instanceof 同时完成运行时检查 + TS 类型收窄
            if (n instanceof math.SymbolNode) {
                if (!vars.has(n.name) && !builtins.has(n.name)) {
                    coeffSet.add(n.name);
                }
            }
        });

        return [...coeffSet].map(name => ({
            name,
            value: 1,
            min: -10,
            max: 10,
            step: 0.1,
        }));
    }
}