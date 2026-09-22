/*
原生预览示例
- 使用 lavapipe(软件 Vulkan)跑一遍渲染管线,输出 preview.png
  (落在本 crate 根下的 test_output/,与 cargo test 的 PPM 基准图同处;
  路径与 cwd 无关,从仓库根跑也一样)
- 方便在没有 WebGPU 浏览器时离线查看车窗效果(城市视差 / 污渍 / 雾气 / 车厢灯光)
- 可用环境变量覆盖任意滑块参数做 A/B,例如:
    PREVIEW_PARAM=fog_opacity=1 PREVIEW_PARAM=dirt_opacity=0 cargo run --example preview
  参数名与线上 setParam 走**同一份字段分发**(`app_params::write_param`),所以
  示例里能调的线上也能调;区别是线上由前端 config.ts 声明区间并夹取,示例里
  直接按写的数值用(离线调试要的就是"所见即所填").
- 水珠的离线预览在仓库根目录的 water_droplet_demo/rust/examples/preview.rs.
*/
use metro_window::{
    create_metro_pipelines, create_texture, decode_png, generate_dirt, generate_fog,
    generate_interior, write_param, GlassParams, MetroTextures, Uniforms, DIRT_TEXTURE_SIZE,
    FOG_TEXTURE_SIZE, FULLSCREEN_QUAD_INDICES, FULLSCREEN_QUAD_VERTICES, INTERIOR_TEXTURE_SIZE,
    QUAD_INDEX_FORMAT, RENDER_TARGET_FORMAT, RGBA_BYTES_PER_PIXEL, SAMPLER_ADDRESS_MODE_CLAMP,
    SAMPLER_ADDRESS_MODE_REPEAT, SAMPLER_FILTER_MODE,
};
use wgpu::util::DeviceExt;

/// 覆盖单个参数的入口:环境变量 `PREVIEW_PARAM`,写成 `名字=数值`(逗号分隔多项).
///
/// 未登记的参数名会打印警告并跳过(与线上 setParam 的行为一致).
fn apply_preview_overrides(params: &mut GlassParams) {
    const KEY: &str = "PREVIEW_PARAM";
    const SEPARATOR: char = '=';
    let Ok(raw) = std::env::var(KEY) else {
        return;
    };
    for item in raw.split(',') {
        let Some((name, value)) = item.split_once(SEPARATOR) else {
            eprintln!("[PREVIEW] 忽略无法解析的覆盖项: {item}(应为 名字=数值)");
            continue;
        };
        match value.trim().parse::<f32>() {
            Ok(v) if write_param(params, name.trim(), v) => {
                println!("[PREVIEW] {name} = {v}");
            }
            Ok(v) => eprintln!("[PREVIEW] 未知参数: {name} = {v}"),
            Err(e) => eprintln!("[PREVIEW] 数值无法解析: {item}({e})"),
        }
    }
}

// ===== 原生预览参数(仅本示例使用)=====
/// 预览画布宽度(像素).
const PREVIEW_WIDTH: u32 = 1024;
/// 预览画布高度(像素),16:9(与运行时画布比例一致).
const PREVIEW_HEIGHT: u32 = 576;
/// 写入 Uniforms 的时间(秒),取非 0 让动画处于推进状态.
const PREVIEW_TIME_SECONDS: f32 = 2.0;
/// 写入 Uniforms 的样式编号(1 = 第二种样式,便于与默认样式区分).
const PREVIEW_STYLE_ID: u32 = 1;
/// 城市贴图在仓库里的位置(相对站点 `public/`;与运行时的 /metro_window/resource 是同一批文件).
///
/// 用 `CARGO_MANIFEST_DIR`(编译期由 cargo 注入的 crate 根绝对路径)而不是相对路径:
/// `cargo run --example` 的 cwd 是**调用目录**(从仓库根调时就是仓库根),
/// `cargo test` 的 cwd 才是 crate 根,相对路径在两者间会指向不同地方.
const PREVIEW_RESOURCE_DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    // crate 根 = <repo>/src/metro_window/rust,向下三级就是仓库根
    "/../../../public/metro_window/resource"
);
/// 按文件名拼出城市贴图的绝对路径(与运行时的 `city_png()` 一一对应).
fn preview_city_png(file: &str) -> String {
    format!("{PREVIEW_RESOURCE_DIR}/{file}")
}
/// 城市近景层贴图文件名(level 0,最近的一层).
const PREVIEW_LEVEL_0: &str = "level_0.png";
/// 城市中景层贴图文件名(level 1).
const PREVIEW_LEVEL_1: &str = "level_1.png";
/// 城市远景层贴图文件名(level 2).
const PREVIEW_LEVEL_2: &str = "level_2.png";
/// 城市背景层贴图文件名(level 3,最远的一层).
const PREVIEW_LEVEL_3: &str = "level_3.png";

use std::future::Future;
use std::pin::pin;
use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

fn noop_raw_waker() -> RawWaker {
    fn clone(_: *const ()) -> RawWaker {
        noop_raw_waker()
    }
    fn wake(_: *const ()) {}
    fn wake_by_ref(_: *const ()) {}
    fn drop(_: *const ()) {}
    const VTABLE: RawWakerVTable = RawWakerVTable::new(clone, wake, wake_by_ref, drop);
    RawWaker::new(std::ptr::null(), &VTABLE)
}

fn block_on<F: Future>(future: F) -> F::Output {
    let mut fut = pin!(future);
    let waker = unsafe { Waker::from_raw(noop_raw_waker()) };
    let mut cx = Context::from_waker(&waker);
    loop {
        if let Poll::Ready(value) = fut.as_mut().poll(&mut cx) {
            return value;
        }
        std::thread::yield_now();
    }
}

fn load_png(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    path: &str,
    premultiply: bool,
) -> wgpu::Texture {
    let bytes = std::fs::read(path).expect(path);
    let (w, h, rgba) = decode_png(&bytes).expect("decode png");
    create_texture(device, queue, path, w, h, &rgba, premultiply)
}

fn main() {
    block_on(async {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::VULKAN,
            ..Default::default()
        });
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower,
                compatible_surface: None,
                force_fallback_adapter: true,
            })
            .await
            .expect("lavapipe 不可用");
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("preview-device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .expect("device");

        // 贴图在站点 public/metro_window/resource/ 下(PREVIEW_RESOURCE_DIR 已拼成
        // 绝对路径,不受 cwd 影响).站点运行时 fetch 的是同一批文件的公开地址
        // /metro_window/resource/...,见 src/app_params.rs 的 RESOURCE_BASE.
        // 顺序与运行时一致:背景(level_3)在最下,近景(level_0)在最上.
        let bg = load_png(&device, &queue, &preview_city_png(PREVIEW_LEVEL_3), false);
        let far = load_png(&device, &queue, &preview_city_png(PREVIEW_LEVEL_2), true);
        let mid = load_png(&device, &queue, &preview_city_png(PREVIEW_LEVEL_1), true);
        let near = load_png(&device, &queue, &preview_city_png(PREVIEW_LEVEL_0), true);
        let (dw, dh, dirt_data) = generate_dirt(DIRT_TEXTURE_SIZE.0, DIRT_TEXTURE_SIZE.1);
        let dirt = create_texture(&device, &queue, "dirt", dw, dh, &dirt_data, false);
        let (fw, fh, fog_data) = generate_fog(FOG_TEXTURE_SIZE.0, FOG_TEXTURE_SIZE.1);
        let fog = create_texture(&device, &queue, "fog", fw, fh, &fog_data, false);
        let (iw, ih, interior_data) =
            generate_interior(INTERIOR_TEXTURE_SIZE.0, INTERIOR_TEXTURE_SIZE.1);
        let interior = create_texture(&device, &queue, "interior", iw, ih, &interior_data, false);

        // 与运行时同一套采样器约定:u = Repeat(城市层横向滚动),v = ClampToEdge.
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("preview-sampler"),
            address_mode_u: SAMPLER_ADDRESS_MODE_REPEAT,
            address_mode_v: SAMPLER_ADDRESS_MODE_CLAMP,
            address_mode_w: SAMPLER_ADDRESS_MODE_CLAMP,
            mag_filter: SAMPLER_FILTER_MODE,
            min_filter: SAMPLER_FILTER_MODE,
            mipmap_filter: SAMPLER_FILTER_MODE,
            ..Default::default()
        });

        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("vertices"),
            contents: bytemuck::cast_slice(&FULLSCREEN_QUAD_VERTICES),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("indices"),
            contents: bytemuck::cast_slice(&FULLSCREEN_QUAD_INDICES),
            usage: wgpu::BufferUsages::INDEX,
        });

        let uniforms = Uniforms::new(PREVIEW_TIME_SECONDS, PREVIEW_STYLE_ID);
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let mut glass_params = GlassParams::DEFAULT;
        apply_preview_overrides(&mut glass_params);
        let glass_params_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("glass-params"),
            contents: bytemuck::bytes_of(&glass_params),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let views = [
            bg.create_view(&Default::default()),
            far.create_view(&Default::default()),
            mid.create_view(&Default::default()),
            near.create_view(&Default::default()),
            dirt.create_view(&Default::default()),
            fog.create_view(&Default::default()),
            interior.create_view(&Default::default()),
        ];
        let pipelines = create_metro_pipelines(
            &device,
            RENDER_TARGET_FORMAT,
            &uniform_buffer,
            &glass_params_buffer,
            MetroTextures {
                sampler: &sampler,
                texture_views: [
                    &views[0], &views[1], &views[2], &views[3], &views[4], &views[5], &views[6],
                ],
            },
        );

        let width = PREVIEW_WIDTH;
        let height = PREVIEW_HEIGHT;
        let target = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("preview-target"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: RENDER_TARGET_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let target_view = target.create_view(&Default::default());

        let mut encoder = device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("preview-render-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&pipelines.render_pipeline);
            pass.set_vertex_buffer(0, vertex_buffer.slice(..));
            pass.set_index_buffer(index_buffer.slice(..), QUAD_INDEX_FORMAT);
            pass.set_bind_group(0, &pipelines.render_bind_group, &[]);
            pass.draw_indexed(0..FULLSCREEN_QUAD_INDICES.len() as u32, 0, 0..1);
        }

        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("preview-readback"),
            size: (width * height * RGBA_BYTES_PER_PIXEL) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &target,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(width * RGBA_BYTES_PER_PIXEL),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        queue.submit(Some(encoder.finish()));

        let slice = readback.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            tx.send(result).ok();
        });
        device.poll(wgpu::Maintain::Wait);
        rx.recv().expect("map").expect("map failed");
        let data = slice.get_mapped_range();
        // 落在 crate 根下的 test_output/(与 cargo test 的 PPM 基准图同处),
        // 路径按 CARGO_MANIFEST_DIR 算成绝对路径,所以从哪个目录跑命令都一样.
        let out_dir = metro_window::test_output_dir();
        std::fs::create_dir_all(&out_dir).expect("创建 test_output/ 失败");
        let path = out_dir.join("preview.png");
        let file = std::fs::File::create(&path).expect("create preview.png");
        let mut encoder = png::Encoder::new(file, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("png header");
        writer.write_image_data(&data).expect("write preview.png");
        drop(data);
        println!("已生成 {} ({}x{})", path.display(), width, height);
    });
}
