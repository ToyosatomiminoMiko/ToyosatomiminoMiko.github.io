/*
原生冒烟测试
- 使用 lavapipe 验证 水滴物理 + 斯涅尔折射 + 渲染管线 可正常执行
- 断言渲染输出非全黑/折射偏移图非全零
*/
use metro_window::{
    create_metro_pipelines, create_texture, make_droplets, DropletParams, MetroTextures, Uniforms,
    FULLSCREEN_QUAD_INDICES, FULLSCREEN_QUAD_VERTICES, QUAD_INDEX_FORMAT,
    REFRACTION_TEXTURE_FORMAT, REFRACTION_WORKGROUP_EDGE, RENDER_TARGET_FORMAT,
    RGBA_BYTES_PER_PIXEL, SAMPLER_ADDRESS_MODE_CLAMP, SAMPLER_ADDRESS_MODE_REPEAT,
    SAMPLER_FILTER_MODE,
};
use wgpu::util::DeviceExt;

// ===== 原生冒烟测试参数(仅本示例使用)=====
/// 纯色测试贴图的边长(像素):4×4 已足够覆盖上传 / 采样路径.
const SMOKE_TEXTURE_SIZE: u32 = 4;
/// 渲染目标边长(像素):256 便于读回后统计非零像素.
const SMOKE_TARGET_SIZE: u32 = 256;
/// 折射偏移图边长(像素).
///
/// 不能取小值:水滴位置是随机的,4×4 只有 16 个采样点,而水滴半径只有
/// 0.006..0.024,随机跑起来经常一个采样点都没被覆盖,断言"折射偏移非零"就会
/// 假失败(实测约 1/6 次).64×64 = 4096 个采样点,而且正好是折射计算着色器
/// 一个 8×8 workgroup 覆盖的尺寸,非零几乎是必然事件.
const SMOKE_REFRACTION_SIZE: u32 = 64;
/// 纹理->缓冲区复制时每行字节的对齐要求(wgpu COPY_BYTES_PER_ROW_ALIGNMENT).
const COPY_ROW_ALIGNMENT: u32 = 256;
/// Rgba16Float 每像素字节数.
const RGBA16F_BYTES_PER_PIXEL: u32 = 8;
/// 折射偏移图每行字节数:64 像素 × 8 字节 = 512,恰是 256 的整数倍,无需补位.
const SMOKE_REFRACTION_ROW_BYTES: u32 = SMOKE_REFRACTION_SIZE * RGBA16F_BYTES_PER_PIXEL;
// 行距必须满足 wgpu 的对齐要求,否则 copy_texture_to_buffer 会校验失败.
const _: () = assert!(SMOKE_REFRACTION_ROW_BYTES.is_multiple_of(COPY_ROW_ALIGNMENT));
/// 纯白测试贴图的字节数(宽 × 高 × RGBA).
const SMOKE_TEXTURE_BYTES: usize =
    (SMOKE_TEXTURE_SIZE * SMOKE_TEXTURE_SIZE * RGBA_BYTES_PER_PIXEL) as usize;
/// 写入 Uniforms 的初始时间(秒),取非 0 让水滴已经运动过.
const SMOKE_TIME_SECONDS: f32 = 1.0;
/// 写入 Uniforms 的帧间隔(秒).
const SMOKE_DELTA_SECONDS: f32 = 0.016;
/// 写入 Uniforms 的样式编号.
const SMOKE_STYLE_ID: u32 = 1;
/// 折射偏移非零的判定阈值:低于它视为"折射偏移全为零".
const REFRACTION_NONZERO_EPSILON: f32 = 0.0001;

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

        let white: [u8; SMOKE_TEXTURE_BYTES] = [255u8; SMOKE_TEXTURE_BYTES];
        let bg: wgpu::Texture = create_texture(
            &device,
            &queue,
            "bg",
            SMOKE_TEXTURE_SIZE,
            SMOKE_TEXTURE_SIZE,
            &white,
        );
        let far: wgpu::Texture = create_texture(
            &device,
            &queue,
            "far",
            SMOKE_TEXTURE_SIZE,
            SMOKE_TEXTURE_SIZE,
            &white,
        );
        let mid: wgpu::Texture = create_texture(
            &device,
            &queue,
            "mid",
            SMOKE_TEXTURE_SIZE,
            SMOKE_TEXTURE_SIZE,
            &white,
        );
        let near: wgpu::Texture = create_texture(
            &device,
            &queue,
            "near",
            SMOKE_TEXTURE_SIZE,
            SMOKE_TEXTURE_SIZE,
            &white,
        );
        let dirt: wgpu::Texture = create_texture(
            &device,
            &queue,
            "dirt",
            SMOKE_TEXTURE_SIZE,
            SMOKE_TEXTURE_SIZE,
            &white,
        );
        let fog: wgpu::Texture = create_texture(
            &device,
            &queue,
            "fog",
            SMOKE_TEXTURE_SIZE,
            SMOKE_TEXTURE_SIZE,
            &white,
        );
        let interior: wgpu::Texture = create_texture(
            &device,
            &queue,
            "interior",
            SMOKE_TEXTURE_SIZE,
            SMOKE_TEXTURE_SIZE,
            &white,
        );

        let sampler: wgpu::Sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("smoke-sampler"),
            address_mode_u: SAMPLER_ADDRESS_MODE_REPEAT,
            address_mode_v: SAMPLER_ADDRESS_MODE_CLAMP,
            address_mode_w: SAMPLER_ADDRESS_MODE_CLAMP,
            mag_filter: SAMPLER_FILTER_MODE,
            min_filter: SAMPLER_FILTER_MODE,
            mipmap_filter: SAMPLER_FILTER_MODE,
            ..Default::default()
        });

        let vertex_buffer: wgpu::Buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("vertices"),
                contents: bytemuck::cast_slice(&FULLSCREEN_QUAD_VERTICES),
                usage: wgpu::BufferUsages::VERTEX,
            });
        let index_buffer: wgpu::Buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("indices"),
                contents: bytemuck::cast_slice(&FULLSCREEN_QUAD_INDICES),
                usage: wgpu::BufferUsages::INDEX,
            });

        let uniforms: Uniforms =
            Uniforms::new(SMOKE_TIME_SECONDS, SMOKE_DELTA_SECONDS, SMOKE_STYLE_ID);
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
                width: SMOKE_REFRACTION_SIZE,
                height: SMOKE_REFRACTION_SIZE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: REFRACTION_TEXTURE_FORMAT,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let refraction_view: wgpu::TextureView =
            refraction_texture.create_view(&Default::default());
        let refraction_sampler: wgpu::Sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("smoke-refraction-sampler"),
            address_mode_u: SAMPLER_ADDRESS_MODE_CLAMP,
            address_mode_v: SAMPLER_ADDRESS_MODE_CLAMP,
            address_mode_w: SAMPLER_ADDRESS_MODE_CLAMP,
            mag_filter: SAMPLER_FILTER_MODE,
            min_filter: SAMPLER_FILTER_MODE,
            mipmap_filter: SAMPLER_FILTER_MODE,
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

        let target: wgpu::Texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("smoke-target"),
            size: wgpu::Extent3d {
                width: SMOKE_TARGET_SIZE,
                height: SMOKE_TARGET_SIZE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: RENDER_TARGET_FORMAT,
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
            // 折射偏移图 64×64,一个 workgroup 只覆盖 8×8 像素:
            // 必须铺满 8×8 个 workgroup,否则只有左上角一小块被计算,断言会假失败.
            pass.dispatch_workgroups(
                SMOKE_REFRACTION_SIZE.div_ceil(REFRACTION_WORKGROUP_EDGE),
                SMOKE_REFRACTION_SIZE.div_ceil(REFRACTION_WORKGROUP_EDGE),
                1,
            );
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
            pass.set_index_buffer(index_buffer.slice(..), QUAD_INDEX_FORMAT);
            pass.set_bind_group(0, &pipelines.render_bind_group, &[]);
            pass.draw_indexed(0..FULLSCREEN_QUAD_INDICES.len() as u32, 0, 0..1);
        }

        let readback: wgpu::Buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: (SMOKE_TARGET_SIZE * SMOKE_TARGET_SIZE * RGBA_BYTES_PER_PIXEL) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let refraction_readback: wgpu::Buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("refraction-readback"),
            size: (SMOKE_REFRACTION_SIZE * SMOKE_REFRACTION_ROW_BYTES) as u64,
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
                    bytes_per_row: Some(SMOKE_TARGET_SIZE * RGBA_BYTES_PER_PIXEL),
                    rows_per_image: Some(SMOKE_TARGET_SIZE),
                },
            },
            wgpu::Extent3d {
                width: SMOKE_TARGET_SIZE,
                height: SMOKE_TARGET_SIZE,
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
                    bytes_per_row: Some(SMOKE_REFRACTION_ROW_BYTES),
                    rows_per_image: Some(SMOKE_REFRACTION_SIZE),
                },
            },
            wgpu::Extent3d {
                width: SMOKE_REFRACTION_SIZE,
                height: SMOKE_REFRACTION_SIZE,
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
        for row in 0..SMOKE_REFRACTION_SIZE as usize {
            let base: usize = row * SMOKE_REFRACTION_ROW_BYTES as usize;
            let row_bytes = SMOKE_REFRACTION_ROW_BYTES as usize;
            for chunk in rdata[base..base + row_bytes]
                .as_chunks::<{ RGBA16F_BYTES_PER_PIXEL as usize }>()
                .0
            {
                let r = half_to_f32(u16::from_le_bytes([chunk[0], chunk[1]]));
                let g = half_to_f32(u16::from_le_bytes([chunk[2], chunk[3]]));
                min_r = min_r.min(r);
                max_r = max_r.max(r);
                min_g = min_g.min(g);
                max_g = max_g.max(g);
            }
        }
        drop(rdata);
        println!("斯涅尔折射偏移图 ({SMOKE_REFRACTION_SIZE}x{SMOKE_REFRACTION_SIZE}): r=[{min_r:.5}, {max_r:.5}] g=[{min_g:.5}, {max_g:.5}]");
        assert!(
            max_r.abs() > REFRACTION_NONZERO_EPSILON || max_g.abs() > REFRACTION_NONZERO_EPSILON,
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
