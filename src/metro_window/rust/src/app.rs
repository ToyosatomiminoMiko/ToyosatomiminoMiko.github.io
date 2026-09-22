/*
WebGPU 应用主体
- 初始化适配器 / 设备 / 渲染表面,以及全部 GPU 资源
- 每帧更新 Uniforms 并跑一趟渲染(城市视差 / 污渍 / 雾气 / 车厢灯光)
*/
use crate::app_params::{
    city_png, upload_slot, upload_target, FRAME_INTERVAL_MS, INITIAL_STYLE_ID,
    INITIAL_TIME_SECONDS, LEVEL_0_FILE, LEVEL_1_FILE, LEVEL_2_FILE, LEVEL_3_FILE,
    MAX_FRAME_DELTA_SECONDS, MS_PER_SECOND,
};
use crate::glass_params::GlassParams;
use crate::performance_now;
use crate::pipelines::{create_metro_pipelines, create_render_bind_group, MetroTextures};
use crate::render_params::{
    ADAPTER_POWER_PREFERENCE, CLEAR_COLOR, FULLSCREEN_QUAD_INDICES, FULLSCREEN_QUAD_VERTICES,
    MIN_TEXTURE_DIMENSION, QUAD_INDEX_FORMAT, SAMPLER_ADDRESS_MODE_CLAMP,
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
    pub(crate) render_bind_group: wgpu::BindGroup,
    /// 渲染绑定组布局(与尺寸无关,建一次留着).
    /// 前端上传替换某一层贴图后要重建绑定组,重建必须用管线同一份布局.
    pub(crate) render_bgl: wgpu::BindGroupLayout,
    /// 与画布尺寸**无关**的那些纹理视图(城市四层 / 污渍 / 雾气 / 车厢倒影).
    ///
    /// 这个数组会被前端上传替换其中一项(见 [`App::set_layer_texture`]);
    /// 站点自带的原图始终留在 [`App::default_material_textures`] 里不动,
    /// 所以"恢复默认"只是把视图换回去,不需要重新联网 fetch.
    pub(crate) material_views: [wgpu::TextureView; TEXTURE_LAYER_COUNT as usize],
    /// 站点自带的默认材质贴图,下标与 [`App::material_views`] 一一对应
    /// (bg / far / mid / near / dirt / fog / interior),顺序也是
    /// `app_params::UPLOADABLE_LAYERS` 里槽位号的来源.
    pub(crate) default_material_textures: [wgpu::Texture; TEXTURE_LAYER_COUNT as usize],
    pub(crate) sampler: wgpu::Sampler,
    pub(crate) vertex_buffer: wgpu::Buffer,
    pub(crate) index_buffer: wgpu::Buffer,
    pub(crate) uniform_buffer: wgpu::Buffer,
    pub(crate) glass_params_buffer: wgpu::Buffer,
    pub(crate) glass_params: GlassParams,
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
        //
        // 除最远的背景层(level_3)外都预乘 alpha(它实测 alpha 恒为 255,是底层实景).
        // 预乘的理由见 textures.rs 的 premultiply_alpha.
        set_status(&status, "正在加载城市纹理 (1/4)...");
        let bg =
            create_png_texture(&device, &queue, "level_3", &city_png(LEVEL_3_FILE), false).await?;
        set_status(&status, "正在加载城市纹理 (2/4)...");
        let far =
            create_png_texture(&device, &queue, "level_2", &city_png(LEVEL_2_FILE), true).await?;
        set_status(&status, "正在加载城市纹理 (3/4)...");
        let mid =
            create_png_texture(&device, &queue, "level_1", &city_png(LEVEL_1_FILE), true).await?;
        set_status(&status, "正在加载城市纹理 (4/4)...");
        let near =
            create_png_texture(&device, &queue, "level_0", &city_png(LEVEL_0_FILE), true).await?;

        set_status(&status, "正在生成玻璃材质纹理...");
        let (dw, dh, dirt_data) = generate_dirt(DIRT_TEXTURE_SIZE.0, DIRT_TEXTURE_SIZE.1);
        let dirt = create_texture(&device, &queue, "glass_dirt", dw, dh, &dirt_data, false);
        let (fw, fh, fog_data) = generate_fog(FOG_TEXTURE_SIZE.0, FOG_TEXTURE_SIZE.1);
        let fog = create_texture(
            &device,
            &queue,
            "condensation_fog",
            fw,
            fh,
            &fog_data,
            false,
        );
        let (iw, ih, interior_data) =
            generate_interior(INTERIOR_TEXTURE_SIZE.0, INTERIOR_TEXTURE_SIZE.1);
        let interior = create_texture(
            &device,
            &queue,
            "interior_reflection",
            iw,
            ih,
            &interior_data,
            false,
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

        let uniforms = Uniforms::new(INITIAL_TIME_SECONDS, INITIAL_STYLE_ID);
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let glass_params = GlassParams::DEFAULT;
        let glass_params_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("glass-params"),
            contents: bytemuck::bytes_of(&glass_params),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        // 默认材质纹理存成数组:既从中建出绑定组要用的视图,也留在 App 里 --
        // 前端上传替换掉某一层后,"恢复默认"要能原样换回来(见 App::reset_layer_texture),
        // 所以原图必须一直活着.顺序 = 材质槽位 0..6(bg/far/mid/near/dirt/fog/interior),
        // 也是 app_params::UPLOADABLE_LAYERS 里槽位号的来源:前四项正好是城市四层.
        let default_material_textures: [wgpu::Texture; TEXTURE_LAYER_COUNT as usize] =
            [bg, far, mid, near, dirt, fog, interior];
        // 视图从上面那份纹理派生:上传替换只改这个数组,不动默认纹理.
        let material_views: [wgpu::TextureView; TEXTURE_LAYER_COUNT as usize] =
            std::array::from_fn(|i| default_material_textures[i].create_view(&Default::default()));

        let pipelines = create_metro_pipelines(
            &device,
            format,
            &uniform_buffer,
            &glass_params_buffer,
            MetroTextures {
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
            render_bind_group: pipelines.render_bind_group,
            render_bgl: pipelines.render_bgl,
            material_views,
            default_material_textures,
            sampler,
            vertex_buffer,
            index_buffer,
            uniform_buffer,
            glass_params_buffer,
            glass_params,
            time: 0.0,
            last: performance_now(),
            frame_accumulator: 0.0,
            running: true,
            style: 0,
        })
    }

    /// 画布后备缓冲尺寸变化.
    ///
    /// 站点按视口算好 16:9 的"覆盖"尺寸,先改 `<canvas>` 的 `width`/`height` 属性,
    /// 再调这里.与尺寸挂钩的只有 surface 配置一样东西:
    /// 材质纹理与绑定组都与画布尺寸无关,管线更是与尺寸无关.
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
    }

    /// 只重建渲染绑定组(前端上传替换材质贴图时用).
    ///
    /// 管线与着色器一行不动,所以换图不会重新编译着色器(不会有拖动窗口时那种卡顿);
    /// 被换下来的旧纹理随旧视图一起释放.
    fn rebuild_render_bind_group(&mut self) {
        let bind_group = create_render_bind_group(
            &self.device,
            &self.uniform_buffer,
            &self.glass_params_buffer,
            MetroTextures {
                sampler: &self.sampler,
                texture_views: std::array::from_fn(|i| &self.material_views[i]),
            },
            &self.render_bgl,
        );
        self.render_bind_group = bind_group;
    }

    /// 用前端上传的 RGBA8 像素替换某个材质槽位的贴图.
    ///
    /// 槽位与像素的校验全在 `app_params::upload_target` 里(白名单 / 尺寸 /
    /// 字节数);这里只负责建纹理,换掉对应的视图,重建渲染绑定组.
    ///
    /// 上传的图**按城市层的规格**建:预乘 alpha(layer 0 除外).
    /// 少了预乘,带透明通道的层在建筑轮廓外会渗出黑边(见 textures.rs 的
    /// premultiply_alpha).
    pub(crate) fn set_layer_texture(
        &mut self,
        layer: u32,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> Result<(), String> {
        let index = upload_target(layer, width, height, rgba.len())?;
        // 槽位 0 是背景层 level_3(实测 alpha 恒为 255,不预乘);1..=3 是带 alpha 的远景层.
        let premultiply: bool = index != 0;
        let texture = create_texture(
            &self.device,
            &self.queue,
            "uploaded-layer",
            width,
            height,
            rgba,
            premultiply,
        );
        // write_texture 在这行返回前就已经把像素拷进暂存区,所以调用方的
        // Uint8Array 之后随便被回收,不会影响已经排队的上传.
        self.material_views[index] = texture.create_view(&Default::default());
        self.rebuild_render_bind_group();
        Ok(())
    }

    /// 把某个材质槽位恢复成站点自带的默认贴图.
    ///
    /// 不重新 fetch:默认纹理一直留在 [`App::default_material_textures`] 里,
    /// 这里只是重新建一个视图换回去(线上断网也能用).
    pub(crate) fn reset_layer_texture(&mut self, layer: u32) -> Result<(), String> {
        let (index, _) = upload_slot(layer)?;
        self.material_views[index] =
            self.default_material_textures[index].create_view(&Default::default());
        self.rebuild_render_bind_group();
        Ok(())
    }

    /// 重置:动画时钟归零(前端"重置"按钮).
    pub(crate) fn reset(&mut self) {
        self.time = 0.0;
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

        let uniforms: Uniforms = Uniforms::new(self.time, self.style);
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
        self.queue.write_buffer(
            &self.glass_params_buffer,
            0,
            bytemuck::bytes_of(&self.glass_params),
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
