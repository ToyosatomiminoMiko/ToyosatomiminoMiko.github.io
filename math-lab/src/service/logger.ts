/**
 * 项目统一日志出口.
 * 后续新增代码不要直接使用 console.log/warn/error,统一从这里调用.
 */

function isDev(): boolean {
    const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
    return env?.DEV === true;
}

export function logDebug(...args: unknown[]): void {
    if (isDev()) console.log(...args);
}

export function logWarning(context: string, ...args: unknown[]): void {
    console.warn(`[${context}]`, ...args);
}

export function logError(context: string, ...args: unknown[]): void {
    console.error(`[${context}]`, ...args);
}
