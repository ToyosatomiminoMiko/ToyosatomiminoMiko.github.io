import * as THREE from 'three';

// ============================================================
// 曲面伪彩色:顶点着色器配色
//
// CPU 侧的 map_surface_colors(HSL 伪彩色)已从 render_rs 移除,
// 同一套映射搬到这里,在顶点着色器里依据 position.z(网格本地的
// 采样值)与 uZRange(采样结果的 z_min/z_max)实时计算,每帧只
// 需要更新一个 vec2 uniform,不再逐帧生成/传输 color attribute.
//
// 常量与算法必须与 render_rs 的 config.rs 保持一致:
//   SURFACE_HUE_START = 0.66      SURFACE_SATURATION = 0.9
//   SURFACE_LIGHTNESS_BASE = 0.5  SURFACE_LIGHTNESS_RANGE = 0.3
//   FLAT_COLOR_T = 0.5
// 修改任一侧时都要同步另一侧.
// ============================================================

/**
 * 注入到顶点着色器 <common> 之后的上色代码:声明 uniform/varying 与
 * 两个辅助函数,算法逐行对应 render_rs 的 hsl_to_rgb/hue_to_rgb.
 */
const SURFACE_COLOR_GLSL = /* glsl */ `
uniform vec2 uZRange;
varying vec3 vSurfaceColor;

float surfaceHue2rgb(float p, float q, float t) {
    if (t < 0.0) { t += 1.0; }
    if (t > 1.0) { t -= 1.0; }
    if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
    if (t < 1.0 / 2.0) { return q; }
    if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    return p;
}

vec3 surfaceColorFromZ(float z) {
    // NaN/Inf 顶点保持黑色(与旧 CPU 路径一致);
    // 这类顶点所在的三角形已被索引过滤,通常不会被绘制.
    if (isnan(z) || isinf(z)) { return vec3(0.0); }

    float range = uZRange.y - uZRange.x;
    float t = (range > 0.0)
        ? clamp((z - uZRange.x) / range, 0.0, 1.0)
        : 0.5; // 平坦曲面(range == 0)对应旧 FLAT_COLOR_T

    float hue = 0.66 - t * 0.66;
    float sat = 0.9;
    float light = 0.5 + t * 0.3;

    float q = (light < 0.5) ? light * (1.0 + sat) : light + sat - light * sat;
    float p = 2.0 * light - q;

    return vec3(
        surfaceHue2rgb(p, q, hue + 1.0 / 3.0),
        surfaceHue2rgb(p, q, hue),
        surfaceHue2rgb(p, q, hue - 1.0 / 3.0)
    );
}
`;

/** 片段着色器侧只需要接收 varying. */
const SURFACE_COLOR_FRAGMENT_DECL = /* glsl */ `
varying vec3 vSurfaceColor;
`;

/** 覆盖 onBeforeCompile 参数里 shader 的最小结构. */
type ShaderLike = {
    uniforms: Record<string, { value: unknown }>;
    vertexShader: string;
    fragmentShader: string;
};

/**
 * z 值区间的运行时句柄:每次 Worker 采样结果到达后用 setRange 更新.
 */
export type SurfaceColorRangeHandle = {
    /** 用本次采样结果的 z 极值更新上色区间 */
    setRange(zMin: number, zMax: number): void;
};

/**
 * 给曲面 Phong 材质注入 "z -> HSL" 顶点配色.
 *
 * 通过 onBeforeCompile 改写 shader:顶点着色器为每个顶点计算
 * vSurfaceColor,片段着色器在 diffuseColor 处乘以它 -- 语义与旧的
 * vertexColors(true) + CPU color attribute 完全一致(diffuse 乘以
 * 顶点色,specular 不受影响).调用方必须不再往几何体上挂 color
 * attribute,否则 vertexColors 的默认路径会双重叠加.
 *
 * 几何体没有 color attribute 时 Three 不会定义 USE_COLOR,旧 color_fragment
 * 分支为空操作,因此这里直接把它替换成我们自己的乘法.
 *
 * @param material 曲面主体的 MeshPhongMaterial
 * @returns z 区间句柄,由调用方在每次采样结果落地后更新
 */
export function installSurfaceVertexColor(
    material: THREE.Material,
): SurfaceColorRangeHandle {
    // uniform 容器在 onBeforeCompile 里挂到 shader.uniforms 上;
    // 后续只改 value,不触发重新编译.
    const zRange = { value: new THREE.Vector2(0, 1) };

    material.onBeforeCompile = ((shader: ShaderLike) => {
        shader.uniforms.uZRange = zRange;
        shader.vertexShader = shader.vertexShader
            .replace(
                '#include <common>',
                `#include <common>\n${SURFACE_COLOR_GLSL}`,
            )
            .replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>\nvSurfaceColor = surfaceColorFromZ(position.z);`,
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                `#include <common>\n${SURFACE_COLOR_FRAGMENT_DECL}`,
            )
            .replace(
                '#include <color_fragment>',
                'diffuseColor.rgb *= vSurfaceColor;',
            );
    }) as THREE.Material['onBeforeCompile'];

    // onBeforeCompile 在程序首次编译时才会执行,必须标记 needsUpdate
    // 让 Three 用改写后的 shader 重新生成材质程序.
    material.needsUpdate = true;

    return {
        setRange(zMin: number, zMax: number): void {
            zRange.value.set(zMin, zMax);
        },
    };
}
