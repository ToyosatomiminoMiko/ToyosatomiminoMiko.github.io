/*
2026.01.15.00:00:00
三套历法的日期格式化(纯函数,可单测).

为什么把格式化单独放一层:`Intl.DateTimeFormat` 是"一套历法一次构造,之后反复
format"的对象,构造它(加载 ICU 数据)比 format 贵得多;日期又只在跨日时变.
所以构造一次就存住(下面的 PREPARED),由 calendar.ts 每次跨日 format 一遍.

历法换算与排版骨架全部交给平台的 ICU(见 config.ts 的 CALENDAR_SPECS),本模块只做
三件事:
  1. 构造期把三套历法的格式化器建好(下面的 PREPARED),之后只 format,不重复付构造的价;
  2. 农历裁掉 ICU 配对的格里高利历年(relatedYear);
  3. 格里高利历把一位数的月 / 日补成两位(`2026年1月5日` -> `2026年01月05日`).
第 2 / 3 件事都是 Intl 选项表达不了的收尾,所以要过 formatToParts 自己拼回字符串
(为什么不用 `month: '2-digit'`,见下面 padMonthDayPart 的注释).本模块不含任何
闰月 / 闰年规则.
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
 * 备好的一条:`readCalendars()` 按这里的顺序返回,所以与 CALENDAR_SPECS 不会错位
 */
interface PreparedCalendar {
    /** 与 CALENDAR_SPECS 的 key 一一对应(行为代码按它写回元素) */
    readonly key: CalendarKey;
    /** 主日期行的格式化器 */
    readonly primary: Intl.DateTimeFormat;
    /** 副日期行的格式化器;`null` = 这一项没有副行 */
    readonly secondary: Intl.DateTimeFormat | null;
    /** 主行要不要裁掉 relatedYear(来历见 config.ts 的同名字段) */
    readonly dropRelatedYear: boolean;
    /** 主行要不要把月 / 日补成两位(来历见 config.ts 的同名字段) */
    readonly padMonthDay: boolean;
}

const PREPARED: readonly PreparedCalendar[] = CALENDAR_SPECS.map((spec) => ({
    key: spec.key,
    primary: new Intl.DateTimeFormat(spec.locale, spec.options),
    secondary:
        spec.secondaryLocale === undefined
            ? null
            : new Intl.DateTimeFormat(spec.secondaryLocale, spec.secondaryOptions),
    dropRelatedYear: spec.dropRelatedYear === true,
    padMonthDay: spec.padMonthDay === true,
}));

/**
 * 读出三套历法在该时刻的日期文案,顺序与 CALENDAR_SPECS 一致.
 *
 * @param date 要格式化的时刻(用本地时区 -- 历法日期本来就是按当地时间算的)
 */
export function readCalendars(date: Date): readonly CalendarReading[] {
    return PREPARED.map((entry) => ({
        key: entry.key,
        primary: formatPrimary(entry, date),
        secondary: entry.secondary === null ? '' : entry.secondary.format(date),
    }));
}

/**
 * 主日期行:先按 spec 交给 ICU,再做它自己表达不了的两处收尾.
 *
 * 两个开关都按 part 判断(不按字符串),所以开了任意一个就统一走 formatToParts,
 * 再按 part 顺序拼回;两个都没开的历法(希伯来历)直接 format,不绕这一圈.
 */
function formatPrimary(entry: PreparedCalendar, date: Date): string {
    if (!entry.dropRelatedYear && !entry.padMonthDay) {
        return entry.primary.format(date);
    }

    const parts = entry.primary.formatToParts(date);
    /*
      农历:只在真的拿到 `yearName` 时才裁 `relatedYear`.拿不到(ICU 的历法数据换了
      形态)就整段保留 -- 宁可多一个格里高利历年,也不要拼出"年十一月廿七"这种半截文案.
    */
    const dropRelated = entry.dropRelatedYear
        && parts.some((part) => partType(part) === 'yearName');

    return parts
        .filter((part) => !(dropRelated && partType(part) === 'relatedYear'))
        .map((part) => (entry.padMonthDay ? padMonthDayPart(part) : part.value))
        .join('');
}

/**
 * 整数月 / 日补零成两位:`1` -> `01`,`15` 还是 `15`.
 *
 * 为什么不把补零写进 Intl 选项:zh-CN 里 `month: '2-digit'` + `day: '2-digit'`
 * 会让 ICU 切到**短日期骨架**,输出成了 `2026/01/05` -- 分隔符从"年 / 月 / 日"
 * 变成了 `/`,整个排版都换了;能保住中文骨架的只有 `month: 'long' + day: 'numeric'`
 * (输出 `2026年1月5日`),而它给的就是一位数.所以补零只能在 formatToParts 之后做.
 *
 * 只动 `month` / `day` 两个 part,且只动纯数字的值:农历的 `廿七`,希伯来文的月名,
 * 以及 `年` / `月` / `日` 这些字面量,都原样返回.
 */
function padMonthDayPart(part: Intl.DateTimeFormatPart): string {
    const type = partType(part);
    if (type !== 'month' && type !== 'day') return part.value;
    return /^\d+$/.test(part.value) ? part.value.padStart(2, '0') : part.value;
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
