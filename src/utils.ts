export function fmt_time(datetime: Date): string {
    /* 转为字符串后用0填充2位 */
    const year = datetime.getFullYear().toString();
    const month = (datetime.getMonth() + 1).toString().padStart(2, '0');
    const day = datetime.getDate().toString().padStart(2, '0');
    const hours = datetime.getHours().toString().padStart(2, '0');
    const minutes = datetime.getMinutes().toString().padStart(2, '0');
    const seconds = datetime.getSeconds().toString().padStart(2, '0');
    return `${year}.${month}.${day}.${hours}:${minutes}:${seconds}`;
}