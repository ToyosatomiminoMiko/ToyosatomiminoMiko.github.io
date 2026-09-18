/*
原生冒烟测试
- 使用 lavapipe 验证 水滴物理 + 斯涅尔折射 + 渲染管线 可正常执行
- 断言渲染输出非全黑/折射偏移图非全零
*/
use metro_window::{
    create_metro_pipelines, create_texture, make_droplets, DropletParams, MetroTextures, Uniforms,
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
    let mut fut: std::pin::Pin<&mut F> = pin!(future);
    let waker: Waker = unsafe { Waker::from_raw(noop_raw_waker()) };
    let mut cx: Context<'_> = Context::from_waker(&waker);
    loop {
        if let Poll::Ready(value) = fut.as_mut().poll(&mut cx) {
            return value;
        }
        std::thread::yield_now();
    }
}

fn main() {
    block_on(async {
        let instance: wgpu::Instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::VULKAN,
            ..Default::default()
        });
        let adapter: wgpu::Adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower,
                compatible_surface: None,
                force_fallback_adapter: true,
            })
            .await
            .expect("没有可用的软件 Vulkan 适配器 (lavapipe)");
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("smoke-device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .expect("创建设备失败");

        let white: [u8; 64] = [255u8; 4 * 4 * 4];
        let bg: wgpu::Texture = create_texture(&device, &queue, "bg", 4, 4, &white);
        let far: wgpu::Texture = create_texture(&device, &queue, "far", 4, 4, &white);
        let mid: wgpu::Texture = create_texture(&device, &queue, "mid", 4, 4, &white);
        let near: wgpu::Texture = create_texture(&device, &queue, "near", 4, 4, &white);
        let dirt: wgpu::Texture = create_texture(&device, &queue, "dirt", 4, 4, &white);
        let fog: wgpu::Texture = create_texture(&device, &queue, "fog", 4, 4, &white);
        let interior: wgpu::Texture = create_texture(&device, &queue, "interior", 4, 4, &white);

        let sampler: wgpu::Sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("smoke-sampler"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let vertices: [f32; 16] = [
            -1.0, -1.0, 0.0, 1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0,
        ];
        let indices: [u16; 6] = [0, 1, 2, 1, 3, 2];
        let vertex_buffer: wgpu::Buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("vertices"),
                contents: bytemuck::cast_slice(&vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
        let index_buffer: wgpu::Buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("indices"),
                contents: bytemuck::cast_slice(&indices),
                usage: wgpu::BufferUsages::INDEX,
            });

        let uniforms: Uniforms = Uniforms::new(1.0, 0.016, 1, 256, 256);
        let uniform_buffer: wgpu::Buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("uniforms"),
                contents: bytemuck::bytes_of(&uniforms),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
        let droplet_params: DropletParams = DropletParams::DEFAULT;
        let droplet_params_buffer: wgpu::Buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("droplet-params"),
                contents: bytemuck::bytes_of(&droplet_params),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
        let droplets: Vec<metro_window::Droplet> = make_droplets(&droplet_params);
        let droplet_buffer: wgpu::Buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("droplets"),
                contents: bytemuck::cast_slice(&droplets),
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            });

        let refraction_texture: wgpu::Texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("smoke-refraction"),
            size: wgpu::Extent3d {
                width: 4,
                height: 4,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let refraction_view: wgpu::TextureView =
            refraction_texture.create_view(&Default::default());
        let refraction_sampler: wgpu::Sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("smoke-refraction-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let views: [wgpu::TextureView; 7] = [
            bg.create_view(&Default::default()),
            far.create_view(&Default::default()),
            mid.create_view(&Default::default()),
            near.create_view(&Default::default()),
            dirt.create_view(&Default::default()),
            fog.create_view(&Default::default()),
            interior.create_view(&Default::default()),
        ];
        let pipelines: metro_window::MetroPipelines = create_metro_pipelines(
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

        let target: wgpu::Texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("smoke-target"),
            size: wgpu::Extent3d {
                width: 256,
                height: 256,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let target_view: wgpu::TextureView = target.create_view(&Default::default());

        let mut encoder: wgpu::CommandEncoder = device.create_command_encoder(&Default::default());
        {
            let mut pass: wgpu::ComputePass<'_> =
                encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("smoke-compute-pass"),
                    timestamp_writes: None,
                });
            pass.set_pipeline(&pipelines.physics_pipeline);
            pass.set_bind_group(0, &pipelines.compute_bind_group, &[]);
            pass.dispatch_workgroups(1, 1, 1);
            pass.set_pipeline(&pipelines.refraction_pipeline);
            pass.dispatch_workgroups(1, 1, 1);
        }
        {
            let mut pass: wgpu::RenderPass<'_> =
                encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("smoke-render-pass"),
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

        let readback: wgpu::Buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: 256 * 256 * 4,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let refraction_readback: wgpu::Buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("refraction-readback"),
            size: 4 * 256,
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
                    bytes_per_row: Some(256 * 4),
                    rows_per_image: Some(256),
                },
            },
            wgpu::Extent3d {
                width: 256,
                height: 256,
                depth_or_array_layers: 1,
            },
        );
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &refraction_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &refraction_readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(256),
                    rows_per_image: Some(4),
                },
            },
            wgpu::Extent3d {
                width: 4,
                height: 4,
                depth_or_array_layers: 1,
            },
        );
        queue.submit(Some(encoder.finish()));

        let slice: wgpu::BufferSlice<'_> = readback.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            tx.send(result).ok();
        });
        device.poll(wgpu::Maintain::Wait);
        rx.recv().expect("map 回调未触发").expect("map 失败");
        let data: wgpu::BufferView<'_> = slice.get_mapped_range();
        let nonzero: usize = data.iter().filter(|&&b| b != 0).count();
        println!("渲染输出像素: {} 字节非零 / {}", nonzero, data.len());
        drop(data);
        assert!(nonzero > 0, "渲染结果全黑");

        let rslice: wgpu::BufferSlice<'_> = refraction_readback.slice(..);
        let (rtx, rrx) = std::sync::mpsc::channel();
        rslice.map_async(wgpu::MapMode::Read, move |result| {
            rtx.send(result).ok();
        });
        device.poll(wgpu::Maintain::Wait);
        rrx.recv()
            .expect("refraction map 回调未触发")
            .expect("refraction map 失败");
        let rdata = rslice.get_mapped_range();
        let mut min_r: f32 = f32::MAX;
        let mut max_r: f32 = f32::MIN;
        let mut min_g: f32 = f32::MAX;
        let mut max_g: f32 = f32::MIN;
        for row in 0..4 {
            let base: usize = row * 256;
            for chunk in rdata[base..base + 32].as_chunks::<8>().0 {
                let r = half_to_f32(u16::from_le_bytes([chunk[0], chunk[1]]));
                let g = half_to_f32(u16::from_le_bytes([chunk[2], chunk[3]]));
                min_r = min_r.min(r);
                max_r = max_r.max(r);
                min_g = min_g.min(g);
                max_g = max_g.max(g);
            }
        }
        drop(rdata);
        println!("斯涅尔折射偏移图 (4x4): r=[{min_r:.5}, {max_r:.5}] g=[{min_g:.5}, {max_g:.5}]");
        assert!(
            max_r.abs() > 0.0001 || max_g.abs() > 0.0001,
            "折射偏移全为零"
        );
        println!("native smoke 测试通过: 水滴物理 + 斯涅尔折射 + 渲染管线可用");
    });
}

fn half_to_f32(h: u16) -> f32 {
    let sign: u32 = ((h >> 15) & 1) as u32;
    let exp: u32 = ((h >> 10) & 0x1f) as u32;
    let mant: u32 = (h & 0x3ff) as u32;
    let bits: u32 = if exp == 0 {
        if mant == 0 {
            sign << 31
        } else {
            let e: i32 = -14i32;
            let mut m: u32 = mant;
            let mut e: i32 = e;
            while m & 0x400 == 0 {
                m <<= 1;
                e -= 1;
            }
            m &= 0x3ff;
            (sign << 31) | (((e + 127) as u32) << 23) | (m << 13)
        }
    } else if exp == 0x1f {
        if mant == 0 {
            (sign << 31) | 0x7f80_0000
        } else {
            (sign << 31) | 0x7fc0_0000
        }
    } else {
        (sign << 31) | ((exp + 112) << 23) | (mant << 13)
    };
    f32::from_bits(bits)
}
