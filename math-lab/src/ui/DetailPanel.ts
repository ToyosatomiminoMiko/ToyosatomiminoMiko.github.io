import { EventBus } from '../service/EventBus';
import type { MathLabEvents } from '../types';
import type { MathObjectManager } from '../math_objects';
import type { SelectionManager } from './SelectionManager';
import type { IntegralVisualizer } from '../visualization/IntegralVisualizer';
import { GradientVisualizer } from '../visualization/GradientVisualizer';
import { EditTab } from './detail/EditTab';
import type { Tab } from './detail/Tab';
import { DerivativeTab } from './detail/DerivativeTab';
import { GradientTab } from './detail/GradientTab';
import { IntegralTab } from './detail/IntegralTab';

/**
 * DetailPanel - 详情面板
 * 标签页:
 *   📝 编辑   - 表达式输入框 + 🔄更新 + 颜色 + 系数滑块
 *   📐 求导   - d/dx / ∂/∂x / ∂/∂y 按钮
 *   📊 积分   - 方法选择 + 区间 + 分段 + 计算
 *   📐 梯度   - 状态提示 + 计算梯度按钮
 */
export class DetailPanel {
    private _eventBus: EventBus<MathLabEvents>;
    private _objectManager: MathObjectManager;
    private _selectionManager: SelectionManager;
    private _integralVisualizer: IntegralVisualizer;
    private _gradientVisualizer: GradientVisualizer;

    // DOM
    private _tabContainer: HTMLElement;
    private _contentContainer: HTMLElement;
    private _tabs: NodeListOf<HTMLElement>;
    private _activeTab: string;
    private _currentTab: Tab | null = null;
    private _colorPicker: HTMLElement;
    private _colorInput: HTMLInputElement;

    constructor(
        eventBus: EventBus<MathLabEvents>,
        objectManager: MathObjectManager,
        selectionManager: SelectionManager,
        integralVisualizer: IntegralVisualizer,
        gradientVisualizer: GradientVisualizer,
    ) {
        this._eventBus = eventBus;
        this._objectManager = objectManager;
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
        this._eventBus.on('mathobj:added', () => this._refreshContent());
        this._eventBus.on('mathobj:removed', () => this._refreshContent());
        this._eventBus.on('mathobj:updated', () => this._refreshContent());

        // color
        this._colorPicker = document.getElementById('detailColorPicker')!;
        this._colorInput = this._colorPicker.querySelector('input[type="color"]')!;
        this._bindColorEvents();
        // 初始渲染
        this._onSelectionChanged();
    }

    private _bindColorEvents(): void {
        this._colorInput.addEventListener('input', () => {
            const selected = this._selectionManager.getSelected();
            if (!selected) return;
            this._objectManager.updateColor(selected.id, this._colorInput.value);
            this._eventBus.emit('mathobj:updated', { id: selected.id });
        });
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

    private _onSelectionChanged(): void {
        const selected = this._selectionManager.getSelected();
        const kind = selected?.kind ?? null;
        this._syncColorPicker();

        this._tabs.forEach(tab => {
            const tabName = (tab as HTMLElement).dataset.tab!;
            const visible = this._isTabVisible(tabName, kind);
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

        // 清理积分 / 梯度可视化(切换选中时)
        this._integralVisualizer.clearAll();
        this._gradientVisualizer.clear();
        this._refreshContent();
    }

    private _isTabVisible(tab: string, kind: string | null): boolean {
        if (!kind) return tab === 'edit'; // 无选中时只显示编辑(占位)

        switch (tab) {
            case 'edit': return true;
            case 'derivative': return kind === 'curve' || kind === 'surface';
            case 'integral': return kind === 'curve' || kind === 'surface';
            case 'gradient': return kind === 'surface';
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

        const obj = this._objectManager.getById(selected.id);
        if (!obj) {
            this._contentContainer.innerHTML =
                '<div class="detail-hint">实体已被删除</div>';
            return;
        }

        // 销毁旧标签页
        this._currentTab?.destroy();
        this._currentTab = null;

        // 创建新标签页
        switch (this._activeTab) {
            case 'edit':
                this._currentTab = new EditTab(
                    this._contentContainer,
                    this._objectManager,
                    this._eventBus,
                );
                break;
            case 'derivative':
                this._currentTab = new DerivativeTab(
                    this._contentContainer,
                    this._objectManager,
                    this._eventBus,
                    this._selectionManager,
                );
                break;
            case 'integral':
                this._currentTab = new IntegralTab(
                    this._contentContainer,
                    this._objectManager,
                    this._eventBus,
                    this._integralVisualizer,
                );
                break;
            case 'gradient':
                this._currentTab = new GradientTab(
                    this._contentContainer,
                    this._objectManager,
                    this._eventBus,
                    this._selectionManager,
                    this._gradientVisualizer,
                );
                break;
        }

        this._currentTab?.render(obj);
        this._syncColorPicker();
    }

    private _syncColorPicker(): void {
        const selected = this._selectionManager.getSelected();
        const obj = selected ? this._objectManager.getById(selected.id) : null;
        if (obj && ['curve', 'surface', 'point', 'vector'].includes(obj.kind)) {
            this._colorPicker.style.display = 'flex';
            this._colorInput.value = obj.color;
        } else {
            this._colorPicker.style.display = 'none';
        }
    }
}