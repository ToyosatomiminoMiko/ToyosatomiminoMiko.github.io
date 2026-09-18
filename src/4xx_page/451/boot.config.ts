/**
 * 451 启动流程(boot.ts)的常量.
 * 从 boot.ts 抽出: 超时 / 开关参数 / 状态上报键名与取值.
 */

/** 个别驱动上 requestAdapter/requestDevice 会长时间不返回, 超时就按失败处理(ms) */
export const INIT_TIMEOUT_MS = 8000;

/** 画布元素 id */
export const CANVAS_ID = 'emberCanvas';

/** 关闭绘制的地址栏参数(?nogpu=1) */
export const DISABLE_QUERY_PARAM = 'nogpu';

/** 打开性能 HUD 的地址栏参数(?perf=1) */
export const PERF_QUERY_PARAM = 'perf';

/** 控制台摘要的限频间隔(ms), 免得刷屏 */
export const PERF_LOG_INTERVAL_MS = 1000;

/** 控制台摘要前缀 */
export const PERF_LOG_PREFIX = '[451/perf]';

/** 把状态写到 <html data-ember="..."> 的属性名 */
export const STATUS_DATASET_KEY = 'ember';

/** 把状态细节写到 <html data-ember-detail="..."> 的属性名 */
export const STATUS_DETAIL_DATASET_KEY = 'emberDetail';

/** 状态变化事件名 */
export const STATUS_EVENT_NAME = 'ember:status';

/** 状态取值: 见 README 的 data-ember 对照表 */
export const EMBER_STATUS = {
    running: 'running',
    unavailable: 'unavailable',
    disabled: 'disabled',
} as const;

export type EmberStatus = (typeof EMBER_STATUS)[keyof typeof EMBER_STATUS];

/** 用户/参数主动关闭绘制时的细节串 */
export const STATUS_DETAIL_DISABLED = 'disabled-by-flag';

/** WebGPU 初始化失败时的细节串 */
export const STATUS_DETAIL_INIT_FAILED = 'webgpu-init-failed';

/** 启动过程抛异常且拿不到 message 时的细节串 */
export const STATUS_DETAIL_BOOT_ERROR = 'boot-error';
