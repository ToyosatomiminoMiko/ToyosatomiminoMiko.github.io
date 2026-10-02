/*
2026.10.01.22:50:00
日历页面:把三套历法的日期填进面板,并在跨日时刷新;顺带交回顶部的时钟宿主.

标记全部由 ui/calendar_panel.ts 生成(`createCalendarPanel()`),本文件只做行为:
把交回的日期元素写上文案,并安排"下一个本地零点"那次刷新(见 config.ts 的
CALENDAR_MIDNIGHT_GRACE_MS).

为什么不按秒轮询:日期只在跨日时变.时钟必须 1Hz(它显示到秒,见 clock.ts),
日历不是;算到下个零点再醒一次,一天只做一次工作,也不用每秒比对文案.

时钟宿主是这一页交回给 main.ts 的:LED 时钟从 HOME 首屏搬到了这一页顶部,
但时钟自己的标记与行为仍然只在 src/clock/ 里(挂载函数只认宿主,不认页面).
*/

import { msUntilNextLocalMidnight, readCalendars } from './calendar_date';
import { CALENDAR_MIDNIGHT_GRACE_MS } from './config';
import { createCalendarPanel } from './ui/calendar_panel';

/** 挂载后交回的元素引用(骨架只给空窗格,面板由本模块长出来) */
interface CalendarPane {
    /** 整块面板(`section.ui-panel.calendar-pane`) */
    readonly root: HTMLElement;
    /** 顶部时钟宿主 -> `mountClock()` */
    readonly clockHost: HTMLElement;
}

/**
 * 把日历页挂到宿主窗格上.
 *
 * @param host 标签页窗格(`#calendar`,由骨架建好,只提供空位):面板会**整体接管**
 *             宿主内容,所以重复挂载不会插两份.
 * @returns 面板根与顶部时钟宿主,后者由 main.ts 交给 `mountClock()`.
 */
export function mountCalendar(host: HTMLElement): CalendarPane {
    const display = createCalendarPanel();
    // 宿主由本模块独占,用 replaceChildren 整体接管而不是 append(重复挂载不留两份)
    host.replaceChildren(display.root);

    /** 按当前时刻写三张卡的两行日期;每行元素都来自面板交回的引用,不查 DOM */
    const render = (date: Date): void => {
        for (const reading of readCalendars(date)) {
            display.dateElements[reading.key].textContent = reading.primary;
            // 空串 = 这一项没有副行,CSS 的 `.calendar-item__latin:empty` 会把整行收掉
            display.secondaryElements[reading.key].textContent = reading.secondary;
        }
    };

    /*
      跨日刷新:先画一次(否则要等到下个零点才有内容),再睡到下个本地零点.
      醒来后重新算"下一个零点"而不是固定加 24 小时 -- 夏令时那天本地一天不是
      86400 秒,固定加会漂(见 calendar_date.ts 的 msUntilNextLocalMidnight).
    */
    const scheduleNextDay = (): void => {
        window.setTimeout(() => {
            render(new Date());
            scheduleNextDay();
        }, msUntilNextLocalMidnight(new Date()) + CALENDAR_MIDNIGHT_GRACE_MS);
    };

    render(new Date());
    scheduleNextDay();

    return { root: display.root, clockHost: display.clockHost };
}
