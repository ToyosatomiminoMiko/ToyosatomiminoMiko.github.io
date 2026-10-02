/**
 * 红黑树的**解析(格式检查)** 与 **性质检查**(纯逻辑,进程内).
 *
 * 这一层不碰 DOM 也不碰 canvas,所以每条性质都能单独喂一棵"专门坏在这一条上"的树:
 * 拿表达式当输入(与用户实际敲的是同一条路径),用 findPropertyResult 只断言那一条,
 * 免得"根是红的"顺带把红红相接也弄红了,断言写成 `failedCount === 1` 就很难维护.
 *
 * 画布上那几行结论的绘制在 rbt.ts(要真 canvas);清单的标记在 rbt_panel.test.ts.
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { RBT_COMPARISON_TOLERANCE, RBT_PROPERTIES, RBT_TREE_EXAMPLE } from '@/rbt/config';
import {
    buildTreeFromExpression,
    checkTreeProperties,
    findPropertyResult,
    formatPropertySummary,
    type RbtNode,
} from '@/rbt/rbt_tree';

/** 各条性质的稳定 id(与 config 的 RBT_PROPERTIES 一一对应) */
const PROPERTY_IDS = {
    rootBlack: 'root-black',
    redChild: 'red-no-red-child',
    blackHeight: 'black-height',
    bstOrder: 'bst-order',
} as const;

/** 把表达式解析出来跑一遍性质检查(解析失败直接抛,由调用方决定怎么断言) */
function check(expression: string) {
    return checkTreeProperties(buildTreeFromExpression(expression));
}

/** 单条性质的结论 */
function property(expression: string, id: string) {
    return findPropertyResult(check(expression), id);
}

describe('红黑树:表达式解析(格式检查)', () => {
    it('简写叶子自动补成 (nil,nil),左右子树为 null', () => {
        const node = buildTreeFromExpression('5R') as RbtNode;
        expect(node.value).toBe('5');
        expect(node.color).toBe('R');
        expect(node.left).toBeNull();
        expect(node.right).toBeNull();
    });

    it('nil / 空表达式给 null(空树),不建节点', () => {
        expect(buildTreeFromExpression('')).toBeNull();
        expect(buildTreeFromExpression('   ')).toBeNull();
        expect(buildTreeFromExpression('nil')).toBeNull();
        expect(buildTreeFromExpression('NIL')).toBeNull();
    });

    it('标准括号表达式按左右子树拆开', () => {
        const root = buildTreeFromExpression('13B(8R(1B,11R),17R(15B,25B))') as RbtNode;
        expect(`${root.value}${root.color}`).toBe('13B');
        expect(root.left?.value).toBe('8');
        expect(root.left?.left?.value).toBe('1');
        expect(root.left?.right?.value).toBe('11');
        expect(root.right?.value).toBe('17');
        expect(root.right?.left?.value).toBe('15');
        expect(root.right?.right?.value).toBe('25');
    });

    it('格式错误一律抛错(文案来自 config),错误信息带"解析失败"前缀', () => {
        expect(() => buildTreeFromExpression('5')).toThrow(/解析失败/);
        expect(() => buildTreeFromExpression('5X(nil,nil)')).toThrow(/颜色标记/);
        expect(() => buildTreeFromExpression('5B(1B,2B')).toThrow(/括号不匹配/);
        expect(() => buildTreeFromExpression('5B(1B 2B)')).toThrow(/缺少逗号/);
    });

    it('配平右括号之后还有内容 -> 抛错,不静默丢弃', () => {
        // 括号配平只说明"这一段对上了",不说明整串就是这一个表达式;
        // 少这条检查的话下面三种写法都会被当成合法的 5B 树.
        expect(() => buildTreeFromExpression('5B(1B,2B)junk')).toThrow(/多余内容/);
        expect(() => buildTreeFromExpression('5B(1B,2B))')).toThrow(/多余内容/);
        expect(() => buildTreeFromExpression('5B(1B,2B)(3B,4B)')).toThrow(/多余内容/);
        // 子树里也一样:左子树收尾之后多出来的字符同样要报错
        expect(() => buildTreeFromExpression('5B(1B(2B,3B)x,4B)')).toThrow(/多余内容/);
        // 前后空白是允许的(parseNode 先 trim)
        expect(buildTreeFromExpression('  5B(1B,2B)  ')?.value).toBe('5');
    });
});

describe('红黑树:性质检查', () => {
    it('配置里有四条性质,id 不重复', () => {
        expect(RBT_PROPERTIES).toHaveLength(4);
        const ids = RBT_PROPERTIES.map((spec) => spec.id);
        expect(new Set(ids).size).toBe(ids.length);
        // 检查代码按 id 取结论,id 漏一个就会在 findPropertyResult 里抛
        for (const id of Object.values(PROPERTY_IDS)) {
            expect(ids, id).toContain(id);
        }
        // "nil 叶子黑" / "非红即黑" / "两孩子或都是 nil" 三条结构上不可能违反,
        // 不列进清单(理由见 config 的 RBT_PROPERTIES);这里钉住"没混进来"
        expect(ids).not.toContain('nil-leaf-black');
    });

    it('合法红黑树(站点默认示例)四条全过', () => {
        // 用的就是挂载时灌进输入框的那一份(config 的 RBT_TREE_EXAMPLE),
        // 不再在测试里手抄一遍字符串:常量改了这里跟着变.
        const report = check(RBT_TREE_EXAMPLE);
        expect(report.results.map((result) => result.pass)).toEqual([true, true, true, true]);
        expect(report.failedCount).toBe(0);
        expect(report.total).toBe(RBT_PROPERTIES.length);
    });

    it('合法的非满树也全过(含单侧链条 n 层,黑高一致)', () => {
        // 全黑链:每层到 nil 的黑高都一样,是合法的红黑树
        expect(check('10B(5B(1B,7B),20B(15B,30B))').failedCount).toBe(0);
        // 红节点夹在黑节点之间,叶子接 nil 的那一层也合法
        expect(check('10B(5R(1B,7B),20R(15B,30B))').failedCount).toBe(0);
    });

    it('空树是合法红黑树:四条都 PASS', () => {
        const report = checkTreeProperties(null);
        expect(report.failedCount).toBe(0);
        expect(report.results.every((result) => result.pass)).toBe(true);
    });

    it('第 1 条:根是红色 -> 根黑 FAIL,并指出是哪个节点', () => {
        const result = property('10R(5B,20B)', PROPERTY_IDS.rootBlack);
        expect(result.pass).toBe(false);
        expect(result.detail).toContain('10R');
    });

    it('第 2 条:红节点底下挂红孩子 -> 指出那个红节点', () => {
        const result = property('10B(5R(1R,7B),20B(15B,30B))', PROPERTY_IDS.redChild);
        expect(result.pass).toBe(false);
        expect(result.detail).toContain('5R');
    });

    it('红节点接 nil 叶子只坏黑高,不坏第 2 条(nil 就是黑的)', () => {
        // 5R 是简写叶子,补成 5R(nil,nil):两个孩子都是黑叶子,第 2 条不适用;
        // 但它右边那条路径(5R -> nil)比左边(10B -> 5R -> nil)少一个黑节点,
        // 所以坏的是黑高那一条
        const report = check('10B(5R,20B)');
        expect(findPropertyResult(report, PROPERTY_IDS.redChild).pass).toBe(true);
        const height = findPropertyResult(report, PROPERTY_IDS.blackHeight);
        expect(height.pass).toBe(false);
        expect(height.detail).toContain('10B');
    });

    it('第 3 条:一侧多出一个黑节点 -> 两侧黑高不同,报出较浅 / 较深的数', () => {
        // 右侧多一层黑节点:左侧黑高 2(10B -> nil),右侧 3(10B -> 20B -> nil)
        const result = property('10B(5B,20B(15B,30B))', PROPERTY_IDS.blackHeight);
        expect(result.pass).toBe(false);
        expect(result.detail).toContain('10B');
        // {expected} 是较浅那侧,{actual} 是较深那侧
        expect(result.detail).toMatch(/较浅一侧 2/);
        expect(result.detail).toMatch(/较深一侧 3/);
    });

    it('第 4 条:值乱序 -> 搜索序 FAIL(黑高合法也照样报)', () => {
        // 根的右子树里放了 2:父子关系(2<40)全对,只有"已见到的区间"
        // 能发现 2 比根 10 小
        const expression = '10B(5B(3B,7B),40B(2B,50B))';
        const report = check(expression);
        const result = findPropertyResult(report, PROPERTY_IDS.bstOrder);
        expect(result.pass).toBe(false);
        expect(result.detail).not.toBe('');
        // 这一条坏不影响红黑那三条:四条路径黑高都是 3,也没有红红相接
        expect(report.failedCount).toBe(1);
    });

    it('越级的乱序也报:两层的父子都合法,区间到第三层才发现', () => {
        // 5 是 20 的左孩子,20 又是 30 的左孩子,而 30 是根的右孩子:
        // 20<30,5<20 各自都对,整条链却都跑到根的左边(链上每个都得大于 10)
        const report = check('10B(2B(1B,3B),30B(20B(5B,25B),40B))');
        expect(findPropertyResult(report, PROPERTY_IDS.bstOrder).pass).toBe(false);
        // 顺带说明:报的是"扫描时最先撞上的违规处"(这里 5 与 30 都比根小,
        // 先撞上哪个就报哪个),不一定是最初写错的那个节点 -- 位置只是
        // "搜索能确认违规的地方",不是根因定位.
    });

    it('相等值(重复)不算有序:两侧共用同一个数会判 FAIL', () => {
        expect(property('10B(10B,20B)', PROPERTY_IDS.bstOrder).pass).toBe(false);
        expect(property('10B(5B,10B)', PROPERTY_IDS.bstOrder).pass).toBe(false);
    });

    it('值按数值比:`007` 与 `7` 是同一个数,不算乱序', () => {
        // 字符串比较会把 "007" 排在 "7" 前面,数值比较不会
        expect(property('10B(007B,20B)', PROPERTY_IDS.bstOrder).pass).toBe(true);
    });

    it('容差是极小值:相邻整数不受影响,浮点写法也留有余地', () => {
        expect(RBT_COMPARISON_TOLERANCE).toBeLessThan(1e-6);
        expect(check('10.5B(5.25B,20.75B)').failedCount).toBe(0);
    });

    it('值不是十进制数(如 abcR)时跳过有序性判定,不误报', () => {
        const report = check('abcB(xR,yR)');
        // 红黑那几条照查(全黑 + 红叶子合法),搜索序跳过
        expect(findPropertyResult(report, PROPERTY_IDS.bstOrder).pass).toBe(true);
    });

    it('抬头文案把总条数 / FAIL 条数换成数字', () => {
        expect(formatPropertySummary(check('10B(5R(1B,7B),20R(15B,30B))')))
            .toContain(`${RBT_PROPERTIES.length} 条中 0 条`);
        expect(formatPropertySummary(check('10R(5B,20B)'))).toMatch(/条中 [1-9]\d* 条 FAIL/);
    });
});
