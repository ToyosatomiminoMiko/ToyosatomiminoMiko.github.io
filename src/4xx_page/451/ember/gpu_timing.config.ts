/**
 * GPU 侧打点(timestamp-query)的常量.
 * 从 gpu_timing.ts 抽出: 采样窗口 / 缓冲布局 / 放弃阈值.
 */

/** 一帧打 4 个时间戳 = 3 段 pass(计算 / 粒子 / 合成) */
export const MARKS_PER_FRAME = 4;

/** query set 槽位数, 双缓冲: 允许"上一帧还在读回"时直接开始下一帧 */
export const SLOT_COUNT = MARKS_PER_FRAME * 2;

/** resolveQuerySet 的目标偏移必须按 256 字节对齐, 所以缓冲就开 256 字节 */
export const TIMESTAMP_BUFFER_SIZE = 256;

/** 一个时间戳(u64)占的字节数, 计算 copyBufferToBuffer / mapAsync 偏移用 */
export const BYTES_PER_TIMESTAMP = 8;

/** 时间戳单位是纳秒, 换算成毫秒要除以它 */
export const NS_PER_MS = 1e6;

/** 连续这么多帧都读到 0 就认定该后端测不出 GPU 时间(软件适配器常见) */
export const ZERO_READS_BEFORE_GIVING_UP = 8;

/** timestamp query set 的调试标签 */
export const TIMESTAMP_QUERY_LABEL = '451-timestamps';

/** resolve 目标缓冲的调试标签 */
export const TIMESTAMP_RESOLVE_LABEL = '451-timestamp-resolve';

/** 读回缓冲的调试标签 */
export const TIMESTAMP_READ_LABEL = '451-timestamp-read';
