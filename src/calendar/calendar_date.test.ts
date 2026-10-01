/**
 * 三套历法的日期格式化与跨日调度的回归网(纯函数,不需要 DOM).
 *
 * 这里钉两类东西:
 *   1. **格式化结果** -- `Intl.DateTimeFormat` 的历法扩展(`-u-ca-`)在换 Node /
 *      换 ICU 版本时有可能变,浏览器与 Node 也会不一样(希伯来历主行为什么逐字段
 *      给选项,不用 dateStyle,见 config.ts 里那条实测差异).所以断言分两档:
 *      格里高利历 / 农历钉完整文案(它们是本页的主要可读内容,变了必须有人看一眼),
 *      希伯来历钉"月份是希伯来文 + 年份 / 日是可读数字 + 副行拉丁转写"这三条形态;
 *   2. **跨日调度** -- `msUntilNextLocalMidnight()` 必须跨月 / 跨年都算对,而且
 *      恒为正(它是 `setTimeout` 的延时,算成 0 或负数就是"每秒刷一次"的死循环).
 */
import { describe, expect, it } from 'vitest';

import { readCalendars, msUntilNextLocalMidnight } from '@/calendar/calendar_date';
import {
    CALENDAR_HEBREW_LATIN_LOCALE,
    CALENDAR_HEBREW_MONTHS_ZH,
    CALENDAR_SPECS,
    type CalendarKey,
} from '@/calendar/config';

/** 固定的取样时刻:2026-01-15(周四)13:45:30 本地时间 */
const SAMPLE = new Date(2026, 0, 15, 13, 45, 30);

/** 按 key 取一次读取结果,读起来比下标清楚 */
function readingOf(date: Date, key: CalendarKey) {
    const reading = readCalendars(date).find((candidate) => candidate.key === key);
    if (!reading) throw new Error(`CALENDAR_SPECS 里没有 ${key}`);
    return reading;
}

describe('日历:三套历法的格式化', () => {
    it('顺序与 CALENDAR_SPECS 一致,每项主行都非空', () => {
        const readings = readCalendars(SAMPLE);
        expect(readings.map((reading) => reading.key))
            .toEqual(CALENDAR_SPECS.map((spec) => spec.key));
        for (const reading of readings) {
            expect(reading.primary.length, reading.key).toBeGreaterThan(0);
        }
    });

    it('格里高利历:日期行 + 星期副行(locale 不带 -u-ca-,默认就是 gregory)', () => {
        const gregorian = readingOf(SAMPLE, 'gregorian');
        expect(gregorian.primary).toBe('2026年01月15日');
        expect(gregorian.secondary).toBe('星期四');
    });

    it('格里高利历:月 / 日补零成两位(不是 Intl 选项给的,是 formatToParts 之后补的)', () => {
        // 1 月 5 日:两位月与两位日都要 0 补齐;`month: '2-digit'` 那条路会切成 `2026/01/05`
        expect(readingOf(new Date(2026, 0, 5), 'gregorian').primary).toBe('2026年01月05日');
        // 已经是两位数的不动
        expect(readingOf(new Date(2026, 10, 15), 'gregorian').primary).toBe('2026年11月15日');
    });

    it('农历:干支年 + 月 + 日,且裁掉 ICU 配对的格里高利历年(relatedYear)', () => {
        const chinese = readingOf(SAMPLE, 'chinese');
        // ICU 的原样输出是 `2025乙巳年十一月廿七`:这里的 2025 是格里高利历年,裁掉才对
        expect(chinese.primary).toBe('乙巳年十一月廿七');
        expect(chinese.primary).not.toContain('2025');
        // 农历没有副行:空串由 CSS 的 `:empty` 收掉(见 ui/calendar_panel.ts)
        expect(chinese.secondary).toBe('');
    });

    it('农历闰月也照 ICU 的表走(闰六月),不在本仓库里自算', () => {
        // 2025-07-25 落在乙巳年闰六月初一(可见"闰"字来自 ICU,不是本站拼的)
        expect(readingOf(new Date(2025, 6, 25), 'chinese').primary).toBe('乙巳年闰六月初一');
    });

    it('希伯来历:月份用希伯来文,日 / 年是可读数字;副行是拉丁转写 + 汉语', () => {
        const hebrew = readingOf(SAMPLE, 'hebrew');
        expect(hebrew.primary).toContain('בטבת'); // 提别月(Tevet),希伯来文
        expect(hebrew.primary).toContain('5786'); // 希伯来历年份
        // 月份必须是希伯来字母:整行退化成纯数字 + 时间(Chromium 对 dateStyle 的表现)
        // 是这条断言要挡住的那种"看着有内容,其实是乱码"
        expect(hebrew.primary).toMatch(/[\u0590-\u05FF]/);
        expect(hebrew.primary).not.toContain(':');
        // 副行 = 转写 + `; ` + 汉语(年 / 日复用的是转写那一行的数字)
        expect(hebrew.secondary).toBe('26 Tevet 5786; 5786年提别月26日');
    });

    it('希伯来历:闰年的 Adar I / Adar II 在汉语里分得开(亚达月一 / 亚达月二),日补零', () => {
        // 5784 是闰年:2024-02-10 落在一个亚达月,2024-03-11 落在另一个;两处都是"1 日",
        // 汉译要写成 `01日`(月名自带一个"一",后面直接跟 `1` 会读不断句)
        expect(readingOf(new Date(2024, 1, 10), 'hebrew').secondary)
            .toBe('1 Adar I 5784; 5784年亚达月一01日');
        expect(readingOf(new Date(2024, 2, 11), 'hebrew').secondary)
            .toBe('1 Adar II 5784; 5784年亚达月二01日');
    });

    it('希伯来历:ICU 在近四年里吐出来的每个英文月名,汉译表里都有', () => {
        /*
          这条是月名表的**契约**:表是手抄的,ICU 换一版 CLDR 可能改转写(比如
          Tammuz / Tamuz).扫一遍真实输出,表里缺谁就红,免得线上静默退回纯转写.
          顺带要求扫到的月名够多(闰年才会出现的 Adar I / II 必须在),否则这条断言
          可能因为扫描区间太短而形同虚设.
        */
        const formatter = new Intl.DateTimeFormat(CALENDAR_HEBREW_LATIN_LOCALE, {
            year: 'numeric', month: 'long', day: 'numeric',
        });
        const monthNames = new Set<string>();
        for (let day = new Date(2023, 0, 1); day < new Date(2027, 0, 1);
            day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
            const month = formatter.formatToParts(day).find((part) => part.type === 'month');
            if (month) monthNames.add(month.value);
        }
        expect(monthNames.size).toBeGreaterThanOrEqual(14); // 12 个月 + 闰年的 Adar I / II
        expect([...monthNames].filter((name) => CALENDAR_HEBREW_MONTHS_ZH[name] === undefined))
            .toEqual([]);
    });

    it('同一天读两次结果相同(格式化器被复用,不掺随机状态)', () => {
        expect(readCalendars(SAMPLE)).toEqual(readCalendars(new Date(SAMPLE.getTime())));
    });
});

describe('日历:跨日刷新的延时', () => {
    it('从当天任意时刻到下个本地零点', () => {
        // 13:45:30 -> 次日 00:00:00 = 10 小时 14 分 30 秒
        expect(msUntilNextLocalMidnight(SAMPLE)).toBe(10 * 3600_000 + 14 * 60_000 + 30_000);
    });

    it('跨月(the 31st -> 下月 1 日)', () => {
        expect(msUntilNextLocalMidnight(new Date(2026, 0, 31, 23, 59, 59))).toBe(1000);
    });

    it('跨年(12-31 -> 次年 1-1)', () => {
        expect(msUntilNextLocalMidnight(new Date(2025, 11, 31, 12, 0, 0))).toBe(12 * 3600_000);
    });

    it('刚好在零点时给出的是**下一个**零点(整整一天),不是 0', () => {
        // 0 会让 calendar.ts 的 setTimeout 立即回调,退化成"不停刷新"的死循环
        const midnight = new Date(2026, 5, 10, 0, 0, 0);
        expect(msUntilNextLocalMidnight(midnight)).toBe(24 * 3600_000);
    });
});
