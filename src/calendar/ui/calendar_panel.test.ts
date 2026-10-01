/**
 * Calendario 页标记的**契约**回归网(进程内,跑在 happy-dom 里).
 *
 * 与 calendar.ts 的分工:那边管"挂上去之后日期填没填,跨日刷不刷新"(在
 * calendar.test.ts 里),这边管"生成的标记长什么样" -- 因为 CSS 与行为代码都是按
 * **类名 / id / 结构位置**命中的,生成结果一旦走样,表现是"样式静默失效"或
 * "日期写进了不在页面上的元素",都不报错.这类契约的正确断言方式就是
 * "把生成的 DOM 拿来按 CSS 用的选择器查一遍".
 *
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import {
    CALENDAR_DATE_CLASS,
    CALENDAR_ITEM_CLASS,
    CALENDAR_LABEL_CLASS,
    CALENDAR_LATIN_CLASS,
    CALENDAR_LIST_CLASS,
    CALENDAR_PANEL_EXTRA_CLASS,
    CALENDAR_PANEL_TITLE,
    CALENDAR_SPECS,
} from '@/calendar/config';
import { createCalendarPanel } from '@/calendar/ui/calendar_panel';
import { CLOCK_HOST_ID } from '@/clock/config';
import { expectNoDuplicateIds, renderPanel } from '@/test_support/panel_test_helpers';

describe('Calendario 页:面板框体(库的 .ui-panel + 标题)', () => {
    it('框体是库的 section.ui-panel,本站只加 .calendar-pane 作用域类', () => {
        const panel = renderPanel(createCalendarPanel);
        expect(panel.root.tagName).toBe('SECTION');
        expect([...panel.root.classList]).toContain('ui-panel');
        expect([...panel.root.classList]).toContain(CALENDAR_PANEL_EXTRA_CLASS);
        expect(panel.root.querySelector('.ui-panel-header')).not.toBeNull();
        expect(panel.root.querySelector('.ui-panel-title')?.textContent)
            .toBe(CALENDAR_PANEL_TITLE);
    });
});

describe('Calendario 页:顶部是 LED 时钟宿主', () => {
    it('时钟宿主是正文的第一个子节点,id 取自 clock/config.ts', () => {
        /*
          时钟从 HOME 首屏搬到这一页顶部,所以它的位置在这条断言里钉死:CSS 与
          "#app_led_clock" 那条面板外观规则,以及 main.ts 转交给 mountClock() 的
          引用,都依赖它确实长在这里(而不是首屏底部).
        */
        const panel = renderPanel(createCalendarPanel);
        const body = panel.root.querySelector('.ui-panel-body');
        expect(body?.firstElementChild).toBe(panel.clockHost);
        expect(panel.clockHost.id).toBe(CLOCK_HOST_ID);
        expect(panel.root.querySelector(`#${CLOCK_HOST_ID}`)).toBe(panel.clockHost);
        // 宿主是空的:画布由 clock 模块的挂载函数长进去,这里不碰
        expect(panel.clockHost.children).toHaveLength(0);
    });
});

describe('Calendario 页:三张日历卡', () => {
    it('数量 / 顺序 / 历法名与 CALENDAR_SPECS 一一对应', () => {
        const panel = renderPanel(createCalendarPanel);
        const items = panel.root.querySelectorAll(`.${CALENDAR_ITEM_CLASS}`);
        expect(items).toHaveLength(CALENDAR_SPECS.length);
        CALENDAR_SPECS.forEach((spec, index) => {
            expect(items[index].querySelector(`.${CALENDAR_LABEL_CLASS}`)?.textContent, spec.key)
                .toBe(spec.label);
        });
    });

    it('卡片都在 .calendar-list 里,且列表排在时钟宿主之后', () => {
        const panel = renderPanel(createCalendarPanel);
        const list = panel.root.querySelector(`.${CALENDAR_LIST_CLASS}`);
        expect(list).not.toBeNull();
        expect(list?.querySelectorAll(`.${CALENDAR_ITEM_CLASS}`))
            .toHaveLength(CALENDAR_SPECS.length);
        // 时钟在上,列表在下:正文的子节点顺序即显示顺序
        const body = panel.root.querySelector('.ui-panel-body');
        expect([...(body?.children ?? [])]).toEqual([panel.clockHost, list]);
    });

    it('每一项都交回两行日期元素,类名即 CSS 契约,而且初始是空的', () => {
        const panel = renderPanel(createCalendarPanel);
        const items = [...panel.root.querySelectorAll(`.${CALENDAR_ITEM_CLASS}`)];
        CALENDAR_SPECS.forEach((spec, index) => {
            const date = panel.dateElements[spec.key];
            const latin = panel.secondaryElements[spec.key];
            // 交回的引用必须是这张卡里的那两个元素:交给行为代码的是引用,
            // 一旦指到别处,日期就写进了别人的卡片(看着"少了一天"却不报错)
            expect(date.closest(`.${CALENDAR_ITEM_CLASS}`), spec.key).toBe(items[index]);
            expect(latin.closest(`.${CALENDAR_ITEM_CLASS}`), spec.key).toBe(items[index]);
            expect([...date.classList], spec.key).toContain(CALENDAR_DATE_CLASS);
            expect([...latin.classList], spec.key).toContain(CALENDAR_LATIN_CLASS);
            // 文案由 calendar.ts 在挂载时填;生成阶段两行都是空的
            expect(date.textContent, spec.key).toBe('');
            expect(latin.textContent, spec.key).toBe('');
        });
    });

    it('整个面板没有重复 id(重复挂载 / 生成两份就会撞)', () => {
        renderPanel(createCalendarPanel);
        expectNoDuplicateIds();
    });
});
