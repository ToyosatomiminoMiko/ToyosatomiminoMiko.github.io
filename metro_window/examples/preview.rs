/*
原生预览示例
- 使用 lavapipe(软件 Vulkan)运行完整管线,输出 preview.png
- 方便在没有 WebGPU 浏览器时离线查看玻璃效果
*/
use metro_window::{
    create_metro_pipelines, create_texture, decode_png, generate_dirt, generate_fog,
    generate_interior, make_droplets, DropletParams, MetroTextures, Uniforms, DIRT_TEXTURE_SIZE,
    FOG_TEXTURE_SIZE, FULLSCREEN_QUAD_INDICES, FULLSCREEN_QUAD_VERTICES, INTERIOR_TEXTURE_SIZE,
    MIN_TEXTURE_DIMENSION, QUAD_INDEX_FORMAT, REFRACTION_TEXTURE_FORMAT, REFRACTION_WORKGROUP_EDGE,
    RENDER_TARGET_FORMAT, RGBA_BYTES_PER_PIXEL, SAMPLER_ADDRESS_MODE_CLAMP,
    SAMPLER_ADDRESS_MODE_REPEAT, SAMPLER_FILTER_MODE,
};
use wgpu::util::DeviceExt;

// ===== 原生预览参数(仅本示例使用)=====
/// 预览画布宽度(像素):比运行时画布大,便于观察折射细节.
const PREVIEW_WIDTH: u32 = 1024;
/// 预览画布高度(像素),16:9.
const PREVIEW_HEIGHT: u32 = 576;
/// 折射偏移图相对画布的下采样倍数:比运行时的 1/8 更锐利,便于肉眼检查.
const PREVIEW_REFRACTION_DOWNSCALE: u32 = 4;
/// 写入 Uniforms 的初始时间(秒),取非 0 让动画处于推进状态.
const PREVIEW_TIME_SECONDS: f32 = 2.0;
/// 写入 Uniforms 的帧间隔(秒),≈60fps.
const PREVIEW_DELTA_SECONDS: f32 = 0.016;
/// 写入 Uniforms 的样式编号(1 = 第二种样式,便于与默认样式区分).
const PREVIEW_STYLE_ID: u32 = 1;
/// 城市背景层贴图(相对 crate 根;与运行时的 /metro_window/resource 指向同一批文件).
const PREVIEW_CITY_BG: &str = "public/resource/city_bg.png";
/// 城市远景层贴图.
const PREVIEW_CITY_FAR: &str = "public/resource/city_far.png";
/// 城市中景层贴图.
const PREVIEW_CITY_MID: &str = "public/resource/city_mid.png";
/// 城市近景层贴图.
const PREVIEW_CITY_NEAR: &str = "public/resource/city_near.png";

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

fn load_png(device: &wgpu::Device, queue: &wgpu::Queue, path: &str) -> wgpu::Texture {
    let bytes = std::fs::read(path).expect(path);
    let (w, h, rgba) = decode_png(&bytes).expect("decode png");
    create_texture(device, queue, path, w, h, &rgba)
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

        // 相对 crate 根(cargo run 的 cwd 就是包根):贴图在 public/resource/ 下.
        // 站点运行时用的是另一套绝对路径(web 下的 /metro_window/resource/),
        // 见 src/app_params.rs 的 RESOURCE_BASE -- 两者指向的是同一批文件.
        let bg = load_png(&device, &queue, PREVIEW_CITY_BG);
        let far = load_png(&device, &queue, PREVIEW_CITY_FAR);
        let mid = load_png(&device, &queue, PREVIEW_CITY_MID);
        let near = load_png(&device, &queue, PREVIEW_CITY_NEAR);
        let (dw, dh, dirt_data) = generate_dirt(DIRT_TEXTURE_SIZE.0, DIRT_TEXTURE_SIZE.1);
        let dirt = create_texture(&device, &queue, "dirt", dw, dh, &dirt_data);
        let (fw, fh, fog_data) = generate_fog(FOG_TEXTURE_SIZE.0, FOG_TEXTURE_SIZE.1);
        let fog = create_texture(&device, &queue, "fog", fw, fh, &fog_data);
        let (iw, ih, interior_data) =
            generate_interior(INTERIOR_TEXTURE_SIZE.0, INTERIOR_TEXTURE_SIZE.1);
        let interior = create_texture(&device, &queue, "interior", iw, ih, &interior_data);

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

        let width = PREVIEW_WIDTH;
        let height = PREVIEW_HEIGHT;
        let uniforms = Uniforms::new(
            PREVIEW_TIME_SECONDS,
            PREVIEW_DELTA_SECONDS,
            PREVIEW_STYLE_ID,
            width,
            height,
        );
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let droplet_params = DropletParams::DEFAULT;
        let droplet_params_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("droplet-params"),
            contents: bytemuck::bytes_of(&droplet_params),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let droplets = make_droplets(&droplet_params);
        let droplet_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("droplets"),
            contents: bytemuck::cast_slice(&droplets),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });

        let rw = (width / PREVIEW_REFRACTION_DOWNSCALE).max(MIN_TEXTURE_DIMENSION);
        let rh = (height / PREVIEW_REFRACTION_DOWNSCALE).max(MIN_TEXTURE_DIMENSION);
        let refraction_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("preview-refraction"),
            size: wgpu::Extent3d {
                width: rw,
                height: rh,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: REFRACTION_TEXTURE_FORMAT,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let refraction_view = refraction_texture.create_view(&Default::default());
        let refraction_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("preview-refraction-sampler"),
            address_mode_u: SAMPLER_ADDRESS_MODE_CLAMP,
            address_mode_v: SAMPLER_ADDRESS_MODE_CLAMP,
            address_mode_w: SAMPLER_ADDRESS_MODE_CLAMP,
            mag_filter: SAMPLER_FILTER_MODE,
            min_filter: SAMPLER_FILTER_MODE,
            mipmap_filter: SAMPLER_FILTER_MODE,
            ..Default::default()
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
            &droplet_params_buffer,
            &droplet_buffer,
            MetroTextures {
                refraction_view: &refraction_view,
                refraction_sampler: &refraction_sampler,
                sampler: &sampler,
                texture_views: [
                    &views[0], &views[1], &views[2], &views[3], &views[4], &views[5], &views[6],
                ],
            },
        );

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
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("preview-compute-pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&pipelines.physics_pipeline);
            pass.set_bind_group(0, &pipelines.compute_bind_group, &[]);
            pass.dispatch_workgroups(1, 1, 1);
            pass.set_pipeline(&pipelines.refraction_pipeline);
            pass.dispatch_workgroups(
                rw.div_ceil(REFRACTION_WORKGROUP_EDGE),
                rh.div_ceil(REFRACTION_WORKGROUP_EDGE),
                1,
            );
        }
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
        let file = std::fs::File::create("preview.png").expect("create preview.png");
        let mut encoder = png::Encoder::new(file, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("png header");
        writer.write_image_data(&data).expect("write preview.png");
        drop(data);
        println!("已生成 preview.png ({}x{})", width, height);
    });
}
