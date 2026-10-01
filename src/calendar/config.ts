// ================================================================
// 日历(Calendario 标签页)常量配置
//
// 声明式模型:窗格标题,三张日历卡的清单(中文名 + 用哪套历法 + 怎么格式化),
// 以及标记生成用的类名.标记由 ui/calendar_panel.ts 按这里生成,文案由
// calendar_date.ts 按这里格式化,所以"加一套历法"只往 CALENDAR_SPECS 加一条.
//
// 历法不自己算:三套历法(格里高利历 / 农历 / 希伯来历)全部交给
// `Intl.DateTimeFormat()` 的 `-u-ca-` 扩展(见下面 LOCALE 常量).自己写农历或
// 希伯来历的换算表意味着把闰月 / 闰年 / 十九年七闰这些规则抄一份进仓库,
// 抄错是**静默**的(日期差一天,没有任何报错),而 ICU 的表由平台维护.
// ================================================================

/** 一张日历卡的稳定键:交回的元素引用按它索引,不靠下标(加一项不会错位) */
export type CalendarKey = 'gregorian' | 'chinese' | 'hebrew';

/** 一套历法的声明:怎么称呼它(中文名)+ 用哪个语言标记与格式选项渲染 */
export interface CalendarSpec {
    /** 稳定键,见 CalendarKey */
    readonly key: CalendarKey;
    /** 卡片上的中文名(可见文本,全站不用 emoji) */
    readonly label: string;
    /**
     * 主日期行的 BCP-47 语言标记.`-u-ca-` 扩展指定历法:
     * `gregory`(默认)/ `chinese` / `hebrew`.
     */
    readonly locale: string;
    /** 主日期行的 Intl 格式选项 */
    readonly options: Intl.DateTimeFormatOptions;
    /** 副日期行的语言标记;省略 = 这一项没有副行 */
    readonly secondaryLocale?: string;
    readonly secondaryOptions?: Intl.DateTimeFormatOptions;
    /**
     * 副行:在拉丁转写之后再用汉语写一遍(`; ` 分隔),月名查 {@link CALENDAR_HEBREW_MONTHS_ZH}.
     *
     * 希伯来历专用:它的主行是希伯来文原文(`20 בתשרי 5787`),副行是转写
     * (`20 Tishri 5787`),对不看这两套文字的人仍然只是"一串字母 + 数字";
     * 补上汉语才知道那是几月几日.拼法见 calendar_date.ts 的 formatSecondary().
     */
    readonly secondaryChinese?: boolean;
    /**
     * 去掉 ICU 结果里的 `relatedYear`(农历专用).
     *
     * ICU 给中国农历配对了一个格里高利历年,`dateStyle: 'long'` 于是输出
     * `2025乙巳年十一月廿七`:那个 2025 是格里高利历年,与同一张卡上的格里高利历行重复,还给
     * "乙巳年"加了一层容易误读的年份前缀.去掉它剩 `乙巳年十一月廿七`
     * (干支年 + 月 + 日),这正是农历该有的写法 -- 详见 calendar_date.ts 的同名处理.
     */
    readonly dropRelatedYear?: boolean;
    /**
     * 把整数月 / 日补成两位(`2026年01月05日`).
     *
     * 为什么不用 `month: '2-digit'` 交给 Intl:zh-CN 里只要同时要求两位月与两位日,
     * ICU 就切到**短日期骨架**,输出变成 `2026/01/05`(分隔符从"年/月/日"换成了"/");
     * 保住中文骨架的写法是 `month: 'long' + day: 'numeric'`,它给的月 / 日是一位数,
     * 补零只能自己做 -- 见 calendar_date.ts 的 padMonthDayPart().
     */
    readonly padMonthDay?: boolean;
}

/** 格里高利历的语言标记(zh-CN 不带 -u-ca-,默认就是 gregory) */
export const CALENDAR_GREGORIAN_LOCALE = 'zh-CN';

/** 中国农历的语言标记(`-u-ca-chinese`) */
export const CALENDAR_CHINESE_LOCALE = 'zh-CN-u-ca-chinese';

/** 希伯来历的语言标记(`-u-ca-hebrew`).主行用希伯来文写月份(见下面 dateStyle 那条注释) */
export const CALENDAR_HEBREW_LOCALE = 'he-IL-u-ca-hebrew';

/**
 * 希伯来历副行的语言标记:拉丁字母转写 + 阿拉伯数字.
 * 主行的 `כ״ו בטבת תשפ״ו` 只对懂希伯来文的人可读,副行给出同一日期的通用写法.
 */
export const CALENDAR_HEBREW_LATIN_LOCALE = 'en-US-u-ca-hebrew';

/**
 * 希伯来历的月名:ICU 的英文转写 -> 汉译.
 *
 * 为什么需要这张表:CLDR 的 zh 里**没有**希伯来历的月名 -- `zh-CN-u-ca-hebrew` 给出的是
 * `希伯来历5787年01月20日`(月份退化成数字,还多一个没用的"希伯来历"era),所以汉语
 * 月名只能自己带一张表;历法本身(今天是哪个月)仍然问 ICU,这里只做"名字翻译".
 *
 * 键是 `en-US-u-ca-hebrew` 下 `formatToParts()` 的 month part(见 calendar_date.ts
 * 的 formatSecondary).同一个月名在不同 ICU 版本里转写可能不一样(Tishri / Tishrei,
 * Heshvan / Cheshvan,Tamuz / Tammuz),所以变体都收进来当别名;
 * calendar_date.test.ts 会扫一遍 ICU 真实吐出来的月名,表里缺哪个就变红.
 *
 * 闰年有 13 个月,ICU 用 `Adar I` / `Adar II` 区分,所以表里是 14 条 + 3 条别名.
 * 查不到时**不猜**:副行退回纯转写(见 calendar_date.ts),宁可少一段汉语,
 * 也不要写一个错的月名.
 */
export const CALENDAR_HEBREW_MONTHS_ZH: Readonly<Record<string, string>> = {
    Tishri: '提斯利月',
    Tishrei: '提斯利月',
    Heshvan: '玛西班月',
    Cheshvan: '玛西班月',
    Kislev: '基斯流月',
    Tevet: '提别月',
    Shevat: '细罢特月',
    Adar: '亚达月',
    'Adar I': '亚达月一',
    'Adar II': '亚达月二',
    Nisan: '尼散月',
    Iyar: '以珥月',
    Sivan: '西弯月',
    Tamuz: '搭模斯月',
    Tammuz: '搭模斯月',
    Av: '埃波月',
    Elul: '以禄月',
};

/**
 * 三张日历卡,顺序即显示顺序(格里高利历 / 农历 / 希伯来历).
 *
 * 值都是 `Intl.DateTimeFormat` 的选项,所以格式的取舍写在数据里而不是代码里.
 * Intl 选项表达不了的三处收尾用布尔开关标在同一张卡上:农历裁格里高利历年
 * (`dropRelatedYear`),格里高利历的月 / 日补零(`padMonthDay`),希伯来历副行补汉语
 * (`secondaryChinese`).
 * 格里高利历拆成"日期 + 星期"两行(合在一起是 `2026年01月15日星期四`,星期会黏在日期后面);
 * 农历只要干支年 + 月 + 日;希伯来历主行原文,副行转写 + 汉译.
 *
 * 标成 `readonly CalendarSpec[]`(而不是 `as const`):每一项的字段并不完全一样
 * (只有农历裁 relatedYear,只有希伯来历有副行),统一成声明的接口类型,消费方
 * 读可选字段时才不需要逐项判断"这个字面量有没有这个属性".
 */
export const CALENDAR_SPECS: readonly CalendarSpec[] = [
    {
        key: 'gregorian',
        label: '格里高利历',
        locale: CALENDAR_GREGORIAN_LOCALE,
        // `month: 'long'` 才是中文的"年/月/日"骨架(两位月会切到 `/` 那套,见 padMonthDay)
        options: { year: 'numeric', month: 'long', day: 'numeric' },
        padMonthDay: true,
        secondaryLocale: CALENDAR_GREGORIAN_LOCALE,
        secondaryOptions: { weekday: 'long' },
    },
    {
        key: 'chinese',
        label: '农历',
        locale: CALENDAR_CHINESE_LOCALE,
        // dateStyle: long 才会把日写成"廿七"这类农历用字;逐字段给选项时
        // day: 'numeric' 出的是阿拉伯数字 27.
        options: { dateStyle: 'long' },
        dropRelatedYear: true,
    },
    {
        key: 'hebrew',
        label: '希伯来历',
        locale: CALENDAR_HEBREW_LOCALE,
        /*
          逐字段给选项,不用 dateStyle -- 这不是风格取舍,是实测出来的引擎差异.

          Chromium 里 `he-IL-u-ca-hebrew` + dateStyle(full/long/medium/short 都一样)
          输出 `57870120 10:36 PM`:formatToParts 显示它拿到的是
          year/month/day + hour/minute/dayPeriod -- 也就是一份"日期 + 时间"的模式,
          月被渲染成数字 01,日时段还是英文 PM.而逐字段的 `{year, month, day}` 给出
          `20 בתשרי 5787`(希伯来文月名),两个引擎一致.

          边界是 (he 语言标记 × hebrew 历法) 这一对,不是"非公历历法"这一类:
          同一个 Chromium 里 `en-US-u-ca-hebrew`,`ar-SA-u-ca-islamic-umalqura`,
          `zh-CN-u-ca-chinese`,`ja-JP-u-ca-japanese` 的 dateStyle 都正常,
          `he-IL` 走默认 gregory 也正常.只有这一对取不到可用的 dateStyle 模式,
          ICU 就回退到根(英文)那套默认的"日期 + 时间"骨架.

          Node 的完整 ICU 两种写法都对,所以这个坑在 `npm test` 里看不见 --
          真机断言在 scripts/smoke_home.mjs 的"日历页"那几条.
        */
        options: { year: 'numeric', month: 'long', day: 'numeric' },
        secondaryLocale: CALENDAR_HEBREW_LATIN_LOCALE,
        secondaryOptions: { year: 'numeric', month: 'long', day: 'numeric' },
        // 转写后面补汉语:`20 Tishri 5787; 5787年提斯利月20日`
        secondaryChinese: true,
    },
];

// ---------- 面板标记契约(ui/calendar_panel.ts 用) ----------
//
// 标签 / 类名直接决定 public/css/index.css 的命中,所以字符串一字不改.
// 框体(section.ui-panel + 标题栏 + 正文容器)由 miko_ui 的 `createPanel` 建,
// 类名归库,本站只留下面这些作用域类.

/** 面板标题(可见文本) */
export const CALENDAR_PANEL_TITLE = '日历';

/** 本站给面板根追加的作用域类(CSS 的 .calendar-pane 定宽) */
export const CALENDAR_PANEL_EXTRA_CLASS = 'calendar-pane';

/** 三张卡片组成的列表容器类名(CSS 的 .calendar-list 给网格间距) */
export const CALENDAR_LIST_CLASS = 'calendar-list';

/** 单张日历卡的类名(CSS 的 .calendar-item 给底色 / 描边 / 内边距) */
export const CALENDAR_ITEM_CLASS = 'calendar-item';

/** 卡片上历法名的类名(CSS 的 .calendar-item__label) */
export const CALENDAR_LABEL_CLASS = 'calendar-item__label';

/** 主日期行的类名(CSS 的 .calendar-item__date) */
export const CALENDAR_DATE_CLASS = 'calendar-item__date';

/**
 * 副日期行的类名(CSS 的 .calendar-item__latin).
 * 没有副行的日历(农历)把它填成空串,由 CSS 的 `:empty` 把整行收掉.
 */
export const CALENDAR_LATIN_CLASS = 'calendar-item__latin';

// ---------- 时序 ----------

/**
 * 跨日刷新的宽限(毫秒).
 *
 * 日期一天只变一次,所以这里不像 LED 时钟那样按秒轮询,而是睡到下个本地零点
 * (算法见 calendar_date.ts 的 msUntilNextLocalMidnight).多睡这一秒是给
 * "定时器比系统时钟早醒"留的余量,免得刚好在零点边上算出前一天的日期.
 */
export const CALENDAR_MIDNIGHT_GRACE_MS = 1000;
