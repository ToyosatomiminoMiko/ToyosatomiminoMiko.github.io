/*
原生预览示例
- 使用 lavapipe(软件 Vulkan)运行完整管线,输出 preview.png
- 方便在没有 WebGPU 浏览器时离线查看玻璃效果
*/
use metro_window::{
    create_metro_pipelines, create_texture, decode_png, generate_dirt, generate_fog,
    generate_interior, make_droplets, DropletParams, MetroTextures, Uniforms,
};
use wgpu::util::DeviceExt;

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
        // 见 src/app.rs 的 RESOURCE_BASE -- 两者指向的是同一批文件.
        let bg = load_png(&device, &queue, "public/resource/city_bg.png");
        let far = load_png(&device, &queue, "public/resource/city_far.png");
        let mid = load_png(&device, &queue, "public/resource/city_mid.png");
        let near = load_png(&device, &queue, "public/resource/city_near.png");
        let (dw, dh, dirt_data) = generate_dirt(256, 256);
        let dirt = create_texture(&device, &queue, "dirt", dw, dh, &dirt_data);
        let (fw, fh, fog_data) = generate_fog(256, 256);
        let fog = create_texture(&device, &queue, "fog", fw, fh, &fog_data);
        let (iw, ih, interior_data) = generate_interior(512, 256);
        let interior = create_texture(&device, &queue, "interior", iw, ih, &interior_data);

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("preview-sampler"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let vertex_data: [f32; 16] = [
            -1.0, -1.0, 0.0, 1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0,
        ];
        let index_data: [u16; 6] = [0, 1, 2, 1, 3, 2];
        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("vertices"),
            contents: bytemuck::cast_slice(&vertex_data),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("indices"),
            contents: bytemuck::cast_slice(&index_data),
            usage: wgpu::BufferUsages::INDEX,
        });

        let width = 1024u32;
        let height = 576u32;
        let uniforms = Uniforms::new(2.0, 0.016, 1, width, height);
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

        let rw = (width / 4).max(1);
        let rh = (height / 4).max(1);
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
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let refraction_view = refraction_texture.create_view(&Default::default());
        let refraction_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("preview-refraction-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
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
            wgpu::TextureFormat::Rgba8Unorm,
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
            format: wgpu::TextureFormat::Rgba8Unorm,
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
            pass.dispatch_workgroups(rw.div_ceil(8), rh.div_ceil(8), 1);
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
            pass.set_index_buffer(index_buffer.slice(..), wgpu::IndexFormat::Uint16);
            pass.set_bind_group(0, &pipelines.render_bind_group, &[]);
            pass.draw_indexed(0..6, 0, 0..1);
        }

        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("preview-readback"),
            size: (width * height * 4) as u64,
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
                    bytes_per_row: Some(width * 4),
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
