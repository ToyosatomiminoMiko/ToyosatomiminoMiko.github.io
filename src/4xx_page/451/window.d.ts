/**
 * 451 在 window 上暴露的调试开关.
 * 在 451 的入口脚本之前插一段普通 <script> 即可设置:
 *
 *   <script>window.__emberDisabled = true;</script>
 *   <script>window.__emberOptions = { particleCount: 64, hud: true };</script>
 */
interface Window {
    /** 设为 true 时完全不画粒子(等价于地址栏 ?nogpu=1) */
    __emberDisabled?: boolean;
    /** 引擎参数(boot 层的 initTimeoutMs 也在这里传) */
    __emberOptions?: import('./boot').EmberBootOptions;
    /** 引擎实例,调试用: window.__ember.dispose() */
    __ember?: import('./ember').EmberWebGPU;
    /** 性能打点: 取一份帧统计快照(?perf=1 时也有屏幕 HUD) */
    __emberStats?: () => import('./ember').FrameStatsSnapshot;
    /** 性能打点: 取一行人类可读的摘要 */
    __emberReport?: () => string;
}
