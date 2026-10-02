/**
 * 红黑树**行为层**(rbt/rbt.ts 的 mountRBT)的契约(进程内,跑在 happy-dom 里).
 *
 * 这里钉两条分工:
 *
 * 1. **画布只画树**:画布上的 `fillText` 只应该出现节点值(每个节点一次),提示 /
 *    错误 / 性质结论一个都不许落在画布上 -- 所以"空输入 / 空树 / 解析失败"三种
 *    情况下 `fillText` 次数必须是 0,合法树那一次的次数必须等于节点数;
 * 2. **文案只有一个输出区**:#treeOutput 里每轮只装一种内容 -- 一行提示
 *    (.tree-hint),一行错误(.tree-error),或性质清单(抬头 + 四条 .tree-property),
 *    三者不会同时出现(整批替换).
 *
 * happy-dom 没有真 canvas(`getContext('2d')` 返回 null,同 oled.test.ts 的说明),
 * 所以这里给一块**只记录调用的**桩:不落像素,只把 fillText 的文本按顺序攒起来,
 * 断言"画布上写了什么字".真像素级验证(示例树真的有红节点,输出区色值走令牌)在
 * scripts/smoke_home.mjs,不在这一层重复.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    RBT_DIAGNOSTICS_ROW_CLASS,
    RBT_DIAGNOSTICS_SUMMARY_CLASS,
    RBT_DOM,
    RBT_EMPTY_HINT_TEXT,
    RBT_EMPTY_TREE_HINT_TEXT,
    RBT_ERROR_UI_PREFIX,
    RBT_OUTPUT_ERROR_CLASS,
    RBT_OUTPUT_HINT_CLASS,
    RBT_PROPERTIES,
    RBT_TREE_EXAMPLE,
} from '@/rbt/config';
import { mountRBT } from '@/rbt/rbt';

/** 画布这一轮写下的所有文字(按落笔顺序) */
const canvasTexts: string[] = [];

/**
 * 造一块"只记 fillText"的 2D 上下文.
 *
 * 布局 / 连线 / 节点圆在本层不关心(没有真像素可断言),所以除 fillText 外全部空实现;
 * 要验的正是"画布上除了节点值没有别的东西",记录文本就够了.
 */
function createStubContext(): CanvasRenderingContext2D {
    const noop = (): void => { /* 本层只关心 fillText,其余落笔忽略 */ };
    const context = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        shadowColor: '',
        shadowBlur: 0,
        font: '',
        textAlign: '',
        textBaseline: '',
        clearRect: noop,
        fillRect: noop,
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        stroke: noop,
        arc: noop,
        fill: noop,
        fillText: (text: string): void => { canvasTexts.push(String(text)); },
    };
    return context as unknown as CanvasRenderingContext2D;
}

/** 按 id 取刚挂载出来的元素(取不到说明标记契约变了,直接抛错而不是让断言读 null) */
function byId<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`面板里找不到 #${id}`);
    return element as T;
}

/** 往输入框里喂一个表达式并派发 input 事件(与用户敲键盘走的是同一条链路) */
function typeExpression(input: HTMLTextAreaElement, expression: string): void {
    input.value = expression;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 挂一块新面板,交回输入框与输出区(每轮输入前后都拿它读状态) */
function mountPanel(): { input: HTMLTextAreaElement; output: HTMLElement } {
    const host = document.createElement('div');
    document.body.append(host);
    mountRBT(host);
    return {
        input: byId<HTMLTextAreaElement>(RBT_DOM.inputId),
        output: byId<HTMLElement>(RBT_DOM.outputId),
    };
}

describe('红黑树:挂载后的画布与唯一输出区', () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;

    beforeEach(() => {
        canvasTexts.length = 0;
        document.body.innerHTML = '';
        // 挂载函数在内部建画布,拿不到元素引用,所以桩打在原型上
        HTMLCanvasElement.prototype.getContext =
            (() => createStubContext()) as unknown as HTMLCanvasElement['getContext'];
    });

    afterEach(() => {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
    });

    it('示例树自动加载:输出区是性质清单,画布只写节点值', () => {
        const { input, output } = mountPanel();

        expect(input.value).toBe(RBT_TREE_EXAMPLE);
        expect(output.hidden).toBe(false);
        // 一块输出区里只有清单:提示行 / 错误行都不在
        expect(output.querySelectorAll(`.${RBT_OUTPUT_HINT_CLASS}`)).toHaveLength(0);
        expect(output.querySelectorAll(`.${RBT_OUTPUT_ERROR_CLASS}`)).toHaveLength(0);
        expect(output.querySelectorAll(`.${RBT_DIAGNOSTICS_SUMMARY_CLASS}`)).toHaveLength(1);
        expect(output.querySelectorAll(`.${RBT_DIAGNOSTICS_ROW_CLASS}`))
            .toHaveLength(RBT_PROPERTIES.length);

        // 深度 4 的满树 31 个节点 => 31 次 fillText,且每次都是节点值(纯数字)
        expect(canvasTexts).toHaveLength(31);
        expect(canvasTexts.every((text) => /^\d+$/.test(text))).toBe(true);
    });

    it('清空输入:输出区换成一行提示,画布上一个字的文案都不留', () => {
        const { input, output } = mountPanel();

        canvasTexts.length = 0;
        typeExpression(input, '');

        expect(canvasTexts).toEqual([]);
        const hints = output.querySelectorAll(`.${RBT_OUTPUT_HINT_CLASS}`);
        expect(hints).toHaveLength(1);
        expect(hints[0].textContent).toBe(RBT_EMPTY_HINT_TEXT);
        // 整批替换:上一轮的性质清单一点都不剩
        expect(output.querySelectorAll(`.${RBT_DIAGNOSTICS_ROW_CLASS}`)).toHaveLength(0);
        expect(output.querySelectorAll(`.${RBT_OUTPUT_ERROR_CLASS}`)).toHaveLength(0);
    });

    it('输入 nil(合法空树):提示与空输入不同,画布同样不写字', () => {
        const { input, output } = mountPanel();

        canvasTexts.length = 0;
        typeExpression(input, 'nil');

        expect(canvasTexts).toEqual([]);
        const hints = output.querySelectorAll(`.${RBT_OUTPUT_HINT_CLASS}`);
        expect(hints).toHaveLength(1);
        expect(hints[0].textContent).toBe(RBT_EMPTY_TREE_HINT_TEXT);
        expect(output.querySelectorAll(`.${RBT_DIAGNOSTICS_ROW_CLASS}`)).toHaveLength(0);
    });

    it('解析失败:输出区换成一行错误,画布不写错误文案', () => {
        const { input, output } = mountPanel();

        canvasTexts.length = 0;
        typeExpression(input, '5B(1B 2B)');

        expect(canvasTexts).toEqual([]);
        const errors = output.querySelectorAll(`.${RBT_OUTPUT_ERROR_CLASS}`);
        expect(errors).toHaveLength(1);
        expect(errors[0].textContent).toContain(RBT_ERROR_UI_PREFIX);
        expect(errors[0].textContent).toContain('缺少逗号');
        expect(output.querySelectorAll(`.${RBT_OUTPUT_HINT_CLASS}`)).toHaveLength(0);
        expect(output.querySelectorAll(`.${RBT_DIAGNOSTICS_ROW_CLASS}`)).toHaveLength(0);
    });

    it('合法小树:画布只写节点值,节点数 == fillText 次数', () => {
        const { input, output } = mountPanel();

        canvasTexts.length = 0;
        typeExpression(input, '10B(5R,15R)');

        expect([...canvasTexts].sort()).toEqual(['10', '15', '5']);
        expect(output.querySelectorAll(`.${RBT_OUTPUT_HINT_CLASS}`)).toHaveLength(0);
        expect(output.querySelectorAll(`.${RBT_OUTPUT_ERROR_CLASS}`)).toHaveLength(0);
        expect(output.querySelectorAll(`.${RBT_DIAGNOSTICS_ROW_CLASS}`))
            .toHaveLength(RBT_PROPERTIES.length);
    });
});
