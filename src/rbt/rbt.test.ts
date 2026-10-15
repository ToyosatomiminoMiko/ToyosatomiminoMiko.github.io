/**
 * 红黑树**行为层**(rbt/rbt.ts 的 mountRBT)的契约(进程内,跑在 happy-dom 里).
 *
 * 这里钉三条分工:
 *
 * 1. **树只画结构与节点值**:SVG 里的文字只应该出现节点值(每个节点一处),提示 /
 *    错误 / 性质结论一个都不许进 SVG -- 所以"空输入 / 空树 / 解析失败"三种情况下
 *    节点与连线都必须是 0,合法树那一次的节点数必须等于表达式里的节点数;
 * 2. **文案只有一个输出区**:#treeOutput 里每轮只装一种内容 -- 一行提示
 *    (.tree-hint),一行错误(.tree-error),或性质清单(抬头 + 四条 .tree-property),
 *    三者不会同时出现(整批替换);
 * 3. **结构能对上**:节点数 = 2n-1(每条连线都是一个非根节点),红黑修饰类真的按
 *    表达式里的颜色挂上,节点坐标来自布局(不是全挤在原点).
 *
 * 从前这一层打在 canvas 原型上,记录 `fillText` 的调用;换成 SVG 之后树就是文档里
 * 的元素,直接查 DOM 即可 -- 那一整套"造一块只记 fillText 的 2D 上下文"的桩因此
 * 整个删掉了.真像素 / 真实 CSS 级联(颜色真的落在 fill 上,令牌真的生效)仍然只在
 * scripts/smoke_home.mjs 里验,不在这一层重复.
 *
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
    RBT_DIAGNOSTICS_ROW_CLASS,
    RBT_DIAGNOSTICS_SUMMARY_CLASS,
    RBT_DOM,
    RBT_EDGE_CLASS,
    RBT_EMPTY_HINT_TEXT,
    RBT_EMPTY_TREE_HINT_TEXT,
    RBT_ERROR_UI_PREFIX,
    RBT_NODE_BLACK_CLASS,
    RBT_NODE_CLASS,
    RBT_NODE_LABEL_CLASS,
    RBT_NODE_RED_CLASS,
    RBT_NODE_SHAPE_CLASS,
    RBT_OUTPUT_ERROR_CLASS,
    RBT_OUTPUT_HINT_CLASS,
    RBT_PROPERTIES,
    RBT_TREE_EXAMPLE,
} from '@/rbt/config';
import { mountRBT } from '@/rbt/rbt';

/** 按 id 取刚挂载出来的元素(取不到说明标记契约变了,直接抛错而不是让断言读 null) */
function byId<T extends Element>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`面板里找不到 #${id}`);
    return element as unknown as T;
}

/** 往输入框里喂一个表达式并派发 input 事件(与用户敲键盘走的是同一条链路) */
function typeExpression(input: HTMLTextAreaElement, expression: string): void {
    input.value = expression;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 挂一块新面板,交回输入框 / 输出区 / 那棵 SVG(每轮输入前后都拿它读状态) */
function mountPanel(): { input: HTMLTextAreaElement; output: HTMLElement; tree: SVGSVGElement } {
    const host = document.createElement('div');
    document.body.append(host);
    mountRBT(host);
    return {
        input: byId<HTMLTextAreaElement>(RBT_DOM.inputId),
        output: byId<HTMLElement>(RBT_DOM.outputId),
        tree: byId<SVGSVGElement>(RBT_DOM.treeId),
    };
}

/** 树里当前画着的节点(按文档顺序) */
function treeNodes(tree: SVGSVGElement): Element[] {
    return [...tree.querySelectorAll(`.${RBT_NODE_CLASS}`)];
}

/** 树里当前画着的连线 */
function treeEdges(tree: SVGSVGElement): Element[] {
    return [...tree.querySelectorAll(`.${RBT_EDGE_CLASS}`)];
}

/** 树上所有节点值(按文档顺序) */
function treeLabels(tree: SVGSVGElement): string[] {
    return [...tree.querySelectorAll(`.${RBT_NODE_LABEL_CLASS}`)].map((label) => label.textContent ?? '');
}

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('红黑树:挂载后的树与唯一输出区', () => {
    it('示例树自动加载:输出区是性质清单,树里只写节点值', () => {
        const { input, output, tree } = mountPanel();

        expect(input.value).toBe(RBT_TREE_EXAMPLE);
        expect(output.hidden).toBe(false);
        // 一块输出区里只有清单:提示行 / 错误行都不在
        expect(output.querySelectorAll(`.${RBT_OUTPUT_HINT_CLASS}`)).toHaveLength(0);
        expect(output.querySelectorAll(`.${RBT_OUTPUT_ERROR_CLASS}`)).toHaveLength(0);
        expect(output.querySelectorAll(`.${RBT_DIAGNOSTICS_SUMMARY_CLASS}`)).toHaveLength(1);
        expect(output.querySelectorAll(`.${RBT_DIAGNOSTICS_ROW_CLASS}`))
            .toHaveLength(RBT_PROPERTIES.length);

        // 深度 4 的满树 31 个节点 => 31 个节点组,且每个都是一颗圆 + 一个节点值.
        // 每颗圆都带 .rbt-node__shape(半径 / 颜色由 CSS 给它,见 src/rbt/rbt.css).
        const nodes = treeNodes(tree);
        expect(nodes).toHaveLength(31);
        expect(tree.querySelectorAll(`.${RBT_NODE_SHAPE_CLASS}`)).toHaveLength(31);
        // 节点值全是纯数字(画布上除了节点值没有任何别的文字)
        expect(treeLabels(tree).every((label) => /^\d+$/.test(label))).toBe(true);
    });

    it('树有 n 个节点就有 n-1 条连线(每条连线对应一个非根节点)', () => {
        const { tree } = mountPanel();

        expect(treeEdges(tree)).toHaveLength(31 - 1);
    });

    it('节点与连线的坐标来自布局,不是全挤在原点', () => {
        const { tree } = mountPanel();

        const transforms = treeNodes(tree).map((node) => node.getAttribute('transform') ?? '');
        expect(transforms.every((transform) => /^translate\([\d.]+,[\d.]+\)$/.test(transform))).toBe(true);
        // 31 个节点各有各的位置(同层也有水平展开)
        expect(new Set(transforms).size).toBe(31);

        // 连线两端读的就是父子节点的坐标,所以端点也不该是同一个点
        for (const edge of treeEdges(tree)) {
            const x1 = edge.getAttribute('x1');
            const y1 = edge.getAttribute('y1');
            expect(x1).not.toBeNull();
            expect(y1).not.toBeNull();
            expect(`${x1},${y1}`).not.toBe(`${edge.getAttribute('x2')},${edge.getAttribute('y2')}`);
        }
    });

    it('红黑修饰类按表达式里的颜色挂上(根黑,两个孩子红)', () => {
        const { input, tree } = mountPanel();

        typeExpression(input, '10B(5R,15R)');

        const nodes = treeNodes(tree);
        expect(nodes).toHaveLength(3);
        // 文档顺序是先根后子树(先序遍历),所以第一颗是根
        expect(nodes[0].classList.contains(RBT_NODE_BLACK_CLASS)).toBe(true);
        expect(nodes[0].classList.contains(RBT_NODE_RED_CLASS)).toBe(false);
        expect(nodes[1].classList.contains(RBT_NODE_RED_CLASS)).toBe(true);
        expect(nodes[2].classList.contains(RBT_NODE_RED_CLASS)).toBe(true);
        expect(nodes.filter((node) => node.classList.contains(RBT_NODE_BLACK_CLASS))).toHaveLength(1);
    });

    it('清空输入:输出区换成一行提示,树上一个节点 / 一条线都不留', () => {
        const { input, output, tree } = mountPanel();

        typeExpression(input, '');

        expect(treeNodes(tree)).toHaveLength(0);
        expect(treeEdges(tree)).toHaveLength(0);
        expect(treeLabels(tree)).toEqual([]);
        const hints = output.querySelectorAll(`.${RBT_OUTPUT_HINT_CLASS}`);
        expect(hints).toHaveLength(1);
        expect(hints[0].textContent).toBe(RBT_EMPTY_HINT_TEXT);
        // 整批替换:上一轮的性质清单一点都不剩
        expect(output.querySelectorAll(`.${RBT_DIAGNOSTICS_ROW_CLASS}`)).toHaveLength(0);
        expect(output.querySelectorAll(`.${RBT_OUTPUT_ERROR_CLASS}`)).toHaveLength(0);
    });

    it('输入 nil(合法空树):提示与空输入不同,树同样清空', () => {
        const { input, output, tree } = mountPanel();

        typeExpression(input, 'nil');

        expect(treeNodes(tree)).toHaveLength(0);
        expect(treeEdges(tree)).toHaveLength(0);
        const hints = output.querySelectorAll(`.${RBT_OUTPUT_HINT_CLASS}`);
        expect(hints).toHaveLength(1);
        expect(hints[0].textContent).toBe(RBT_EMPTY_TREE_HINT_TEXT);
        expect(output.querySelectorAll(`.${RBT_DIAGNOSTICS_ROW_CLASS}`)).toHaveLength(0);
    });

    it('解析失败:输出区换成一行错误,树里不写错误文案', () => {
        const { input, output, tree } = mountPanel();

        typeExpression(input, '5B(1B 2B)');

        expect(treeNodes(tree)).toHaveLength(0);
        expect(treeLabels(tree)).toEqual([]);
        const errors = output.querySelectorAll(`.${RBT_OUTPUT_ERROR_CLASS}`);
        expect(errors).toHaveLength(1);
        expect(errors[0].textContent).toContain(RBT_ERROR_UI_PREFIX);
        expect(errors[0].textContent).toContain('缺少逗号');
        expect(output.querySelectorAll(`.${RBT_OUTPUT_HINT_CLASS}`)).toHaveLength(0);
        expect(output.querySelectorAll(`.${RBT_DIAGNOSTICS_ROW_CLASS}`)).toHaveLength(0);
    });

    it('合法小树:树上只有节点值,节点数 = 表达式里的节点数', () => {
        const { input, output, tree } = mountPanel();

        typeExpression(input, '10B(5R,15R)');

        expect([...treeLabels(tree)].sort()).toEqual(['10', '15', '5']);
        expect(output.querySelectorAll(`.${RBT_OUTPUT_HINT_CLASS}`)).toHaveLength(0);
        expect(output.querySelectorAll(`.${RBT_OUTPUT_ERROR_CLASS}`)).toHaveLength(0);
        expect(output.querySelectorAll(`.${RBT_DIAGNOSTICS_ROW_CLASS}`))
            .toHaveLength(RBT_PROPERTIES.length);
    });

    it('重复挂载同一块宿主不会插出第二棵树(宿主由本模块独占)', () => {
        const host = document.createElement('div');
        document.body.append(host);
        mountRBT(host);
        mountRBT(host);

        expect(host.querySelectorAll(`#${RBT_DOM.treeId}`)).toHaveLength(1);
        expect(host.querySelectorAll(`.${RBT_NODE_CLASS}`)).toHaveLength(31);
    });
});
