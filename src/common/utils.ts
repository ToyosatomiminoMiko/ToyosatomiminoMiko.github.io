// ================================================================
// 时间格式化(clock/clock.ts 使用)的常量配置
//
// 这里常量很少,按项目约定不必单独建 `clock/fmt_time.config.ts`,
// 直接在模块顶部具名化;数值与原字面量逐位一致,输出格式不变.
// ================================================================

/** 月/日/时/分/秒的补零宽度(位):不足两位前面补 0 */
const PAD_WIDTH = 2;

/** 补零字符 */
const PAD_CHAR = '0';

/**
 * `Date.getMonth()` 返回 0-11(0 = 一月),
 * 转成人类习惯的 1-12 需要加上的偏移.
 */
const MONTH_INDEX_OFFSET = 1;

/** 年/月/日/时之间的分隔符(与站点其它时间戳写法一致) */
const DATE_SEPARATOR = '.';

/** 时/分/秒之间的分隔符 */
const TIME_SEPARATOR = ':';

export function fmt_time(datetime: Date): string {
    /* 转为字符串后用 0 填充到 PAD_WIDTH 位 */
    const pad = (value: number): string => value.toString().padStart(PAD_WIDTH, PAD_CHAR);
    const year = datetime.getFullYear().toString();
    const month = pad(datetime.getMonth() + MONTH_INDEX_OFFSET);
    const day = pad(datetime.getDate());
    const hours = pad(datetime.getHours());
    const minutes = pad(datetime.getMinutes());
    const seconds = pad(datetime.getSeconds());
    return `${year}${DATE_SEPARATOR}${month}${DATE_SEPARATOR}${day}${DATE_SEPARATOR}` +
        `${hours}${TIME_SEPARATOR}${minutes}${TIME_SEPARATOR}${seconds}`;
}
