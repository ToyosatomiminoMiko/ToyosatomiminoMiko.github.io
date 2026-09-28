/**
 * 标记契约测试共用的小工具.
 *
 * oled / rbt 两套 *面板* 测试都要做同样两件事:把面板挂进文档(交回的引用必须在
 * 文档里查,否则可能绑到不在页面上的元素),以及检查文档里没有重复 id(挂载函数
 * 用 replaceChildren 整体接管宿主,重复 id 说明标记生成重复了).两处逻辑完全一样,
 * 放在这里只留一份实现;断言本身仍写在各测试文件里.
 *
 * 只有 `*.test.ts` 会被 vitest 收集,本文件是普通模块,由两个测试文件显式 import.
 */
import { expect } from 'vitest';

/** 清空文档,生成面板并挂进去,返回面板引用 */
export function renderPanel<T extends { root: HTMLElement }>(create: () => T): T {
    document.body.innerHTML = '';
    const panel = create();
    document.body.append(panel.root);
    return panel;
}

/** 断言整个文档里没有重复的 id */
export function expectNoDuplicateIds(): void {
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
}
