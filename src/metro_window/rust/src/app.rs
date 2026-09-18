/*
WebGPU 应用主体
- 初始化适配器 / 设备 / 渲染表面,以及全部 GPU 资源
- 每帧更新 Uniforms,依次执行 水滴物理 -> 折射偏移 -> 渲染 三个 Pass
*/
use crate::app_params::{
    city_png, CITY_BG_FILE, CITY_FAR_FILE, CITY_MID_FILE, CITY_NEAR_FILE, FRAME_INTERVAL_MS,
    INITIAL_DELTA_SECONDS, INITIAL_STYLE_ID, INITIAL_TIME_SECONDS, MAX_FRAME_DELTA_SECONDS,
    MS_PER_SECOND,
};
use crate::droplet_params::DropletParams;
use crate::droplets::make_droplets;
use crate::performance_now;
use crate::pipelines::{create_metro_pipelines, MetroTextures};
use crate::render_params::{
    ADAPTER_POWER_PREFERENCE, CLEAR_COLOR, FULLSCREEN_QUAD_INDICES, FULLSCREEN_QUAD_VERTICES,
    MIN_TEXTURE_DIMENSION, QUAD_INDEX_FORMAT, REFRACTION_DOWNSCALE, REFRACTION_TEXTURE_FORMAT,
    REFRACTION_WORKGROUP_DEPTH, REFRACTION_WORKGROUP_EDGE, SAMPLER_ADDRESS_MODE_CLAMP,
    SAMPLER_ADDRESS_MODE_REPEAT, SAMPLER_FILTER_MODE, SURFACE_MAX_FRAME_LATENCY,
    SURFACE_PRESENT_MODE,
};
use crate::texture_params::{DIRT_TEXTURE_SIZE, FOG_TEXTURE_SIZE, INTERIOR_TEXTURE_SIZE};
use crate::textures::{
    create_png_texture, create_texture, generate_dirt, generate_fog, generate_interior,
};
use crate::uniforms::Uniforms;
use web_sys::{console, HtmlCanvasElement, HtmlElement};
use wgpu::util::DeviceExt;

// 城市贴图的路径前缀 / 文件名,以及"为什么必须用绝对路径"的说明,
// 全部集中在 src/app_params.rs(见 RESOURCE_BASE / CITY_*_FILE / city_png).

pub(crate) struct App {
    pub(crate) device: wgpu::Device,
    pub(crate) queue: wgpu::Queue,
    pub(crate) surface: wgpu::Surface<'static>,
    pub(crate) render_pipeline: wgpu::RenderPipeline,
    pub(crate) physics_pipeline: wgpu::ComputePipeline,
    pub(crate) refraction_pipeline: wgpu::ComputePipeline,
    pub(crate) render_bind_group: wgpu::BindGroup,
    pub(crate) compute_bind_group: wgpu::BindGroup,
    pub(crate) vertex_buffer: wgpu::Buffer,
    pub(crate) index_buffer: wgpu::Buffer,
    pub(crate) uniform_buffer: wgpu::Buffer,
    pub(crate) droplet_params_buffer: wgpu::Buffer,
    pub(crate) droplet_buffer: wgpu::Buffer,
    pub(crate) droplet_params: DropletParams,
    pub(crate) refraction_size: (u32, u32),
    /// 画布宽高比(宽 / 高):每帧写进 Uniforms,着色器据此把水滴画成正圆,
    /// 而不是被 [0,1]² 的 uv 拉成椭圆(见 src/uniforms.rs 的 aspect 注释).
    pub(crate) aspect: f32,
    pub(crate) time: f32,
    pub(crate) last: f64,
    pub(crate) frame_accumulator: f64,
    pub(crate) running: bool,
    pub(crate) style: u32,
}

pub(crate) fn set_status(status: &HtmlElement, message: &str) {
    status.set_text_content(Some(message));
    console::log_1(&message.into());
}

impl App {
    pub(crate) async fn new(
        canvas: HtmlCanvasElement,
        status: HtmlElement,
    ) -> Result<Self, String> {
        set_status(&status, "正在初始化 WebGPU 适配器...");

        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });
        let surface = create_surface(&instance, canvas.clone())?;

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: ADAPTER_POWER_PREFERENCE,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| "当前浏览器未提供 WebGPU 适配器(No available adapters).请检查是否已启用 WebGPU 与硬件加速后刷新重试".to_string())?;

        let adapter_info = adapter.get_info();
        if adapter_info.device_type == wgpu::DeviceType::Cpu {
            return Err(format!(
                "当前 WebGPU 适配器为 CPU 软件渲染({}),无法满足性能要求.请开启浏览器硬件加速,并确认 chrome://gpu 中 WebGPU 使用独立显卡后重试",
                adapter_info.name
            ));
        }

        set_status(&status, "正在创建 WebGPU 设备...");
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("metro-window-device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .map_err(|e| format!("无法获取 WebGPU 设备: {e}"))?;

        let width = canvas.width().max(MIN_TEXTURE_DIMENSION);
        let height = canvas.height().max(MIN_TEXTURE_DIMENSION);
        // 水滴形状依赖画布宽高比(见 src/uniforms.rs 的 aspect 注释):
        // 画布分辨率取自 HTML 上的固定属性,没有 resize 路径,所以只算一次.
        let aspect: f32 = width as f32 / height as f32;
        let caps = surface.get_capabilities(&adapter);
        let format = caps.formats[0];
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width,
            height,
            present_mode: SURFACE_PRESENT_MODE,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: SURFACE_MAX_FRAME_LATENCY,
        };
        surface.configure(&device, &config);

        // 用绝对路径(见 RESOURCE_BASE)而不是相对路径:
        // 相对路径会随页面 URL 变化(例如 /web/index.html 这类回退地址),
        // 导致 fetch 拿到 HTML 回退页而不是 PNG,从而报 Invalid PNG signature.
        set_status(&status, "正在加载城市纹理 (1/4)...");
        let bg = create_png_texture(&device, &queue, "city_bg", &city_png(CITY_BG_FILE)).await?;
        set_status(&status, "正在加载城市纹理 (2/4)...");
        let far = create_png_texture(&device, &queue, "city_far", &city_png(CITY_FAR_FILE)).await?;
        set_status(&status, "正在加载城市纹理 (3/4)...");
        let mid = create_png_texture(&device, &queue, "city_mid", &city_png(CITY_MID_FILE)).await?;
        set_status(&status, "正在加载城市纹理 (4/4)...");
        let near =
            create_png_texture(&device, &queue, "city_near", &city_png(CITY_NEAR_FILE)).await?;

        set_status(&status, "正在生成玻璃材质纹理...");
        let (dw, dh, dirt_data) = generate_dirt(DIRT_TEXTURE_SIZE.0, DIRT_TEXTURE_SIZE.1);
        let dirt = create_texture(&device, &queue, "glass_dirt", dw, dh, &dirt_data);
        let (fw, fh, fog_data) = generate_fog(FOG_TEXTURE_SIZE.0, FOG_TEXTURE_SIZE.1);
        let fog = create_texture(&device, &queue, "condensation_fog", fw, fh, &fog_data);
        let (iw, ih, interior_data) =
            generate_interior(INTERIOR_TEXTURE_SIZE.0, INTERIOR_TEXTURE_SIZE.1);
        let interior = create_texture(
            &device,
            &queue,
            "interior_reflection",
            iw,
            ih,
            &interior_data,
        );

        // 采样器约定:u = Repeat(城市层要靠它循环滚动),v = ClampToEdge.
        // 喂给它的"程序化生成"贴图(雾,污渍)因此必须双向可平铺:
        //   - u 越界由 Repeat 折回(左右边对不上 => 贯穿画面的竖缝);
        //   - v 越界由 ClampToEdge 把最后一行拉满整段
        //     (污渍 uv*2 => 下半屏,雾气 uv*1.3 => 77% 以下被水平拉伸),
        //   所以着色器里对这两层的坐标先 fract 折回 [0,1)(见 shaders.wgsl).
        // 周期在 textures.rs 的 value_noise/fbm/scratch_mask 里保证.
        // 城市 PNG 是美术素材,左右边缘本来就有差异,不适用这条(实测跳变很弱).
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("metro-sampler"),
            address_mode_u: SAMPLER_ADDRESS_MODE_REPEAT,
            address_mode_v: SAMPLER_ADDRESS_MODE_CLAMP,
            address_mode_w: SAMPLER_ADDRESS_MODE_CLAMP,
            mag_filter: SAMPLER_FILTER_MODE,
            min_filter: SAMPLER_FILTER_MODE,
            mipmap_filter: SAMPLER_FILTER_MODE,
            ..Default::default()
        });

        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("fullscreen-quad-vertices"),
            contents: bytemuck::cast_slice(&FULLSCREEN_QUAD_VERTICES),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("fullscreen-quad-indices"),
            contents: bytemuck::cast_slice(&FULLSCREEN_QUAD_INDICES),
            usage: wgpu::BufferUsages::INDEX,
        });

        let uniforms = Uniforms::new(
            INITIAL_TIME_SECONDS,
            INITIAL_DELTA_SECONDS,
            INITIAL_STYLE_ID,
            aspect,
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

        // 折射偏移图分辨率 = 画布 1/REFRACTION_DOWNSCALE.
        // 调大(如 /6//4)水珠边缘更锐利但更耗 GPU;
        // 调小(如 /10//12)更省性能但水珠会偏模糊
        let rw = (width / REFRACTION_DOWNSCALE).max(MIN_TEXTURE_DIMENSION);
        let rh = (height / REFRACTION_DOWNSCALE).max(MIN_TEXTURE_DIMENSION);
        let refraction_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("refraction-offset"),
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
            label: Some("refraction-sampler"),
            address_mode_u: SAMPLER_ADDRESS_MODE_CLAMP,
            address_mode_v: SAMPLER_ADDRESS_MODE_CLAMP,
            address_mode_w: SAMPLER_ADDRESS_MODE_CLAMP,
            mag_filter: SAMPLER_FILTER_MODE,
            min_filter: SAMPLER_FILTER_MODE,
            mipmap_filter: SAMPLER_FILTER_MODE,
            ..Default::default()
        });

        let bg_view = bg.create_view(&Default::default());
        let far_view = far.create_view(&Default::default());
        let mid_view = mid.create_view(&Default::default());
        let near_view = near.create_view(&Default::default());
        let dirt_view = dirt.create_view(&Default::default());
        let fog_view = fog.create_view(&Default::default());
        let interior_view = interior.create_view(&Default::default());

        // 这里创建的纹理视图(包括折射偏移图)全部只在建绑定时用到;
        // wgpu 的 BindGroup 会持有资源的强引用,所以建完之后不需要再把它们
        // 塞进 App 里"保命"(旧代码为此留了两个 #[allow(dead_code)] 字段).
        let pipelines = create_metro_pipelines(
            &device,
            format,
            &uniform_buffer,
            &droplet_params_buffer,
            &droplet_buffer,
            MetroTextures {
                refraction_view: &refraction_view,
                refraction_sampler: &refraction_sampler,
                sampler: &sampler,
                texture_views: [
                    &bg_view,
                    &far_view,
                    &mid_view,
                    &near_view,
                    &dirt_view,
                    &fog_view,
                    &interior_view,
                ],
            },
        );

        set_status(&status, "✅ WebGPU 初始化成功");

        Ok(Self {
            device,
            queue,
            surface,
            render_pipeline: pipelines.render_pipeline,
            physics_pipeline: pipelines.physics_pipeline,
            refraction_pipeline: pipelines.refraction_pipeline,
            render_bind_group: pipelines.render_bind_group,
            compute_bind_group: pipelines.compute_bind_group,
            vertex_buffer,
            index_buffer,
            uniform_buffer,
            droplet_params_buffer,
            droplet_buffer,
            droplet_params,
            refraction_size: (rw, rh),
            aspect,
            time: 0.0,
            last: performance_now(),
            frame_accumulator: 0.0,
            running: true,
            style: 0,
        })
    }

    pub(crate) fn frame(&mut self) {
        let now: f64 = performance_now();
        let elapsed_ms: f64 = now - self.last;
        self.last = now;
        // performance.now() 单位是毫秒,按 MS_PER_SECOND 换算成秒再交给着色器;
        // 再用 MAX_FRAME_DELTA_SECONDS 截断掉帧造成的超大时间步.
        let delta: f32 = ((elapsed_ms as f32) / MS_PER_SECOND).min(MAX_FRAME_DELTA_SECONDS);
        self.time += delta;

        if !self.running {
            return;
        }

        // 限帧:累计真实流逝时间,达到 1/60 秒才真正渲染一帧
        self.frame_accumulator += elapsed_ms;
        if self.frame_accumulator < FRAME_INTERVAL_MS {
            return;
        }
        self.frame_accumulator %= FRAME_INTERVAL_MS;

        let uniforms: Uniforms = Uniforms::new(self.time, delta, self.style, self.aspect);
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
        self.queue.write_buffer(
            &self.droplet_params_buffer,
            0,
            bytemuck::bytes_of(&self.droplet_params),
        );

        let frame: wgpu::SurfaceTexture = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(e) => {
                console::warn_1(&format!("surface error: {e:?}").into());
                return;
            }
        };
        let view: wgpu::TextureView = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder: wgpu::CommandEncoder =
            self.device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("metro-encoder"),
                });

        {
            let mut pass: wgpu::ComputePass<'_> =
                encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("droplet-physics-and-refraction"),
                    timestamp_writes: None,
                });
            pass.set_pipeline(&self.physics_pipeline);
            pass.set_bind_group(0, &self.compute_bind_group, &[]);
            pass.dispatch_workgroups(1, 1, 1);
            pass.set_pipeline(&self.refraction_pipeline);
            pass.dispatch_workgroups(
                self.refraction_size.0.div_ceil(REFRACTION_WORKGROUP_EDGE),
                self.refraction_size.1.div_ceil(REFRACTION_WORKGROUP_EDGE),
                REFRACTION_WORKGROUP_DEPTH,
            );
        }

        {
            let mut pass: wgpu::RenderPass<'_> =
                encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("metro-render"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(CLEAR_COLOR),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });
            pass.set_pipeline(&self.render_pipeline);
            pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
            pass.set_index_buffer(self.index_buffer.slice(..), QUAD_INDEX_FORMAT);
            pass.set_bind_group(0, &self.render_bind_group, &[]);
            pass.draw_indexed(0..FULLSCREEN_QUAD_INDICES.len() as u32, 0, 0..1);
        }

        self.queue.submit(Some(encoder.finish()));
        frame.present();
    }
}

#[cfg(target_arch = "wasm32")]
fn create_surface(
    instance: &wgpu::Instance,
    canvas: HtmlCanvasElement,
) -> Result<wgpu::Surface<'static>, String> {
    instance
        .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
        .map_err(|e| format!("创建渲染表面失败: {e:?}"))
}

#[cfg(not(target_arch = "wasm32"))]
fn create_surface(
    _instance: &wgpu::Instance,
    _canvas: HtmlCanvasElement,
) -> Result<wgpu::Surface<'static>, String> {
    Err("WebGPU surface 仅支持 wasm32 目标".into())
}
