import { APP_CONFIG } from '../config/appConfig.js';
import * as math from 'mathjs';
import { differentiate } from '../derivative/DerivativeCore.js';

/**
 * ============================================================
 * 表达式管理器
 * 功能: 管理所有数学表达式的增/删/改/查,原生js表示
 * 数据结构: {
 *     id:      number   -- 唯一标识
 *     type:    '2d'|'3d' -- 维度类型
 *     fnStr:   string   -- 原始表达式字符串 (如 "Math.sin(x)")
 *     color:   string   -- 十六进制颜色
 *     enabled: boolean  -- 可见性开关
 * }
 * ============================================================
 */
export class ExpressionManager {
    constructor(colorManager) {
        this.colorManager = colorManager;
        // 表达式列表, 存储所有表达式对象
        this.expressions = [];
        // 自增 ID 计数器, 确保每个表达式有唯一 id
        this.nextId = 1;
        // 初始化预置示例表达式
        this.addDefaultExpressions();
    }

    /**
     * 添加预置表达式: 2个 2D 示例 + 2个 3D 示例
     * 用户首次打开页面时即可看到图形
     */
    addDefaultExpressions() {
        // 从配置中读取预置表达式，使用 ColorManager 分配颜色
        const defaults = APP_CONFIG.defaultExpressions;
        defaults['2d'].forEach(item => {
            this.add('2d', item.fn, this.colorManager.next());
        });
        defaults['3d'].forEach(item => {
            this.add('3d', item.fn, this.colorManager.next());
        });
    }

    parse(raw, type) {
        const node = math.parse(raw);
        const coefficients = this._extractCoefficients(node, type);
        return { node, coefficients };
    }

    /**
     * 添加一个新表达式
     * @param {string} type  - '2d' 或 '3d'
     * @param {string} color - 十六进制颜色
     * @returns {object} 新创建的表达式对象
     */
    add(type, raw, color) {
        const { node, coefficients } = this.parse(raw, type);
        const expr = {
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

    // 提取系数
    _extractCoefficients(node, type) {
        const vars = new Set(type === '2d' ? ['x'] : ['x', 'y']);
        const builtins = new Set([
            'sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'abs',
            'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
            'floor', 'ceil', 'round', 'sign', 'pow', 'max', 'min',
            'PI', 'E', 'i', 'Infinity', 'NaN',
        ]);
        const coeffSet = new Set();

        node.traverse((n) => {
            if (n.isSymbolNode && !vars.has(n.name) && !builtins.has(n.name)) {
                coeffSet.add(n.name);
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
    // 更新某个系数的值
    setCoefficient(id, coeffName, newValue) {
        const expr = this.expressions.find(e => e.id === id);
        if (!expr) return false;
        const coeff = expr.coefficients.find(c => c.name === coeffName);
        if (coeff) {
            coeff.value = parseFloat(newValue);
            return true;
        }
        return false;
    }
    /**
     * 按 id 删除表达式
     * @param {number} id
     * @returns {boolean} 是否成功删除
     */
    remove(id) {
        const idx = this.expressions.findIndex(e => e.id === id);
        if (idx !== -1) {
            this.expressions.splice(idx, 1);
            return true;
        }
        return false;
    }

    /**
     * 切换表达式的可见性 (enabled <-> disabled)
     * @param {number} id
     * @returns {boolean} 切换后的 enabled 状态
     */
    toggle(id) {
        const expr = this.expressions.find(e => e.id === id);
        if (expr) {
            expr.enabled = !expr.enabled;
            return expr.enabled;
        }
        return false;
    }

    /**
     * 按类型获取所有已启用的表达式
     * @param {string} type - '2d' 或 '3d'
     * @returns {Array} 启用中的表达式列表
     */
    getByType(type) {
        return this.expressions.filter(e => e.type === type && e.enabled);
    }

    /** 获取全部表达式 (包括禁用中的) */
    getAll() {
        return this.expressions;
    }

    /**
     * 更新表达式的函数字符串 (自动重新编译)
     * @param {number} id
     * @param {string} newFnStr - 新的表达式字符串
     * @returns {boolean} 是否成功更新
     */
    updateFn(id, newRaw) {
        const expr = this.expressions.find(e => e.id === id);
        if (!expr) return false;
        try {
            const { node, coefficients } = this.parse(newRaw, expr.type);
            expr.node = node;
            expr.coefficients = coefficients;
            expr.derivative = null;   // 导数失效
            return true;
        } catch (e) {
            throw new Error(`表达式编辑失败: ${e.message}`);
        }
    }

    /**
     * 对已有表达式求导,生成新表达式并加入列表
     * @param {number} id       - 源表达式 id
     * @param {string} variable - 求导变量 'x' 或 'y'
     * @returns {object} 导函数表达式对象
     */
    deriveExpr(id, variable) {
        const source = this.expressions.find(e => e.id === id);
        if (!source) throw new Error('源表达式不存在');

        // 核心:符号求导
        const derivNode = differentiate(source.node, variable);

        // 自动探测新表达式的系数
        const coefficients = this._extractCoefficients(derivNode, source.type);

        const expr = {
            id: this.nextId++,
            type: source.type,
            node: derivNode,
            coefficients,
            color: this.colorManager.next(),
            enabled: true,
            derivative: null,   // 保留占位，为将来可能的二阶导数做准备
        };
        this.expressions.push(expr);
        return expr;
    }

    /**
     * 更新表达式的颜色
     * @param {number} id
     * @param {string} newColor - 新的十六进制颜色
     * @returns {boolean} 是否成功更新
     */
    updateColor(id, newColor) {
        const expr = this.expressions.find(e => e.id === id);
        if (expr) {
            expr.color = newColor;
            return true;
        }
        return false;
    }
}