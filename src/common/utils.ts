/**
 * 时间格式化:输出 `YYYY.MM.DD.HH:MM:SS`.
 *
 * 用本地时区(不取 UTC):这是给人看的时间戳,站点所有日志按它对齐.
 */
export function fmt_time(datetime: Date): string {
    const pad = (value: number): string => value.toString().padStart(2, '0');
    const year = datetime.getFullYear().toString();
    // getMonth() 从 0 起算,所以 +1 才是月份
    const month = pad(datetime.getMonth() + 1);
    const day = pad(datetime.getDate());
    const hours = pad(datetime.getHours());
    const minutes = pad(datetime.getMinutes());
    const seconds = pad(datetime.getSeconds());
    return `${year}.${month}.${day}.` + `${hours}:${minutes}:${seconds}`;
}
