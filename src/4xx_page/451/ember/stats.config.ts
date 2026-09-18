/**
 * 帧统计(FrameStats)与 HUD 上报节奏的常量.
 * 从 stats.ts / index.ts 抽出: 统计窗口大小 / 小数位 / 上报间隔.
 */

/** 默认保留最近 240 帧(60Hz 下约 4 秒) */
export const STATS_CAPACITY = 240;

/** 分布(avg/p50/p95/max)保留的小数位数 */
export const STATS_DISTRIBUTION_DIGITS = 2;

/** 平均帧率保留的小数位数 */
export const STATS_FPS_DIGITS = 1;

/** 平均每帧仿真步数保留的小数位数 */
export const STATS_STEPS_DIGITS = 2;

/** 需要补步(> 1)的帧占比保留的小数位数 */
export const STATS_CATCHUP_DIGITS = 3;

/** 主线程耗时占比 cpuShare 保留的小数位数 */
export const STATS_CPU_SHARE_DIGITS = 4;

/** 摘要里把 cpuShare 写成百分比时保留的小数位数 */
export const STATS_CPU_SHARE_PERCENT_DIGITS = 1;

/** p50 分位点(nearest-rank) */
export const STATS_PERCENTILE_P50 = 0.5;

/** p95 分位点(nearest-rank) */
export const STATS_PERCENTILE_P95 = 0.95;

/** 每攒够这么多帧上报一次统计 */
export const STATS_REPORT_FRAMES = 60;

/** 距上次上报超过这么久也强制上报一次(ms); 低帧率下 HUD 才不会僵住 */
export const STATS_REPORT_INTERVAL_MS = 1000;

/** 少于这么多帧时不急于上报(避免刚起表就刷一条没意义的摘要) */
export const STATS_REPORT_MIN_FRAMES = 4;

/** 把平均帧率写到 <html data-ember-fps="..."> 的属性名 */
export const STATS_FPS_DATASET_KEY = 'emberFps';
