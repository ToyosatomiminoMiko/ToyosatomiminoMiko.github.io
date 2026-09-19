/*
mip 生成着色器(逐级 blit)
- vs_blit:无顶点缓冲的全屏三角形(一个三角形盖住整个裁剪空间)
- fs_blit:把上一级 mip 按双线性缩小采样到这一级

为什么单独一个着色器模块,而不是塞进 shaders.wgsl:
WGSL 的 @group/@binding 是**模块级**命名空间,同一模块里 binding 0 只能声明一次;
主着色器的 binding 0/1 已经是 uniforms 与水滴 storage buffer,而这条 blit 只需要
"一张源纹理 + 一个采样器",独立模块就能用最自然的 0/1,不必去主着色器的槽位表里
挤两个空位(挤了还得在两个绑定组布局之间来回对照).

语义约定(与主着色器一致):uv = (0,0) 是纹理左上角.裁剪空间 y = +1 是画面顶端,
所以顶点里的 v 要翻一次(见 vs_blit 的 1.0 - y).
*/

struct BlitOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

// 上一级 mip 的纹理(每级一个视图,binding 0).
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
// 与主着色器同一个采样器(u 方向 Repeat / v 方向 ClampToEdge).
@group(0) @binding(1) var sourceSampler: sampler;

// 全屏三角形:index = 0/1/2 -> (x, y) = (0,0) / (2,0) / (0,2)
//   x = (index << 1) & 2:0 / 2 / 0
//   y = index & 2:       0 / 0 / 2
// 三个顶点:(-1,-1) / (3,-1) / (-1,3),覆盖整个 [-1,1]² 且 uv 线性外推正确.
// 用三角形而不是四边形:不占顶点缓冲,少画一个三角形,边缘也不会出现对角线接缝.
@vertex
fn vs_blit(@builtin(vertex_index) index: u32) -> BlitOut {
    let x = f32((index << 1u) & 2u);
    let y = f32(index & 2u);
    var out: BlitOut;
    out.position = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    // y = 0 是裁剪空间底边(v = 1),y = 2 是顶边(v = -1):线性插值后
    // 画面顶端拿到 v = 0,与主着色器"v 向下增长"的约定一致.
    out.uv = vec2f(x, 1.0 - y);
    return out;
}

// 显式指定 LOD = 0:这里的源视图只有一级(base_mip_level 指向上一级),
// 用 textureSample 的隐式导数虽然也会被夹到 0,但显式写出来不受目标分辨率影响.
@fragment
fn fs_blit(in: BlitOut) -> @location(0) vec4f {
    return textureSampleLevel(sourceTexture, sourceSampler, in.uv, 0.0);
}
