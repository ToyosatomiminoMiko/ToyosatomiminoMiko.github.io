/**
 * 球坐标 <-> 笛卡尔坐标转换.
 *
 * DSL 里 `at spherical(...)` 显式写球坐标,由本模块在编译期换算成笛卡尔点,
 * 再走既有的梯度/投影管线;分析结果列表也可以把点换算回 `[r, θ, φ]` 展示.
 * 这里是纯数学工具,不依赖 DOM/three.js,也不读全局配置:约定由调用方以
 * `convention` 参数显式传入(DSL 侧读 `numericConfig.analysis.
 * sphericalAngleConvention`)--这样两个约定都能被单测直接覆盖,切换全局
 * 行为只改一处配置.
 *
 * 两个约定只是 θ/φ 互换:
 *
 * 一.physics / ISO(默认):θ 是**极角**,从 +Z 轴量起 ∈ [0, π];
 *    φ 是**方位角**,在 xy 平面内从 +X 轴逆时针量起 ∈ (-π, π].
 *
 *     x = r·sinθ·cosφ
 *     y = r·sinθ·sinφ
 *     z = r·cosθ
 *
 * 二.math(部分教材):θ 是方位角,φ 是极角.
 *
 *     x = r·sinφ·cosθ
 *     y = r·sinφ·sinθ
 *     z = r·cosφ
 *
 * 角度一律用弧度(与项目其余部分一致,普通角度写 `deg(...)` 展开).
 * 原点处 r = 0,方位角/极角没有定义,`cartesianToSpherical` 返回 [0, 0, 0].
 */

/** 球坐标角度约定;两个约定都已实现,由全局配置选择默认. */
export type SphericalAngleConvention = 'physics' | 'math';

/** 供配置校验使用的约定清单(与类型定义同源). */
export const SPHERICAL_ANGLE_CONVENTIONS: readonly SphericalAngleConvention[] = [
    'physics',
    'math',
];

function clampUnit(value: number): number {
    if (value > 1) return 1;
    if (value < -1) return -1;
    return value;
}

/**
 * 球坐标 `[r, θ, φ]` -> 笛卡尔 `[x, y, z]`.
 *
 * 先把 (θ, φ) 归一成 `(polar, azimuth)`:physics 约定下 (θ, φ) 本身就是
 * (极角, 方位角),math 约定下互换.这样两种约定共用同一组公式,只在一个
 * 地方分叉,避免两份三角函数各写一遍.
 */
export function sphericalToCartesian(
    r: number,
    theta: number,
    phi: number,
    convention: SphericalAngleConvention,
): [number, number, number] {
    const [polar, azimuth] = convention === 'physics'
        ? [theta, phi]
        : [phi, theta];
    const sinPolar = Math.sin(polar);
    return [
        r * sinPolar * Math.cos(azimuth),
        r * sinPolar * Math.sin(azimuth),
        r * Math.cos(polar),
    ];
}

/**
 * 笛卡尔 `[x, y, z]` -> 球坐标 `[r, θ, φ]`.
 *
 * 极角用 `acos(z / r)`,方位角用 `atan2(y, x)`(`atan` 会丢象限,不能用);
 * `z / r` 先夹到 [-1, 1],避免浮点误差让 `acos` 返回 NaN.
 */
export function cartesianToSpherical(
    x: number,
    y: number,
    z: number,
    convention: SphericalAngleConvention,
): [number, number, number] {
    const r = Math.hypot(x, y, z);
    if (r === 0) return [0, 0, 0];
    const polar = Math.acos(clampUnit(z / r));
    const azimuth = Math.atan2(y, x);
    return convention === 'physics'
        ? [r, polar, azimuth]
        : [r, azimuth, polar];
}
