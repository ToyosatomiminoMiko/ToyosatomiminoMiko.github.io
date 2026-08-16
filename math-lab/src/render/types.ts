/**
 * 渲染层共享类型。
 *
 * 当前只放相机相关类型，供 `render/core` 与 `render/controls` 共同使用。
 * 注意：这里不要反向依赖 `service` 或 `compiler/dsl`。
 */

export type CamMode = 'perspective' | 'orthographic';
export type ViewHome = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'isometric';
