/**
 * 红黑树**行为层**(rbt/rbt.ts 的 mountRBT)的契约(进程内,跑在 happy-dom 里).
 *
 * 这里钉的是一条分工:**画布只画树**.
 * - 画布上的 `fillText` 只应该出现节点值(每个节点一次),提示 / 错误 / 性质结论
 *   一个都不许落在画布上 -- 所以"空输入 / 空树 / 解析失败"三种情况下 `fillText`
 *   次数必须是 0,合法树那一次的次数必须等于节点数;
 * - 文案改由 HTML 出:#treeHint(空输入 / 空树),#treeError(解析错误),
 *   #treeProperties(性质清单),并且同一时刻只该亮一块.
 *
 * happy-dom 没有真 canvas(`getContext('2d')` 返回 null,同 oled.test.ts 的说明),
 * 所以这里给一块**只记录调用的**桩:不落像素,只把 fillText 的文本按顺序攒起来,
 * 断言"画布上写了什么字".真像素级验证(示例树真的有红节点)在
 * scripts/smoke_home.mjs,不在这一层重复.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    RBT_DIAGNOSTICS_ROW_CLASS,
    RBT_DOM,
    RBT_EMPTY_HINT_TEXT,
    RBT_EMPTY_TREE_HINT_TEXT,
    RBT_ERROR_UI_PREFIX,
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

describe('红黑树:挂载后的画布与 HTML 文案分工', () => {
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

    it('示例树自动加载:画布只写节点值,清单四条全出', () => {
        const host = document.createElement('div');
        document.body.append(host);
        mountRBT(host);

        const input = byId<HTMLTextAreaElement>(RBT_DOM.inputId);
        expect(input.value).toBe(RBT_TREE_EXAMPLE);

        // 有树可画时:两块文案都收起来,清单亮出来
        expect(byId(RBT_DOM.hintId).hidden).toBe(true);
        expect(byId(RBT_DOM.errorId).hidden).toBe(true);
        const diagnostics = byId(RBT_DOM.diagnosticsId);
        expect(diagnostics.hidden).toBe(false);
        expect(diagnostics.querySelectorAll(`.${RBT_DIAGNOSTICS_ROW_CLASS}`))
            .toHaveLength(RBT_PROPERTIES.length);

        // 深度 4 的满树 31 个节点 => 31 次 fillText,且每次都是节点值(纯数字)
        expect(canvasTexts).toHaveLength(31);
        expect(canvasTexts.every((text) => /^\d+$/.test(text))).toBe(true);
    });

    it('清空输入:提示进 #treeHint,画布上一个字的文案都不留', () => {
        const host = document.createElement('div');
        document.body.append(host);
        mountRBT(host);
        const input = byId<HTMLTextAreaElement>(RBT_DOM.inputId);

        canvasTexts.length = 0;
        typeExpression(input, '');

        expect(canvasTexts).toEqual([]);
        const hint = byId(RBT_DOM.hintId);
        expect(hint.hidden).toBe(false);
        expect(hint.textContent).toBe(RBT_EMPTY_HINT_TEXT);
        expect(byId(RBT_DOM.errorId).hidden).toBe(true);
        expect(byId(RBT_DOM.diagnosticsId).hidden).toBe(true);
    });

    it('输入 nil(合法空树):提示与空输入不同,画布同样不写字', () => {
        const host = document.createElement('div');
        document.body.append(host);
        mountRBT(host);
        const input = byId<HTMLTextAreaElement>(RBT_DOM.inputId);

        canvasTexts.length = 0;
        typeExpression(input, 'nil');

        expect(canvasTexts).toEqual([]);
        expect(byId(RBT_DOM.hintId).textContent).toBe(RBT_EMPTY_TREE_HINT_TEXT);
        expect(byId(RBT_DOM.errorId).hidden).toBe(true);
        expect(byId(RBT_DOM.diagnosticsId).hidden).toBe(true);
    });

    it('解析失败:错误进 #treeError,画布不写错误文案', () => {
        const host = document.createElement('div');
        document.body.append(host);
        mountRBT(host);
        const input = byId<HTMLTextAreaElement>(RBT_DOM.inputId);

        canvasTexts.length = 0;
        typeExpression(input, '5B(1B 2B)');

        expect(canvasTexts).toEqual([]);
        const error = byId(RBT_DOM.errorId);
        expect(error.hidden).toBe(false);
        expect(error.textContent).toContain(RBT_ERROR_UI_PREFIX);
        expect(error.textContent).toContain('缺少逗号');
        expect(byId(RBT_DOM.hintId).hidden).toBe(true);
        expect(byId(RBT_DOM.diagnosticsId).hidden).toBe(true);
    });

    it('合法小树:画布只写节点值,节点数 == fillText 次数', () => {
        const host = document.createElement('div');
        document.body.append(host);
        mountRBT(host);
        const input = byId<HTMLTextAreaElement>(RBT_DOM.inputId);

        canvasTexts.length = 0;
        typeExpression(input, '10B(5R,15R)');

        expect([...canvasTexts].sort()).toEqual(['10', '15', '5']);
        expect(byId(RBT_DOM.hintId).hidden).toBe(true);
        expect(byId(RBT_DOM.errorId).hidden).toBe(true);
        expect(byId(RBT_DOM.diagnosticsId).hidden).toBe(false);
    });
});
