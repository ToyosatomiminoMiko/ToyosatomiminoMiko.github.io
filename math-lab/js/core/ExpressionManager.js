import { APP_CONFIG } from '../config/appConfig.js';

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

    /**
     * 添加一个新表达式
     * @param {string} type  - '2d' 或 '3d'
     * @param {string} fnStr - 表达式字符串 (如 "Math.sin(x)")
     * @param {string} color - 十六进制颜色 (可选, 缺省自动分配)
     * @returns {object} 新创建的表达式对象
     */
    add(type, fnStr, color) {
        const expr = {
            id: this.nextId++,
            type: type,          // '2d' | '3d'
            fnStr: fnStr.trim(), // 原始字符串, 用于 UI 显示
            color: color || this.colorManager.next(),
            enabled: true,       // 是否可见
            fn: this.compile(fnStr, type), // 编译后的可调用函数
        };
        this.expressions.push(expr);
        return expr;
    }

    /**
     * 将表达式字符串编译为可执行的 JS 函数
     * - 2D 函数签名: fn(x) -> y
     * - 3D 函数签名: fn(x, y) -> z
     * 使用 new Function() 动态编译, 比 eval() 更安全且性能更好
     * @param {string} fnStr  - 原始表达式字符串
     * @param {string} type   - '2d' 或 '3d'
     * @returns {Function} 编译后的函数 (编译失败时返回占位函数)
     * ⚠️ XSS 漏洞
     */
    compile(fnStr, type) {
        try {
            if (type === '2d') {
                // 2D: 一元函数 y = f(x)
                return new Function('x', `"use strict"; return (${fnStr});`);
            } else {
                // 3D: 二元函数 z = f(x, y)
                return new Function('x', 'y', `"use strict"; return (${fnStr});`);
            }
        } catch (e) {
            console.warn('[ExpressionManager] 编译失败:', fnStr, e);
            // 编译失败时返回零函数, 避免整个应用崩溃
            return type === '2d' ? (x) => 0 : (x, y) => 0;
        }
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
    updateFn(id, newFnStr) {
        const expr = this.expressions.find(e => e.id === id);
        if (expr) {
            expr.fnStr = newFnStr.trim();
            expr.fn = this.compile(expr.fnStr, expr.type);
            return true;
        }
        return false;
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