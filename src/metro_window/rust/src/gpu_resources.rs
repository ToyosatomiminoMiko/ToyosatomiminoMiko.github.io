/*
GPU 资源共享构造层

- 运行时(app.rs)与离线预览(examples/preview.rs)要建的是同一批与画布尺寸无关的
  GPU 资源:材质采样器,全屏四边形顶点/索引缓冲,以及三张程序化材质贴图
  (污渍 / 雾气 / 车厢倒影).参数本身在 render_params.rs / texture_params.rs,
  这里只负责"按那份参数把资源建出来",两边共用一份代码就不会各自漂移.
- 调试标签由调用方传入而不是在这里拼:两边已有的标签不同(运行时 metro-sampler /
  fullscreen-quad-*,预览 preview-sampler / vertices / indices),标签只用于排错,
  不影响任何渲染行为,所以保留各自的原样.
*/
use crate::render_params::{
    FULLSCREEN_QUAD_INDICES, FULLSCREEN_QUAD_VERTICES, SAMPLER_ADDRESS_MODE_CLAMP,
    SAMPLER_ADDRESS_MODE_REPEAT, SAMPLER_FILTER_MODE,
};
use crate::texture_params::{DIRT_TEXTURE_SIZE, FOG_TEXTURE_SIZE, INTERIOR_TEXTURE_SIZE};
use crate::textures::{create_texture, generate_dirt, generate_fog, generate_interior};
use wgpu::util::DeviceExt;

/// 建材质采样器,`label` 是调用方给的调试标签.
///
/// 采样器约定:u = Repeat(城市层要靠它循环滚动),v = ClampToEdge.
/// 喂给它的"程序化生成"贴图(雾,污渍)因此必须双向可平铺:
///   - u 越界由 Repeat 折回(左右边对不上 => 贯穿画面的竖缝);
///   - v 越界由 ClampToEdge 把最后一行拉满整段
///     (污渍 uv*2 => 下半屏,雾气 uv*1.3 => 77% 以下被水平拉伸).
///
/// 所以着色器里对这两层的坐标先 fract 折回 [0,1)(见 shaders.wgsl),周期在
/// textures.rs 的 value_noise/fbm/scratch_mask 里保证.城市 PNG 是美术素材,
/// 左右边缘本来就有差异,不适用这条(实测跳变很弱).
pub fn create_material_sampler(device: &wgpu::Device, label: &str) -> wgpu::Sampler {
    device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some(label),
        address_mode_u: SAMPLER_ADDRESS_MODE_REPEAT,
        address_mode_v: SAMPLER_ADDRESS_MODE_CLAMP,
        address_mode_w: SAMPLER_ADDRESS_MODE_CLAMP,
        mag_filter: SAMPLER_FILTER_MODE,
        min_filter: SAMPLER_FILTER_MODE,
        mipmap_filter: SAMPLER_FILTER_MODE,
        ..Default::default()
    })
}

/// 建全屏四边形的顶点 / 索引缓冲,返回 `(顶点缓冲, 索引缓冲)`.
///
/// 顶点数据与索引表来自 [`FULLSCREEN_QUAD_VERTICES`] / [`FULLSCREEN_QUAD_INDICES`],
/// 两者的对应关系是整个渲染的几何前提(顺序写错会翻转/撕裂画面).
/// 两个标签由调用方分别给出,用于保持运行时与预览各自的调试标签不变.
pub fn create_quad_buffers(
    device: &wgpu::Device,
    vertex_label: &str,
    index_label: &str,
) -> (wgpu::Buffer, wgpu::Buffer) {
    let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some(vertex_label),
        contents: bytemuck::cast_slice(&FULLSCREEN_QUAD_VERTICES),
        usage: wgpu::BufferUsages::VERTEX,
    });
    let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some(index_label),
        contents: bytemuck::cast_slice(&FULLSCREEN_QUAD_INDICES),
        usage: wgpu::BufferUsages::INDEX,
    });
    (vertex_buffer, index_buffer)
}

/// 生成三张程序化材质贴图,返回顺序固定为 `[污渍, 雾气, 车厢倒影]`.
///
/// 尺寸与全部噪声参数都取自 texture_params.rs,所以运行时与离线预览生成的
/// 纹理逐像素一致(这也是预览能代表线上效果的前提).
/// `labels` 与返回值一一对应(各自是 `create_texture` 的调试标签),由调用方传入.
pub fn generate_material_textures(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    labels: [&str; 3],
) -> [wgpu::Texture; 3] {
    let [dirt_label, fog_label, interior_label] = labels;
    let (dw, dh, dirt_data) = generate_dirt(DIRT_TEXTURE_SIZE.0, DIRT_TEXTURE_SIZE.1);
    let dirt = create_texture(device, queue, dirt_label, dw, dh, &dirt_data, false);
    let (fw, fh, fog_data) = generate_fog(FOG_TEXTURE_SIZE.0, FOG_TEXTURE_SIZE.1);
    let fog = create_texture(device, queue, fog_label, fw, fh, &fog_data, false);
    let (iw, ih, interior_data) =
        generate_interior(INTERIOR_TEXTURE_SIZE.0, INTERIOR_TEXTURE_SIZE.1);
    let interior = create_texture(device, queue, interior_label, iw, ih, &interior_data, false);
    [dirt, fog, interior]
}
