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
use crate::pipelines::{create_bind_groups, create_metro_pipelines, MetroTextures};
use crate::render_params::{
    ADAPTER_POWER_PREFERENCE, CLEAR_COLOR, FULLSCREEN_QUAD_INDICES, FULLSCREEN_QUAD_VERTICES,
    MIN_TEXTURE_DIMENSION, QUAD_INDEX_FORMAT, REFRACTION_DOWNSCALE, REFRACTION_TEXTURE_FORMAT,
    REFRACTION_WORKGROUP_DEPTH, REFRACTION_WORKGROUP_EDGE, SAMPLER_ADDRESS_MODE_CLAMP,
    SAMPLER_ADDRESS_MODE_REPEAT, SAMPLER_FILTER_MODE, SURFACE_MAX_FRAME_LATENCY,
    SURFACE_PRESENT_MODE, TEXTURE_LAYER_COUNT,
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
    /// 渲染表面的当前配置.**尺寸变化时改的就是它**:宽高必须与画布的
    /// `width`/`height` 属性一致,否则 `get_current_texture` 拿到的尺寸对不上.
    pub(crate) surface_config: wgpu::SurfaceConfiguration,
    pub(crate) render_pipeline: wgpu::RenderPipeline,
    pub(crate) physics_pipeline: wgpu::ComputePipeline,
    pub(crate) refraction_pipeline: wgpu::ComputePipeline,
    pub(crate) render_bind_group: wgpu::BindGroup,
    pub(crate) compute_bind_group: wgpu::BindGroup,
    /// 重建绑定组要用的两个布局(与尺寸无关,建一次留着)
    pub(crate) compute_bgl: wgpu::BindGroupLayout,
    pub(crate) render_bgl: wgpu::BindGroupLayout,
    /// 与画布尺寸**无关**的那些纹理视图(城市四层 / 污渍 / 雾气 / 车厢倒影)
    /// 与两个采样器:重建绑定组时要把它们重新绑一遍,所以必须留在 App 里.
    /// (早先它们是纯局部变量 -- 绑定组自己持有强引用就够"保命";
    /// 现在多了一个"重建绑定组"的用处,所以留下来.)
    pub(crate) material_views: [wgpu::TextureView; TEXTURE_LAYER_COUNT as usize],
    pub(crate) sampler: wgpu::Sampler,
    pub(crate) refraction_sampler: wgpu::Sampler,
    pub(crate) vertex_buffer: wgpu::Buffer,
    pub(crate) index_buffer: wgpu::Buffer,
    pub(crate) uniform_buffer: wgpu::Buffer,
    pub(crate) droplet_params_buffer: wgpu::Buffer,
    pub(crate) droplet_buffer: wgpu::Buffer,
    pub(crate) droplet_params: DropletParams,
    pub(crate) refraction_size: (u32, u32),
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
        let caps = surface.get_capabilities(&adapter);
        let format = caps.formats[0];
        // 画布宽高比不再单独存一份:它就是 surface_config 的 width / height,
        // 尺寸一变两者一起改,不会出现"改了尺寸忘了改 aspect"的漂移(见 App::aspect).
        let surface_config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width,
            height,
            present_mode: SURFACE_PRESENT_MODE,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: SURFACE_MAX_FRAME_LATENCY,
        };
        surface.configure(&device, &surface_config);

        // 用绝对路径(见 RESOURCE_BASE)而不是相对路径:
        // 相对路径会随页面 URL 变化(例如 /4xx_page/404.html 这类回退地址),
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

        // 首帧的 aspect 由刚定下的 surface 尺寸算(之后每帧都从 App::aspect() 取).
        let aspect: f32 = surface_config.width as f32 / surface_config.height as f32;
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
        // 它只决定"水珠归属判断"的精细度(哪颗水珠管这个像素 / 圆心 / 归一化距离),
        // 折射偏移本身由片段着色器逐像素解析重建,所以调大只会让多颗水珠重叠处
        // 变粗,不会把水珠轮廓压成方块(详见 render_params.rs 的 REFRACTION_DOWNSCALE).
        let (refraction_texture, refraction_size) =
            create_refraction_texture(&device, width, height);
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

        // 材质纹理视图存成数组:既喂给绑定组,也留在 App 里,
        // 尺寸变化时重建绑定组要把它们重新绑一遍(城市层等与画布尺寸无关).
        let material_views: [wgpu::TextureView; TEXTURE_LAYER_COUNT as usize] = [
            bg.create_view(&Default::default()),
            far.create_view(&Default::default()),
            mid.create_view(&Default::default()),
            near.create_view(&Default::default()),
            dirt.create_view(&Default::default()),
            fog.create_view(&Default::default()),
            interior.create_view(&Default::default()),
        ];

        // 这里创建的纹理视图(包括折射偏移图)全部只在建绑定时用到;
        // wgpu 的 BindGroup 会持有资源的强引用,所以建完之后不需要再把"纹理"
        // 塞进 App 里保命 -- 但材质视图本身要留着,重建绑定时还得用(见字段注释).
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
                texture_views: std::array::from_fn(|i| &material_views[i]),
            },
        );

        set_status(&status, "✅ WebGPU 初始化成功");

        Ok(Self {
            device,
            queue,
            surface,
            surface_config,
            render_pipeline: pipelines.render_pipeline,
            physics_pipeline: pipelines.physics_pipeline,
            refraction_pipeline: pipelines.refraction_pipeline,
            render_bind_group: pipelines.render_bind_group,
            compute_bind_group: pipelines.compute_bind_group,
            compute_bgl: pipelines.compute_bgl,
            render_bgl: pipelines.render_bgl,
            material_views,
            sampler,
            refraction_sampler,
            vertex_buffer,
            index_buffer,
            uniform_buffer,
            droplet_params_buffer,
            droplet_buffer,
            droplet_params,
            refraction_size,
            time: 0.0,
            last: performance_now(),
            frame_accumulator: 0.0,
            running: true,
            style: 0,
        })
    }

    /// 画布宽高比(宽 / 高):每帧写进 Uniforms,着色器据此把水滴画成正圆,
    /// 而不是被 [0,1]² 的 uv 拉成椭圆(见 src/uniforms.rs 的 aspect 注释).
    /// 直接从 surface 配置里算,不另存字段 -- 尺寸一变两者必然同步.
    pub(crate) fn aspect(&self) -> f32 {
        self.surface_config.width as f32 / self.surface_config.height as f32
    }

    /// 画布后备缓冲尺寸变化(站点按视口算好 16:9 的"覆盖"尺寸后调用).
    ///
    /// 与尺寸挂钩的只有两样:
    ///   1. surface 的配置(宽高必须等于画布的 `width`/`height` 属性);
    ///   2. **按画布 1/8 分辨率**建的折射偏移图 -- 它直接由 width/height 算出来,
    ///      而两个绑定组都持有它的视图,所以绑定组必须一起重建.
    ///
    /// 管线与尺寸无关,这里**不重建管线**(重建会连带重新编译着色器,拖动窗口会卡).
    ///
    /// 画布属性由站点先改,再调这里:两件事必须在同一个任务里做完,
    /// 否则中间那一帧 `get_current_texture` 的尺寸会和配置对不上.
    pub(crate) fn resize(&mut self, width: u32, height: u32) {
        let width = width.max(MIN_TEXTURE_DIMENSION);
        let height = height.max(MIN_TEXTURE_DIMENSION);
        if (width, height) == (self.surface_config.width, self.surface_config.height) {
            return;
        }

        self.surface_config.width = width;
        self.surface_config.height = height;
        self.surface.configure(&self.device, &self.surface_config);

        let (refraction_texture, refraction_size) =
            create_refraction_texture(&self.device, width, height);
        self.refraction_size = refraction_size;
        // 纹理本体交出去也没关系:绑定组会持有它的强引用.
        let refraction_view = refraction_texture.create_view(&Default::default());

        let groups = create_bind_groups(
            &self.device,
            &self.uniform_buffer,
            &self.droplet_params_buffer,
            &self.droplet_buffer,
            MetroTextures {
                refraction_view: &refraction_view,
                refraction_sampler: &self.refraction_sampler,
                sampler: &self.sampler,
                texture_views: std::array::from_fn(|i| &self.material_views[i]),
            },
            &self.compute_bgl,
            &self.render_bgl,
        );
        self.render_bind_group = groups.render_bind_group;
        self.compute_bind_group = groups.compute_bind_group;
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

        let uniforms: Uniforms = Uniforms::new(self.time, delta, self.style, self.aspect());
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

/// 按画布尺寸建折射偏移图,返回纹理与它自己的分辨率.
/// 分辨率 = 画布 1/REFRACTION_DOWNSCALE(理由见调用处注释),
/// 建的时候(`App::new`)与画布尺寸变化时(`App::resize`)用的是同一份公式.
fn create_refraction_texture(
    device: &wgpu::Device,
    width: u32,
    height: u32,
) -> (wgpu::Texture, (u32, u32)) {
    let size = (
        (width / REFRACTION_DOWNSCALE).max(MIN_TEXTURE_DIMENSION),
        (height / REFRACTION_DOWNSCALE).max(MIN_TEXTURE_DIMENSION),
    );
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("refraction-offset"),
        size: wgpu::Extent3d {
            width: size.0,
            height: size.1,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: REFRACTION_TEXTURE_FORMAT,
        usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    (texture, size)
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
