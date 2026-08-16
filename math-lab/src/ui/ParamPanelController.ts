/**
 * 参数面板控制器。
 * 从 DslApp 拆出，负责根据 ParamDeclaration 生成滑块与数字输入，
 * 并维护当前参数值。
 */
import type { ParamDeclaration } from '../compiler/ir/types';

export type ParamChangeHandler = (name: string, value: number) => void;

export class ParamPanelController {
    private readonly values = new Map<string, number>();

    constructor(
        private readonly panel: HTMLElement,
        private readonly onChange: ParamChangeHandler,
    ) {}

    render(params: ParamDeclaration[]): void {
        this.panel.replaceChildren();
        this.values.clear();

        for (const param of params) {
            this.values.set(param.name, param.value);
            this.panel.appendChild(this._createParamRow(param));
        }
    }

    getValues(): Record<string, number> {
        return Object.fromEntries(this.values);
    }

    dispose(): void {
        this.panel.replaceChildren();
        this.values.clear();
    }

    private _createParamRow(param: ParamDeclaration): HTMLElement {
        const row = document.createElement('div');
        row.className = 'param-row';

        const label = document.createElement('label');
        label.textContent = param.name;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(param.min);
        slider.max = String(param.max);
        slider.step = String(param.step);
        slider.value = String(param.value);

        const numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.min = String(param.min);
        numberInput.max = String(param.max);
        numberInput.step = String(param.step);
        numberInput.value = String(param.value);

        const syncFromSlider = (): void => {
            const next = Number(slider.value);
            numberInput.value = String(next);
            this.values.set(param.name, next);
            this.onChange(param.name, next);
        };

        const syncFromNumber = (): void => {
            const raw = Number(numberInput.value);
            if (!Number.isFinite(raw)) return;
            const clamped = Math.min(param.max, Math.max(param.min, raw));
            slider.value = String(clamped);
            numberInput.value = String(clamped);
            this.values.set(param.name, clamped);
            this.onChange(param.name, clamped);
        };

        slider.addEventListener('input', syncFromSlider);
        numberInput.addEventListener('input', syncFromNumber);
        numberInput.addEventListener('change', syncFromNumber);

        row.append(label, slider, numberInput);
        return row;
    }
}
