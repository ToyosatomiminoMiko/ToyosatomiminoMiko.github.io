/*
2026.01.15.00:00:00
三套历法的日期格式化(纯函数,可单测).

为什么把格式化单独放一层:`Intl.DateTimeFormat` 是"一套历法一次构造,之后反复
format"的对象,构造它(加载 ICU 数据)比 format 贵得多;日期又只在跨日时变.
所以构造一次就存住(下面的 PREPARED),由 calendar.ts 每次跨日 format 一遍.

历法换算全部交给平台的 ICU(见 config.ts 的 CALENDAR_SPECS):本模块只负责
"选项拼装"与"农历那处 relatedYear 的裁剪",不含任何闰月 / 闰年规则.
*/

import { CALENDAR_SPECS, type CalendarKey } from './config';

/** 一次读取的结果:某套历法在该时刻的两行文案 */
export interface CalendarReading {
    /** 与 CALENDAR_SPECS 的 key 一一对应(行为代码按它写回元素) */
    readonly key: CalendarKey;
    /** 主日期行(永不为空) */
    readonly primary: string;
    /** 副日期行;空串 = 这一项没有副行(元素由 CSS 的 `:empty` 收掉) */
    readonly secondary: string;
}

/**
 * 备好的格式化器:构造期建一次,之后只 format.
 * 与 CALENDAR_SPECS 同序,`readCalendars()` 原样按序返回,所以两边不会错位.
 */
const PREPARED = CALENDAR_SPECS.map((spec) => ({
    key: spec.key,
    primary: new Intl.DateTimeFormat(spec.locale, spec.options),
    secondary:
        spec.secondaryLocale === undefined
            ? null
            : new Intl.DateTimeFormat(spec.secondaryLocale, spec.secondaryOptions),
    dropRelatedYear: spec.dropRelatedYear === true,
}));

/**
 * 读出三套历法在该时刻的日期文案,顺序与 CALENDAR_SPECS 一致.
 *
 * @param date 要格式化的时刻(用本地时区 -- 历法日期本来就是按当地时间算的)
 */
export function readCalendars(date: Date): readonly CalendarReading[] {
    return PREPARED.map((entry) => ({
        key: entry.key,
        primary: entry.dropRelatedYear
            ? formatWithoutRelatedYear(entry.primary, date)
            : entry.primary.format(date),
        secondary: entry.secondary === null ? '' : entry.secondary.format(date),
    }));
}

/**
 * 农历:去掉 ICU 配对的格里高利历年(`relatedYear`),保留干支年 + 月 + 日.
 *
 * 例:`dateStyle: 'long'` 的中国农历输出是 `2025乙巳年十一月廿七`(parts 依次是
 * relatedYear=2025 / yearName=乙巳 / 字面量 年 / 月 / 日).这里的 2025 是格里高利历年,
 * 与同一页的格里高利历行重复,还让"乙巳年"看起来像 2025 的附属;裁掉它才是农历写法.
 *
 * 只在真的拿到 `yearName` 时才裁:拿不到(ICU 的历法数据换了形态)就退回 ICU
 * 原样输出 -- 宁可多一个格里高利历年,也不要拼出"年十一月廿七"这种半截文案.
 */
function formatWithoutRelatedYear(formatter: Intl.DateTimeFormat, date: Date): string {
    const parts = formatter.formatToParts(date);
    if (!parts.some((part) => partType(part) === 'yearName')) {
        return formatter.format(date);
    }
    return parts
        .filter((part) => partType(part) !== 'relatedYear')
        .map((part) => part.value)
        .join('');
}

/**
 * `part.type` 收窄成 string 再比较.
 *
 * `Intl.DateTimeFormatPartTypesRegistry`(TS 的 ES2020 lib)里只有 date / time /
 * timeZoneName 这些通用类型,**没有** yearName / relatedYear -- 它们是历法扩展
 * 才会出现的 part.直接与字面量比较会被 TS 判成"两个类型不相交"(TS2367).
 * 这里只放宽类型,不改变运行期行为.
 */
function partType(part: Intl.DateTimeFormatPart): string {
    return part.type;
}

/**
 * 从 `now` 到下一个**本地**零点的毫秒数(永远 > 0).
 *
 * 用 `new Date(y, m, d + 1)` 而不是"当天零点 + 24 小时":日期构造器按本地时间
 * 归一化,会自动处理跨月 / 跨年,以及夏令时(某些时区的零点会被跳过,归一化到
 * 那一分钟之后的第一个真实时刻).加 24 小时在夏令时切换那天会差一小时,
 * 表现是"那一天日期晚了一小时才刷新".
 */
export function msUntilNextLocalMidnight(now: Date): number {
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return nextMidnight.getTime() - now.getTime();
}
