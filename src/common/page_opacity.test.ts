/**
 * "页面透明度"滑块的契约(进程内,跑在 happy-dom 里).
 *
 * 这一块只有一个跨文件约定要钉住:滑块写的那条值必须落进 CSS 元令牌
 * `--tab-pane-opacity`(消费方是 public/css/index.css 的 `.tab-pane` 规则).
 * 真级联与"窗格真的变淡了"只有浏览器里才算数,所以那半条在 scripts/smoke_home.mjs;
 * 这里管三件事:
 *
 *   1. 滑块是**追加**进宿主的(宿主里已经有背景缩略图,不能被接管掉);
 *   2. 结构 = 库的 `.slider-field` + 站点那个定宽的 `.opacity-field`;
 *   3. 拖动 / 输入 / 重置都只改写文档根上那一个令牌,值还是两位小数的**纯数字**
 *      (数值框是 `<input type="number">`,写成 "90%" 会被浏览器丢掉).
 *
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
    PAGE_OPACITY_DEFAULT,
    PAGE_OPACITY_FIELD_CLASS,
    PAGE_OPACITY_LABEL,
    PAGE_OPACITY_MAX,
    PAGE_OPACITY_MIN,
    PAGE_OPACITY_STEP,
    PAGE_OPACITY_VARIABLE,
} from '@/common/site.config';
import { mountPageOpacity } from '@/common/page_opacity';

/** 挂在文档根上的令牌值(空串 = 没写过,初值由 CSS 提供) */
function token(): string {
    return document.documentElement.style.getPropertyValue(PAGE_OPACITY_VARIABLE);
}

/** 宿主里已有一颗缩略图按钮(模拟 `.bgrow`),滑块只能追加在它后面 */
function hostWithTile(): HTMLElement {
    const host = document.createElement('div');
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'bgbtn';
    host.append(tile);
    return host;
}

/** 在建好的宿主里挂一次滑块 */
function mount(): { host: HTMLElement; slider: ReturnType<typeof mountPageOpacity> } {
    const host = hostWithTile();
    document.body.append(host);
    return { host, slider: mountPageOpacity(host) };
}

/** 输入框的一次原生事件(input = 拖动/按键,change = 失焦/回车) */
function fire(input: HTMLInputElement, type: 'input' | 'change'): void {
    input.dispatchEvent(new Event(type, { bubbles: true }));
}

beforeEach(() => {
    document.body.innerHTML = '';
    // 令牌是写在文档根上的,不清掉会串到下一个用例
    document.documentElement.removeAttribute('style');
});

describe('SETTING:页面透明度滑块', () => {
    it('追加进宿主,不接管里面已有的缩略图', () => {
        const { host, slider } = mount();
        expect(host.children).toHaveLength(2);
        expect(host.firstElementChild?.className).toBe('bgbtn');
        expect(host.lastElementChild).toBe(slider.element);
    });

    it('结构是库的滑块 + 站点的定宽类(内部排布归库)', () => {
        const { slider } = mount();
        expect(slider.element.tagName).toBe('DIV');
        expect([...slider.element.classList]).toEqual(['slider-field', PAGE_OPACITY_FIELD_CLASS]);
        expect(slider.element.querySelector('.slider-field-range')).toBe(slider.input);
        expect(slider.element.querySelector('.slider-field-meta')).not.toBeNull();
        expect(slider.element.querySelector('.slider-field-value')).toBe(slider.number.input);
        expect(slider.element.querySelector('.slider-field-reset')).toBe(slider.reset.element);
    });

    it('名称 / 区间 / 步长都来自 site.config.ts', () => {
        const { slider } = mount();
        const label = slider.element.querySelector('.slider-field-label');
        // 名称是整条 label 的文本(没有 hint,所以 label 里不该再多一个 <small>)
        expect(label?.textContent).toBe(PAGE_OPACITY_LABEL);
        expect(label?.querySelector('small')).toBeNull();
        // 可见 label 关联滑杆(它是这一行里的大热区)
        expect(label?.getAttribute('for')).toBe(slider.input.id);
        expect(slider.input.type).toBe('range');
        expect(slider.input.min).toBe(String(PAGE_OPACITY_MIN));
        expect(slider.input.max).toBe(String(PAGE_OPACITY_MAX));
        expect(slider.input.step).toBe(String(PAGE_OPACITY_STEP));
        expect(slider.get()).toBe(PAGE_OPACITY_DEFAULT);
    });

    it('初值就是声明值:数值框写的是纯数字,重置按钮一开始是灰的', () => {
        const { slider } = mount();
        // 固定两位小数:"0.9" 在数值框里读作 "0.90";写成百分比会被 number 输入框丢掉
        expect(slider.number.readText()).toBe(PAGE_OPACITY_DEFAULT.toFixed(2));
        expect(slider.number.input.type).toBe('number');
        expect(slider.reset.element.disabled).toBe(true);
    });

    it('挂载时不写令牌(初值只有 CSS 一份,JS 不存第二份)', () => {
        mount();
        expect(token()).toBe('');
    });

    it('拖动滑杆到区间内的另一档,令牌两位小数', () => {
        const { slider } = mount();
        // 取区间中点而不是写死一个数:区间改了这条断言不会跟着假失败
        const mid = (PAGE_OPACITY_MIN + PAGE_OPACITY_MAX) / 2;
        slider.input.value = String(mid);
        fire(slider.input, 'input');
        expect(token()).toBe(mid.toFixed(2));
        expect(slider.get()).toBe(mid);
    });

    it('数值框输入的越界值被夹回区间,写进令牌的是夹取后的值', () => {
        const { slider } = mount();
        slider.number.input.value = '1.5';
        fire(slider.number.input, 'change');
        expect(slider.get()).toBe(PAGE_OPACITY_MAX);
        expect(token()).toBe(PAGE_OPACITY_MAX.toFixed(2));
    });

    it('重置回到默认档,令牌跟着回默认值', () => {
        const { slider } = mount();
        // 先拖到一个**区间内**,且不等于默认值的档(0.9 之外的数才看得出重置有效)
        const other = PAGE_OPACITY_MIN;
        slider.input.value = String(other);
        fire(slider.input, 'input');
        expect(token()).toBe(other.toFixed(2));
        slider.reset.element.click();
        expect(slider.get()).toBe(PAGE_OPACITY_DEFAULT);
        expect(token()).toBe(PAGE_OPACITY_DEFAULT.toFixed(2));
    });
});
