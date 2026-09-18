/**
 * 引擎日志: 统一前缀,方便在控制台一眼筛出 451 的输出去.
 * 只有这一个出口,以后要静音/改成 debug 级别也只动这里.
 */
import { LOG_PREFIX } from './config';

export function log(...args: unknown[]): void {
    console.info(LOG_PREFIX, ...args);
}
