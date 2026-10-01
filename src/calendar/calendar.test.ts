/**
 * Calendario 页挂载行为的回归网(进程内,跑在 happy-dom 里).
 *
 * 与 ui/calendar_panel.test.ts 的分工:那边管"生成的标记长什么样"(类名 / id /
 * 结构位置,CSS 按它们命中),这边管"挂上去之后日期有没有填,跨日有没有重画,
 * 以及时钟宿主能不能真的交给 clock 模块".
 *
 * 时间用 vitest 的假定时器固定住(mountCalendar 的首次渲染读 `new Date()`,
 * 跨日刷新则是一个 setTimeout):不固定的话,"日期对不对"这条断言会在午夜前后
 * 随机红.假定时器同时接管 Date 与 setTimeout,所以推进时间就等于让那一天真的过去.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountCalendar } from '@/calendar/calendar';
import { msUntilNextLocalMidnight, readCalendars } from '@/calendar/calendar_date';
import {
    CALENDAR_DATE_CLASS,
    CALENDAR_LATIN_CLASS,
    CALENDAR_MIDNIGHT_GRACE_MS,
    CALENDAR_SPECS,
    type CalendarKey,
} from '@/calendar/config';
import { mountClock } from '@/clock/clock';
import { CLOCK_CANVAS_ID, CLOCK_HOST_ID } from '@/clock/config';

/** 固定的取样时刻:2026-01-15(周四)13:45:30 本地时间 */
const SAMPLE = new Date(2026, 0, 15, 13, 45, 30);

/** 建一颗空窗格(与 main.ts 拿到的那一颗同形) */
function setupHost(): HTMLElement {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.id = 'calendar';
    document.body.append(host);
    return host;
}

/** 宿主里某张卡的某一行(按 key 取,不靠下标) */
function lineOf(host: HTMLElement, key: CalendarKey, selector: string): HTMLElement {
    const index = CALENDAR_SPECS.findIndex((spec) => spec.key === key);
    const line = host.querySelectorAll(selector)[index];
    if (!(line instanceof HTMLElement)) throw new Error(`没有第 ${index} 个 ${selector}`);
    return line;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SAMPLE);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('日历页:挂载', () => {
    it('整体接管宿主窗格,重复挂载不会插两份', () => {
        const host = setupHost();
        const calendar = mountCalendar(host);
        expect(host.children).toHaveLength(1);
        expect(host.firstElementChild).toBe(calendar.root);
        mountCalendar(host);
        expect(host.children).toHaveLength(1);
        expect(host.querySelectorAll('.ui-panel')).toHaveLength(1);
    });

    it('挂载当场就把三张卡的日期填好(不停在空卡片上)', () => {
        const host = setupHost();
        mountCalendar(host);
        for (const reading of readCalendars(SAMPLE)) {
            expect(lineOf(host, reading.key, `.${CALENDAR_DATE_CLASS}`).textContent, reading.key)
                .toBe(reading.primary);
            expect(lineOf(host, reading.key, `.${CALENDAR_LATIN_CLASS}`).textContent, reading.key)
                .toBe(reading.secondary);
        }
        // 农历没有副行:空串是刻意的,CSS 的 `:empty` 靠它把整行收掉
        expect(lineOf(host, 'chinese', `.${CALENDAR_LATIN_CLASS}`).textContent).toBe('');
    });

    it('跨日之后日期自己变(不需要刷新页面)', () => {
        const host = setupHost();
        mountCalendar(host);
        expect(lineOf(host, 'gregorian', `.${CALENDAR_DATE_CLASS}`).textContent)
            .toBe('2026年1月15日');
        // 假定时器推进:走到 mountCalendar 安排的那次跨日刷新(延时 = 到下个零点 + 宽限)
        vi.advanceTimersByTime(msUntilNextLocalMidnight(SAMPLE) + CALENDAR_MIDNIGHT_GRACE_MS);
        expect(lineOf(host, 'gregorian', `.${CALENDAR_DATE_CLASS}`).textContent)
            .toBe('2026年1月16日');
        expect(lineOf(host, 'chinese', `.${CALENDAR_DATE_CLASS}`).textContent)
            .toBe(readCalendars(new Date(2026, 0, 16, 0, 0, 1)).find(
                (reading) => reading.key === 'chinese',
            )?.primary);
    });
});

describe('日历页:顶部的时钟宿主', () => {
    it('交给 clock 模块后,时钟画布真的长进了这一页(.ui-panel-body > #app_led_clock > canvas)', () => {
        /*
          这是"时钟从 HOME 搬到 Calendario"那条改动的端到端接线:日历页交回的宿主
          必须就是文档里那一颗,而 clock 模块把它换成画布 -- 两件事都在这一步验.
          happy-dom 的 canvas.getContext('2d') 返回 null,所以 clock.ts 插完画布
          就返回(这里不断言像素,像素留给 scripts/smoke_home.mjs).
        */
        const host = setupHost();
        const calendar = mountCalendar(host);
        mountClock(calendar.clockHost);
        expect(calendar.clockHost.id).toBe(CLOCK_HOST_ID);
        expect(host.querySelector(`.ui-panel-body > #${CLOCK_HOST_ID}`)).toBe(calendar.clockHost);
        expect(host.querySelector(`#${CLOCK_HOST_ID} > canvas#${CLOCK_CANVAS_ID}`)).not.toBeNull();
    });
});
