/*
Calendario 标签页的标记组件(声明式).

宿主是骨架给的**空窗格**,本函数把整页标记长出来并交回行为代码要用的引用:

    section.ui-panel.calendar-pane            面板框体(库的 createPanel)
      header.ui-panel-header > span.ui-panel-title   "日历"
      div.ui-panel-body
        div#app_led_clock                     顶部:LED 时钟宿主(标签见 clock/config.ts)
        div.calendar-list                     三张日历卡(顺序 = CALENDAR_SPECS)
          div.calendar-item
            div.calendar-item__label          格里高利历 / 农历 / 希伯来历
            div.calendar-item__date           主日期行(空,由 calendar.ts 填)
            div.calendar-item__latin          副日期行(空;没有副行的项由 CSS :empty 收掉)

时钟宿主排在最上面,是因为 LED 时钟从 HOME 首屏底部**搬到了这一页**
(见 src/clock/clock.ts 的文件头):时钟的标记与行为仍归 clock 模块,这里只负责
"在窗格顶部留一颗宿主并把引用交回",不碰画布.

本模块是纯函数:不读页面,不改全局,只把"描述"变成元素并交回引用;插进宿主,
填日期,启动刷新都是 calendar.ts 的事.
*/

import { CLOCK_HOST_ID } from '@/clock/config';
import { create_element, createPanel } from 'miko_ui';

import {
    CALENDAR_DATE_CLASS,
    CALENDAR_ITEM_CLASS,
    CALENDAR_LABEL_CLASS,
    CALENDAR_LATIN_CLASS,
    CALENDAR_LIST_CLASS,
    CALENDAR_PANEL_EXTRA_CLASS,
    CALENDAR_PANEL_TITLE,
    CALENDAR_SPECS,
    type CalendarKey,
} from '@/calendar/config';

/** Calendario 页的标记:行为代码要用的元素都在这里交回,不去 DOM 里查 */
interface CalendarPaneDisplay {
    /** 整块面板:库的 `createPanel` 建的 `section.ui-panel.calendar-pane`(插进窗格的那一个) */
    readonly root: HTMLElement;
    /** 顶部时钟宿主:转交给 `mountClock()` */
    readonly clockHost: HTMLElement;
    /** key -> 主日期行元素(calendar.ts 按 key 写日期,不按位置取) */
    readonly dateElements: Readonly<Record<CalendarKey, HTMLElement>>;
    /** key -> 副日期行元素;没有副行的项会被写成空串,由 CSS 的 `:empty` 收掉 */
    readonly secondaryElements: Readonly<Record<CalendarKey, HTMLElement>>;
}

/** 一张日历卡:历法名 + 主日期行 + 副日期行 */
function createCalendarItem(label: string): {
    readonly item: HTMLDivElement;
    readonly date: HTMLDivElement;
    readonly secondary: HTMLDivElement;
} {
    /*
      dir="auto" 让浏览器按内容的首个强方向字符决定这段文字的方向:希伯来历那行
      含希伯来文,是 RTL 内容,不声明的话它在一个 LTR 容器里会按 Unicode 双向算法
      逐段重排,分隔符的落点取决于相邻字符,读起来是错的顺序.
      格里高利历 / 农历是强 LTR 内容,dir="auto" 对它们等价于默认值.
    */
    const date = create_element(
        { tag: 'div' },
        { class: CALENDAR_DATE_CLASS, dir: 'auto' },
    );
    const secondary = create_element(
        { tag: 'div' },
        { class: CALENDAR_LATIN_CLASS, dir: 'auto' },
    );
    const item = create_element(
        { tag: 'div' },
        { class: CALENDAR_ITEM_CLASS },
        create_element({ tag: 'div' }, { class: CALENDAR_LABEL_CLASS }, label),
        date,
        secondary,
    );
    return { item, date, secondary };
}

/**
 * 按 config.ts 的声明生成整页标记.
 *
 * 三张卡的下标与 CALENDAR_SPECS 一一对应(顺序即显示顺序);两行日期元素先留空,
 * calendar.ts 挂载时立刻填一次,所以不会停在空卡片上.
 */
export function createCalendarPanel(): CalendarPaneDisplay {
    const clockHost = create_element({ tag: 'div' }, { id: CLOCK_HOST_ID });

    const dateElements = {} as Record<CalendarKey, HTMLElement>;
    const secondaryElements = {} as Record<CalendarKey, HTMLElement>;
    const items = CALENDAR_SPECS.map((spec) => {
        const { item, date, secondary } = createCalendarItem(spec.label);
        dateElements[spec.key] = date;
        secondaryElements[spec.key] = secondary;
        return item;
    });

    const root = createPanel({
        title: CALENDAR_PANEL_TITLE,
        class: CALENDAR_PANEL_EXTRA_CLASS,
        body: [clockHost, create_element({ tag: 'div' }, { class: CALENDAR_LIST_CLASS }, ...items)],
    }).element;

    return { root, clockHost, dateElements, secondaryElements };
}
