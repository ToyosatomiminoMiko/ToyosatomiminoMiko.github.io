import { EventBus } from '../service/EventBus';
import type { MathLabEvents, Expression } from '../types';
import type { ExpressionManager } from '../core/ExpressionManager';
import type { SelectionManager } from '../core/SelectionManager';
import type { IntegralVisualizer } from '../integration/IntegralVisualizer';
import { GradientVisualizer } from '../vector-field/GradientVisualizer';
import {
    riemann1dLeft,
    riemann2dLeft,
    lebesgue1d,
    lebesgue2d,
} from '../integration/IntegralCore';
import { computeGradient } from '../vector-field/GradientCore';

type IntegralMethod = 'riemann' | 'lebesgue';

/**
 * DetailPanel — 详情面板
 *
 * 标签页：
 *   📝 编辑   — 表达式输入框 + 🔄更新 + 颜色 + 系数滑块
 *   📐 求导   — d/dx / ∂/∂x / ∂/∂y 按钮
 *   📊 积分   — 方法选择 + 区间 + 分段 + 计算（迁移自 IntegralPanel）
 *   📐 梯度   — 状态提示 + 计算梯度按钮
 *
 * 根据选中实体类型动态显示 / 隐藏标签页
 */
export class DetailPanel {
    private _eventBus: EventBus<MathLabEvents>;
    private _exprManager: ExpressionManager;
    private _selectionManager: SelectionManager;
    private _integralVisualizer: IntegralVisualizer;
    private _gradientVisualizer: GradientVisualizer;

    // DOM
    private _tabContainer: HTMLElement;
    private _contentContainer: HTMLElement;
    private _tabs: NodeListOf<HTMLElement>;
    private _activeTab: string;

    // 积分状态
    private _integralMethod: IntegralMethod = 'riemann';
    // 梯度滑块状态
    private _gradientTimer: ReturnType<typeof setTimeout> | null = null;
    private _gradientPinned = false; // 是否已固定

    constructor(
        eventBus: EventBus<MathLabEvents>,
        exprManager: ExpressionManager,
        selectionManager: SelectionManager,
        integralVisualizer: IntegralVisualizer,
        gradientVisualizer: GradientVisualizer,
    ) {
        this._eventBus = eventBus;
        this._exprManager = exprManager;
        this._selectionManager = selectionManager;
        this._integralVisualizer = integralVisualizer;
        this._gradientVisualizer = gradientVisualizer;

        this._tabContainer = document.getElementById('detailTabs')!;
        this._contentContainer = document.getElementById('detailContent')!;
        this._tabs = this._tabContainer.querySelectorAll('.detail-tab');
        this._activeTab = 'edit';

        // 标签页切换
        this._tabContainer.addEventListener('click', (e: Event) => {
            const btn = (e.target as HTMLElement).closest('.detail-tab') as HTMLElement | null;
            if (!btn) return;
            const tab = btn.dataset.tab!;
            this._switchTab(tab);
        });

        // 选中变化 -> 刷新内容 + 控制标签显隐
        this._eventBus.on('selection:changed', () => this._onSelectionChanged());

        // 数据变更 -> 刷新当前面板
        this._eventBus.on('expr:added', () => this._refreshContent());
        this._eventBus.on('expr:removed', () => this._refreshContent());
        this._eventBus.on('expr:updated', () => this._refreshContent());

        // 初始渲染
        this._onSelectionChanged();
    }

    // ============================================================
    //  标签页管理
    // ============================================================

    private _switchTab(tab: string): void {
        this._activeTab = tab;
        this._tabs.forEach(t => {
            t.classList.toggle('active', (t as HTMLElement).dataset.tab === tab);
        });
        this._refreshContent();
    }

    /**
     * 根据选中类型控制标签页显隐
     */
    private _onSelectionChanged(): void {
        const selected = this._selectionManager.getSelected();
        const type = selected?.type ?? null;

        this._tabs.forEach(tab => {
            const tabName = (tab as HTMLElement).dataset.tab!;
            const visible = this._isTabVisible(tabName, type);
            (tab as HTMLElement).style.display = visible ? '' : 'none';
        });

        // 如果当前激活的标签页不可见，切到第一个可见的
        const activeEl = this._tabContainer.querySelector(
            `.detail-tab[data-tab="${this._activeTab}"]`,
        ) as HTMLElement | null;
        if (!activeEl || activeEl.style.display === 'none') {
            const firstVisible = this._tabContainer.querySelector(
                '.detail-tab:not([style*="display: none"])',
            ) as HTMLElement | null;
            if (firstVisible) {
                this._switchTab(firstVisible.dataset.tab!);
                return;
            }
        }

        // 清理积分可视化（切换选中时）
        this._integralVisualizer.clearAll();
        this._gradientVisualizer.clear();
        this._refreshContent();
    }

    /**
     * 标签页显隐规则
     */
    private _isTabVisible(tab: string, type: string | null): boolean {
        if (!type) return tab === 'edit'; // 无选中时只显示编辑（占位）

        switch (tab) {
            case 'edit': return true;
            case 'derivative': return type === '2d' || type === '3d';
            case 'integral': return type === '2d' || type === '3d';
            case 'gradient': return type === '3d';
            default: return false;
        }
    }

    // ============================================================
    //  内容刷新
    // ============================================================

    private _refreshContent(): void {
        const selected = this._selectionManager.getSelected();
        if (!selected) {
            this._contentContainer.innerHTML =
                '<div class="detail-hint">请选择一个实体以编辑或分析</div>';
            return;
        }

        const expr = this._exprManager.getById(selected.id);
        if (!expr) {
            this._contentContainer.innerHTML =
                '<div class="detail-hint">实体已被删除</div>';
            return;
        }

        switch (this._activeTab) {
            case 'edit': this._renderEdit(expr); break;
            case 'derivative': this._renderDerivative(expr); break;
            case 'integral': this._renderIntegral(expr); break;
            case 'gradient': this._renderGradient(expr); break;
        }
    }

    // ============================================================
    //  编辑标签页
    // ============================================================
    private _renderEdit(expr: Expression): void {
        let html = '';

        // 2d / 3d：表达式编辑框 + 更新按钮 + 颜色
        if (expr.type === '2d' || expr.type === '3d') {
            html += `
                <div class="edit-row">
                    <input type="text" class="edit-input"
                           value="${this._escapeHtml(expr.node.toString())}"
                           spellcheck="false" id="detailEditInput" />
                    <button class="update-btn" id="detailUpdateBtn">🔄</button>
                </div>
                <div class="color-row" style="margin-top:8px;">
                    <label>颜色</label>
                    <input type="color" class="color-input"
                           value="${expr.color}" id="detailColorInput" />
                </div>`;
        }

        // point / vector：直接跳到系数滑块，无表达式输入框

        // 系数滑块（所有类型都可能有）
        if (expr.coefficients.length > 0) {
            html += '<div class="coeff-sliders">';
            for (const c of expr.coefficients) {
                html += `
                    <div class="coeff-row">
                        <label>${c.name}</label>
                        <input type="range" min="${c.min}" max="${c.max}"
                               step="${c.step}" value="${c.value}"
                               data-coeff="${c.name}"
                               class="coeff-slider" />
                        <input type="number" class="coeff-value"
                               value="${c.value.toFixed(2)}"
                               step="${c.step}" min="${c.min}" max="${c.max}"
                               data-coeff="${c.name}" />
                    </div>`;
            }
            html += '</div>';
        }

        this._contentContainer.innerHTML = html;

        // 绑定事件
        this._bindEditEvents(expr);
    }

    private _bindEditEvents(expr: Expression): void {
        // 更新按钮
        const updateBtn = this._contentContainer.querySelector<HTMLElement>('#detailUpdateBtn');
        const editInput = this._contentContainer.querySelector<HTMLInputElement>('#detailEditInput');
        updateBtn?.addEventListener('click', () => {
            const newRaw = editInput?.value.trim();
            if (!newRaw) return;
            try {
                this._exprManager.updateFn(expr.id, newRaw);
                this._eventBus.emit('expr:updated', { id: expr.id, fnStr: newRaw });
            } catch (err) {
                alert((err as Error).message);
            }
        });

        // 回车更新
        editInput?.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') updateBtn?.click();
        });

        // 颜色
        const colorInput = this._contentContainer.querySelector('#detailColorInput') as HTMLInputElement | null;
        colorInput?.addEventListener('input', () => {
            this._exprManager.updateColor(expr.id, colorInput.value);
            this._eventBus.emit('expr:updated', { id: expr.id, fnStr: '' });
        });

        // 系数滑块
        this._contentContainer.querySelectorAll('.coeff-row').forEach(row => {
            const slider = row.querySelector('.coeff-slider') as HTMLInputElement | null;
            const numInput = row.querySelector('.coeff-value') as HTMLInputElement | null;
            if (!slider || !numInput) return;

            slider.addEventListener('input', () => {
                const val = parseFloat(slider.value);
                numInput.value = val.toFixed(2);
                const coeffName = slider.dataset.coeff!;
                this._exprManager.setCoefficient(expr.id, coeffName, val);
                this._debouncedEmitCoefficient(expr.id);
            });

            numInput.addEventListener('input', () => {
                let val = parseFloat(numInput.value);
                if (isNaN(val)) return;
                val = Math.max(
                    parseFloat(slider.min),
                    Math.min(parseFloat(slider.max), val),
                );
                slider.value = String(val);
                const coeffName = numInput.dataset.coeff!;
                this._exprManager.setCoefficient(expr.id, coeffName, val);
                this._debouncedEmitCoefficient(expr.id);
            });
        });
    }

    private _coeffDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private _debouncedEmitCoefficient(id: number): void {
        if (this._coeffDebounceTimer) clearTimeout(this._coeffDebounceTimer);
        this._coeffDebounceTimer = setTimeout(() => {
            this._eventBus.emit('coefficient:changed', { id });
        }, 50);
    }

    // ============================================================
    //  求导标签页
    // ============================================================
    private _renderDerivative(expr: Expression): void {
        let html = '<div class="deriv-row">';
        if (expr.type === '2d') {
            html += `
                <span class="deriv-label">导</span>
                <button class="deriv-btn" id="derivBtnX">d/dx</button>`;
        } else {
            html += `
                <span class="deriv-label">偏导</span>
                <button class="deriv-btn" id="derivBtnX">∂/∂x</button>
                <button class="deriv-btn" id="derivBtnY">∂/∂y</button>`;
        }
        html += '</div>';
        this._contentContainer.innerHTML = html;

        document.getElementById('derivBtnX')?.addEventListener('click', () => {
            this._doDerivative(expr.id, 'x');
        });
        document.getElementById('derivBtnY')?.addEventListener('click', () => {
            this._doDerivative(expr.id, 'y');
        });
    }

    private _doDerivative(id: number, variable: 'x' | 'y'): void {
        try {
            const derivExpr = this._exprManager.deriveExpr(id, variable);
            this._eventBus.emit('expr:added', { expr: derivExpr });
            // 自动选中新表达式
            this._selectionManager.select(derivExpr.id, derivExpr.type);
        } catch (err) {
            alert(`求导失败: ${(err as Error).message}`);
        }
    }

    // ============================================================
    //  积分标签页（迁移自 IntegralPanel，改为单表达式计算）
    // ============================================================
    private _renderIntegral(expr: Expression): void {
        const is2D = expr.type === '2d';

        let html = `
            <div class="integral-header">
                <span>📊 数值积分</span>
                <span>
                    <button class="method-btn ${this._integralMethod === 'riemann' ? 'active' : ''}"
                            data-method="riemann">黎曼</button>
                    <button class="method-btn ${this._integralMethod === 'lebesgue' ? 'active' : ''}"
                            data-method="lebesgue">勒贝格</button>
                </span>
            </div>
            <div class="integral-inputs">`;

        if (is2D) {
            html += `
                <div class="range-group">
                    <label>x ∈ [</label>
                    <input type="number" id="xMinInt" value="-4" step="0.1" />
                    <span> , </span>
                    <input type="number" id="xMaxInt" value="4" step="0.1" />
                    <span>]</span>
                </div>`;
        } else {
            html += `
                <div class="range-group">
                    <label>x ∈ [</label>
                    <input type="number" id="xMinInt" value="-3" step="0.1" />
                    <span> , </span>
                    <input type="number" id="xMaxInt" value="3" step="0.1" />
                    <span>] &nbsp; y ∈ [</span>
                    <input type="number" id="yMinInt" value="-3" step="0.1" />
                    <span> , </span>
                    <input type="number" id="yMaxInt" value="3" step="0.1" />
                    <span>]</span>
                </div>`;
        }

        html += `
                <div class="range-group">
                    <label>切分: </label>
                    <input type="number" id="segInt" value="32" min="4" max="256" step="1" />
                </div>
            </div>
            <div class="integral-actions">
                <button id="calcIntegralBtn">🧮 计算</button>
                <label class="integral-switch">
                    <input type="checkbox" id="showIntegralToggle" checked />
                    显示区域
                </label>
            </div>
            <div class="integral-result" id="singleIntegralResult"
                 style="margin-top:8px;color:#ffd93d;"></div>`;

        this._contentContainer.innerHTML = html;

        this._bindIntegralEvents(expr, is2D);
    }

    private _bindIntegralEvents(expr: Expression, is2D: boolean): void {
        // 方法切换
        this._contentContainer.querySelectorAll('.method-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const m = (btn as HTMLElement).dataset.method as IntegralMethod | undefined;
                if (m) this._integralMethod = m;
                this._refreshContent();
            });
        });

        // 显示/隐藏 toggle
        const showToggle = this._contentContainer.querySelector('#showIntegralToggle') as HTMLInputElement | null;
        showToggle?.addEventListener('change', () => {
            this._integralVisualizer.group.visible = showToggle?.checked ?? true;
        });

        // 计算按钮
        const calcBtn = this._contentContainer.querySelector('#calcIntegralBtn');
        calcBtn?.addEventListener('click', () => this._doIntegral(expr, is2D));
    }

    private _makeFn(expr: Expression): (x: number, y?: number) => number {
        const compiled = expr.node.compile();
        const scope: Record<string, number> = {};
        for (const c of expr.coefficients) scope[c.name] = c.value;

        if (expr.type === '2d') {
            return (x: number): number => {
                scope.x = x;
                return compiled.evaluate(scope);
            };
        } else {
            return (x: number, y?: number): number => {
                scope.x = x;
                if (y !== undefined) scope.y = y;
                return compiled.evaluate(scope);
            };
        }
    }

    private _doIntegral(expr: Expression, is2D: boolean): void {
        this._integralVisualizer.clearAll();
        const resultDiv = this._contentContainer.querySelector('#singleIntegralResult') as HTMLElement | null;

        try {
            let val: number;
            const fn = this._makeFn(expr);
            const segments = parseInt(
                (this._contentContainer.querySelector('#segInt') as HTMLInputElement)?.value || '32',
            );

            if (is2D) {
                const a = parseFloat(
                    (this._contentContainer.querySelector('#xMinInt') as HTMLInputElement)?.value || '-4',
                );
                const b = parseFloat(
                    (this._contentContainer.querySelector('#xMaxInt') as HTMLInputElement)?.value || '4',
                );
                if (a >= b) { alert('请输入有效区间 a < b'); return; }

                const sample2d = segments * 20;
                if (this._integralMethod === 'lebesgue') {
                    val = lebesgue1d(fn as (x: number) => number, a, b, segments, sample2d);
                    this._integralVisualizer.visualize2DLebesgue(expr, fn as (x: number) => number, a, b, segments, sample2d);
                } else {
                    val = riemann1dLeft(fn as (x: number) => number, a, b, segments);
                    this._integralVisualizer.visualize2DRiemann(expr, fn as (x: number) => number, a, b, segments);
                }
            } else {
                const xMin = parseFloat(
                    (this._contentContainer.querySelector('#xMinInt') as HTMLInputElement)?.value || '-3',
                );
                const xMax = parseFloat(
                    (this._contentContainer.querySelector('#xMaxInt') as HTMLInputElement)?.value || '3',
                );
                const yMin = parseFloat(
                    (this._contentContainer.querySelector('#yMinInt') as HTMLInputElement)?.value || '-3',
                );
                const yMax = parseFloat(
                    (this._contentContainer.querySelector('#yMaxInt') as HTMLInputElement)?.value || '3',
                );
                if (xMin >= xMax || yMin >= yMax) { alert('请输入有效区间'); return; }

                const res3d = segments;
                if (this._integralMethod === 'lebesgue') {
                    val = lebesgue2d(
                        fn as (x: number, y: number) => number,
                        [xMin, xMax], [yMin, yMax],
                        segments, res3d,
                    );
                    this._integralVisualizer.visualize3DLebesgue(
                        expr,
                        fn as (x: number, y: number) => number,
                        [xMin, xMax], [yMin, yMax],
                        res3d,
                    );
                } else {
                    val = riemann2dLeft(
                        fn as (x: number, y: number) => number,
                        [xMin, xMax], [yMin, yMax],
                        segments, segments,
                    );
                    this._integralVisualizer.visualize3DRiemann(
                        expr,
                        fn as (x: number, y: number) => number,
                        [xMin, xMax], [yMin, yMax],
                        segments, segments,
                    );
                }
            }

            if (resultDiv) {
                resultDiv.textContent = `积分结果: S = ${val.toFixed(6)}`;
            }

            // 更新列表中的积分显示
            this._eventBus.emit('integral:calculated', {
                results: [{ id: expr.id, value: val }],
                total: val,
            });
        } catch (e) {
            console.warn('[积分] 计算失败:', expr.node.toString(), e);
            if (resultDiv) resultDiv.textContent = '积分计算失败';
        }
    }

    // ============================================================
    //  梯度标签页（选中 3D 曲面时显示）
    //  滑块拖动 -> 实时预览标记点 + 法向量 + 切平面
    //  点击[固定]-> 持久化到场景
    // ============================================================
    private _renderGradient(expr: Expression): void {
        if (expr.type !== '3d') {
            this._contentContainer.innerHTML =
                '<div class="detail-hint">梯度计算仅适用于 3D 曲面</div>';
            return;
        }

        // 从表达式系数读取当前值
        const getCoeff = (name: string, fallback: number): number =>
            expr.coefficients.find(c => c.name === name)?.value ?? fallback;

        const x0 = getCoeff('x0', 0);
        const y0 = getCoeff('y0', 0);

        const html = `
            <div class="gradient-status" style="margin-bottom:6px;font-size:13px;color:#aac8ff;">
                曲面: <b>z = ${this._escapeHtml(expr.node.toString())}</b>
            </div>

            <div class="gradient-sliders">
                <div class="coeff-row">
                    <label>x₀</label>
                    <input type="range" id="gradX0Slider" min="-4" max="4" step="0.02"
                           value="${x0}" class="coeff-slider" />
                    <input type="number" id="gradX0Num" class="coeff-value"
                           value="${x0.toFixed(2)}" step="0.02" min="-4" max="4" />
                </div>
                <div class="coeff-row">
                    <label>y₀</label>
                    <input type="range" id="gradY0Slider" min="-4" max="4" step="0.02"
                           value="${y0}" class="coeff-slider" />
                    <input type="number" id="gradY0Num" class="coeff-value"
                           value="${y0.toFixed(2)}" step="0.02" min="-4" max="4" />
                </div>
            </div>

            <div id="gradResultInfo"
                 style="font-size:12px;color:#7a8bb5;margin:8px 0;min-height:48px;">
                拖动滑块以预览梯度
            </div>

            <div class="gradient-actions">
                <button id="gradPinBtn" class="deriv-btn">🎯 固定到场景</button>
                <button id="gradClearBtn" class="deriv-btn"
                        style="background:rgba(255,255,255,0.05);">🔄 清除预览</button>
            </div>`;

        this._contentContainer.innerHTML = html;
        this._gradientPinned = false;

        // 绑定滑块事件
        this._bindGradientSliders(expr);
        // 首次自动预览
        this._updateGradientPreview(expr, x0, y0);
    }

    // ---------- 滑块绑定 ----------
    private _bindGradientSliders(expr: Expression): void {
        const sliderX = this._contentContainer.querySelector('#gradX0Slider') as HTMLInputElement | null;
        const numX = this._contentContainer.querySelector('#gradX0Num') as HTMLInputElement | null;
        const sliderY = this._contentContainer.querySelector('#gradY0Slider') as HTMLInputElement | null;
        const numY = this._contentContainer.querySelector('#gradY0Num') as HTMLInputElement | null;
        const pinBtn = this._contentContainer.querySelector('#gradPinBtn') as HTMLButtonElement | null;
        const clearBtn = this._contentContainer.querySelector('#gradClearBtn') as HTMLButtonElement | null;

        const onInput = () => {
            const xVal = parseFloat(sliderX?.value ?? '0');
            const yVal = parseFloat(sliderY?.value ?? '0');
            if (numX) numX.value = xVal.toFixed(2);
            if (numY) numY.value = yVal.toFixed(2);

            // debounce 50ms
            if (this._gradientTimer) clearTimeout(this._gradientTimer);
            this._gradientTimer = setTimeout(() => {
                this._updateGradientPreview(expr, xVal, yVal);
            }, 50);
        };

        const onNumInput = () => {
            if (sliderX && numX) sliderX.value = numX.value;
            if (sliderY && numY) sliderY.value = numY.value;
            onInput();
        };

        sliderX?.addEventListener('input', onInput);
        sliderY?.addEventListener('input', onInput);
        numX?.addEventListener('input', onNumInput);
        numY?.addEventListener('input', onNumInput);

        // 固定按钮
        pinBtn?.addEventListener('click', () => {
            const xVal = parseFloat(sliderX?.value ?? '0');
            const yVal = parseFloat(sliderY?.value ?? '0');
            this._doGradientPersist(expr, xVal, yVal);
        });

        // 清除预览按钮
        clearBtn?.addEventListener('click', () => {
            this._gradientVisualizer.clear();
        });
    }

    // ---------- 实时预览 ----------
    private _updateGradientPreview(expr: Expression, x0: number, y0: number): void {
        try {
            // 构建带系数的 scope
            const scope: Record<string, number> = {};
            for (const c of expr.coefficients) {
                scope[c.name] = c.value;
            }

            const result = computeGradient(expr.node, x0, y0, scope);

            // 更新信息文字
            const infoDiv = this._contentContainer.querySelector('#gradResultInfo');
            if (infoDiv) {
                infoDiv.innerHTML = `
                    P = (${x0.toFixed(2)}, ${y0.toFixed(2)}, <b>${result.f0.toFixed(4)}</b>)<br/>
                    ∇f = ( ∂f/∂x = <b>${result.fx.toFixed(4)}</b>,
                           ∂f/∂y = <b>${result.fy.toFixed(4)}</b> )<br/>
                    ‖∇f‖ = <b>${Math.sqrt(result.fx * result.fx + result.fy * result.fy).toFixed(4)}</b>
                `;
            }

            // 更新场景预览
            this._gradientVisualizer.update(
                x0, y0, result.f0,
                result.fx, result.fy,
                result.normalDirection,
                expr.color,
            );
        } catch (err) {
            const infoDiv = this._contentContainer.querySelector('#gradResultInfo');
            if (infoDiv) {
                infoDiv.innerHTML = `<span style="color:#ff6b8a;">⚠️ ${(err as Error).message}</span>`;
            }
        }
    }

    // ---------- 🎯 固定到场景（原 _doGradient 逻辑，加入 scope 修复）----------
    private _doGradientPersist(expr: Expression, x0: number, y0: number): void {
        try {
            // 构建带系数的 scope
            const scope: Record<string, number> = {};
            for (const c of expr.coefficients) {
                scope[c.name] = c.value;
            }

            const result = computeGradient(expr.node, x0, y0, scope);

            // 1. 添加切平面表达式
            const tangentStr = result.tangentPlaneNode.toString();
            const tangentExpr = this._exprManager.add('3d', tangentStr);
            const planeColor = this._adjustColor(expr.color, 0.7);
            this._exprManager.updateColor(tangentExpr.id, planeColor);
            this._eventBus.emit('expr:added', { expr: tangentExpr });

            // 2. 添加法线箭头
            const [nx, ny, nz] = result.normalDirection;
            const arrowLength = 2;
            const arrowExpr = this._exprManager.addVector(
                nx * arrowLength,
                ny * arrowLength,
                nz * arrowLength,
                x0, y0, result.f0,
                '#ff6b8a',
            );
            this._eventBus.emit('expr:added', { expr: arrowExpr });

            // 3. 自动选中法线箭头
            this._selectionManager.select(arrowExpr.id, 'vector');

            this._gradientPinned = true;
        } catch (err) {
            alert(`梯度固定失败: ${(err as Error).message}`);
        }
    }

    /**
     * 调整颜色亮度（简单线性插值到白色，t 越小越白）
     */
    private _adjustColor(hex: string, t: number): string {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const mix = (c: number) => Math.round(c * t + 255 * (1 - t));
        return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
    }

    private _escapeHtml(str: string): string {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}