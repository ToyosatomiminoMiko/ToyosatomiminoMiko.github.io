/**
 * 引擎日志: 统一前缀, 方便在控制台一眼筛出 451 的输出去.
 * 这是引擎唯一的日志出口(console.info).
 */
import { LOG_PREFIX } from './config';

export function log(...args: unknown[]): void {
    console.info(LOG_PREFIX, ...args);
}
