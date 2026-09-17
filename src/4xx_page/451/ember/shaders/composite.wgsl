// ============================================================
// composite.wgsl -- 把离屏图像合成到画布 (全屏三角形, 一次纹理采样)
//
// 拖尾/烟雾的"衰减"发生在 render.wgsl 的粒子 pass 里:
// 该 pass 每帧以透明黑 clear 再叠加本帧粒子, 于是上一帧的历史整体乘以
// 固定系数后被保留 -- 等价于原 CPU 版每帧 fillRect('rgba(5,2,1,0.2)') 的
// 拖尾效果, 但完全在 GPU 上完成, 不需要 CPU 逐帧全屏填充.
// 这里只负责把那张离屏图(已是最终画面)输出到 canvas.
// ============================================================

@group(0) @binding(0) var prevTex : texture_2d<f32>;
@group(0) @binding(1) var prevSampler : sampler;
@group(0) @binding(2) var<uniform> sim : SimUniforms;

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv        : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
    // 单个大三角形覆盖全屏, 无顶点缓冲
    var xy = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 3.0,  1.0)
    );
    let p = xy[vi];
    var out : VSOut;
    out.pos = vec4<f32>(p, 0.0, 1.0);
    out.uv  = vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
    return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
    let col = textureSample(prevTex, prevSampler, in.uv).rgb;
    return vec4<f32>(col, 1.0);
}
