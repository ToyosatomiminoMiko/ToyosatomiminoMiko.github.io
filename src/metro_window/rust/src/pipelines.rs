/*
创建 WebGPU 管线与绑定组
- 计算管线:水滴物理(cs_main)/斯涅尔折射偏移(cs_refraction)
- 渲染管线:全屏四边形绘制地铁车窗玻璃效果
- 绑定组布局必须与 src/shaders.wgsl 中的声明保持一致
- struct DropletParams 由 Rust 侧生成并注入,保证 WGSL 与 Rust 字段完全同步
*/
use crate::droplet_params::DropletParams;
use crate::render_params::{
    BINDING_DROPLETS, BINDING_DROPLET_PARAMS, BINDING_REFRACTION_IMAGE, BINDING_REFRACTION_SAMPLER,
    BINDING_REFRACTION_VIEW, BINDING_SAMPLER, BINDING_TEXTURE_BASE, BINDING_UNIFORMS,
    BIND_ENTRY_CAPACITY, FRAGMENT_ENTRY_POINT, OUTPUT_BLEND_STATE, OUTPUT_WRITE_MASK,
    PHYSICS_ENTRY_POINT, REFRACTION_ENTRY_POINT, REFRACTION_TEXTURE_FORMAT, TEXTURE_LAYER_COUNT,
    VERTEX_ENTRY_POINT, VERTEX_POSITION_LOCATION, VERTEX_POSITION_OFFSET, VERTEX_STRIDE_BYTES,
    VERTEX_UV_LOCATION, VERTEX_UV_OFFSET,
};

pub struct MetroPipelines {
    pub render_pipeline: wgpu::RenderPipeline,
    pub physics_pipeline: wgpu::ComputePipeline,
    pub refraction_pipeline: wgpu::ComputePipeline,
    pub render_bind_group: wgpu::BindGroup,
    pub compute_bind_group: wgpu::BindGroup,
    /// 两个绑定组布局.留着是为了**画布尺寸变化时只重建绑定组**:
    /// 管线与尺寸无关,重建管线会连带重新编译着色器(几十毫秒的卡顿),
    /// 而绑定组持有折射偏移图(按画布尺寸建)的视图,尺寸一变就必须换一份.
    /// 见 `create_bind_groups` 与 `app.rs` 的 `resize`.
    pub compute_bgl: wgpu::BindGroupLayout,
    pub render_bgl: wgpu::BindGroupLayout,
}

/// 只由绑定组持有的那部分资源(尺寸变化时重建的就是它).
pub struct MetroBindGroups {
    pub render_bind_group: wgpu::BindGroup,
    pub compute_bind_group: wgpu::BindGroup,
}

/// 完整 WGSL 源码:Rust 生成的 struct DropletParams 声明 + 手写着色器.
/// 管线编译与校验都使用这份源码,避免两边声明各自维护而漂移.
pub fn shader_source() -> String {
    format!(
        "// struct DropletParams 由 src/droplet_params.rs 自动生成,请勿手改.\n{}\n{}",
        DropletParams::WGSL_DECL,
        include_str!("shaders.wgsl")
    )
}

/// 渲染管线用到的纹理资源.
/// 参数偏多,打包成结构体:调用处一眼看清"传了哪些纹理",
/// 也避免 create_metro_pipelines 参数列表过长.
pub struct MetroTextures<'a> {
    /// 折射偏移图(计算管线输出,渲染管线采样)
    pub refraction_view: &'a wgpu::TextureView,
    /// 折射偏移图采样器(线性过滤,避免低分辨率折射图出现色块)
    pub refraction_sampler: &'a wgpu::Sampler,
    /// 背景/材质纹理采样器
    pub sampler: &'a wgpu::Sampler,
    /// Layer 0..N 的背景纹理视图(bg/far/mid/near/dirt/fog/interior)
    pub texture_views: [&'a wgpu::TextureView; 7],
}

pub fn create_metro_pipelines(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
    uniform_buffer: &wgpu::Buffer,
    droplet_params_buffer: &wgpu::Buffer,
    droplet_buffer: &wgpu::Buffer,
    textures: MetroTextures<'_>,
) -> MetroPipelines {
    let MetroTextures {
        refraction_view,
        refraction_sampler,
        sampler,
        texture_views,
    } = textures;
    let shader: wgpu::ShaderModule = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("metro-shader"),
        source: wgpu::ShaderSource::Wgsl(shader_source().into()),
    });

    let compute_bgl: wgpu::BindGroupLayout =
        device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("metro-compute-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: BINDING_UNIFORMS,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: BINDING_DROPLETS,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: BINDING_REFRACTION_IMAGE,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: REFRACTION_TEXTURE_FORMAT,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: BINDING_DROPLET_PARAMS,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

    let mut render_entries: Vec<wgpu::BindGroupLayoutEntry> =
        Vec::with_capacity(BIND_ENTRY_CAPACITY);
    render_entries.push(wgpu::BindGroupLayoutEntry {
        binding: BINDING_UNIFORMS,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    });
    render_entries.push(wgpu::BindGroupLayoutEntry {
        binding: BINDING_DROPLET_PARAMS,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    });
    render_entries.push(wgpu::BindGroupLayoutEntry {
        binding: BINDING_SAMPLER,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
        count: None,
    });
    for i in 0..TEXTURE_LAYER_COUNT {
        render_entries.push(wgpu::BindGroupLayoutEntry {
            binding: BINDING_TEXTURE_BASE + i,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
    }
    render_entries.push(wgpu::BindGroupLayoutEntry {
        binding: BINDING_REFRACTION_VIEW,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    });
    render_entries.push(wgpu::BindGroupLayoutEntry {
        binding: BINDING_REFRACTION_SAMPLER,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
        count: None,
    });
    let render_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("metro-render-bgl"),
        entries: &render_entries,
    });

    let compute_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("metro-compute-layout"),
        bind_group_layouts: &[&compute_bgl],
        push_constant_ranges: &[],
    });
    let render_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("metro-render-layout"),
        bind_group_layouts: &[&render_bgl],
        push_constant_ranges: &[],
    });

    let MetroBindGroups {
        render_bind_group,
        compute_bind_group,
    } = create_bind_groups(
        device,
        uniform_buffer,
        droplet_params_buffer,
        droplet_buffer,
        MetroTextures {
            refraction_view,
            refraction_sampler,
            sampler,
            texture_views,
        },
        &compute_bgl,
        &render_bgl,
    );
    let render_pipeline: wgpu::RenderPipeline =
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("metro-render-pipeline"),
            layout: Some(&render_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some(VERTEX_ENTRY_POINT),
                compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: VERTEX_STRIDE_BYTES,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: VERTEX_POSITION_OFFSET,
                            shader_location: VERTEX_POSITION_LOCATION,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: VERTEX_UV_OFFSET,
                            shader_location: VERTEX_UV_LOCATION,
                        },
                    ],
                }],
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some(FRAGMENT_ENTRY_POINT),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(OUTPUT_BLEND_STATE),
                    write_mask: OUTPUT_WRITE_MASK,
                })],
            }),
            multiview: None,
            cache: None,
        });

    let physics_pipeline: wgpu::ComputePipeline =
        device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("metro-physics-pipeline"),
            layout: Some(&compute_layout),
            module: &shader,
            entry_point: Some(PHYSICS_ENTRY_POINT),
            compilation_options: Default::default(),
            cache: None,
        });
    let refraction_pipeline: wgpu::ComputePipeline =
        device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("metro-refraction-pipeline"),
            layout: Some(&compute_layout),
            module: &shader,
            entry_point: Some(REFRACTION_ENTRY_POINT),
            compilation_options: Default::default(),
            cache: None,
        });

    MetroPipelines {
        render_pipeline,
        physics_pipeline,
        refraction_pipeline,
        render_bind_group,
        compute_bind_group,
        compute_bgl,
        render_bgl,
    }
}

/// 只建两个绑定组(管线和着色器都不动).
///
/// 为什么单独拆出来:画布尺寸一变,按尺寸建的**折射偏移图**就必须换,
/// 而两个绑定组都持有它的视图,于是绑定组也得跟着重建.管线与尺寸无关,
/// 走 `create_metro_pipelines` 会把着色器再编译一遍,拖动窗口时会一顿一顿的.
///
/// 布局由调用方传进来(而不是在这里现建):绑定组布局必须与管线的布局
/// 是**同一份**(wgpu 校验的是布局的等价性,但复用同一份更省,也更不容易写歪).
pub fn create_bind_groups(
    device: &wgpu::Device,
    uniform_buffer: &wgpu::Buffer,
    droplet_params_buffer: &wgpu::Buffer,
    droplet_buffer: &wgpu::Buffer,
    textures: MetroTextures<'_>,
    compute_bgl: &wgpu::BindGroupLayout,
    render_bgl: &wgpu::BindGroupLayout,
) -> MetroBindGroups {
    // 按值解构:字段全是对纹理/采样器的引用(本身就是 Copy),拿走一份不影响调用方.
    let MetroTextures {
        refraction_view,
        refraction_sampler,
        sampler,
        texture_views,
    } = textures;

    let compute_bind_group: wgpu::BindGroup =
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("metro-compute-bg"),
            layout: compute_bgl,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: BINDING_UNIFORMS,
                    resource: uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: BINDING_DROPLETS,
                    resource: droplet_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: BINDING_REFRACTION_IMAGE,
                    resource: wgpu::BindingResource::TextureView(refraction_view),
                },
                wgpu::BindGroupEntry {
                    binding: BINDING_DROPLET_PARAMS,
                    resource: droplet_params_buffer.as_entire_binding(),
                },
            ],
        });

    let mut render_bind_entries: Vec<wgpu::BindGroupEntry<'_>> =
        Vec::with_capacity(BIND_ENTRY_CAPACITY);
    render_bind_entries.push(wgpu::BindGroupEntry {
        binding: BINDING_UNIFORMS,
        resource: uniform_buffer.as_entire_binding(),
    });
    render_bind_entries.push(wgpu::BindGroupEntry {
        binding: BINDING_DROPLET_PARAMS,
        resource: droplet_params_buffer.as_entire_binding(),
    });
    render_bind_entries.push(wgpu::BindGroupEntry {
        binding: BINDING_SAMPLER,
        resource: wgpu::BindingResource::Sampler(sampler),
    });
    for (i, view) in texture_views.iter().enumerate() {
        render_bind_entries.push(wgpu::BindGroupEntry {
            binding: BINDING_TEXTURE_BASE + i as u32,
            resource: wgpu::BindingResource::TextureView(view),
        });
    }
    render_bind_entries.push(wgpu::BindGroupEntry {
        binding: BINDING_REFRACTION_VIEW,
        resource: wgpu::BindingResource::TextureView(refraction_view),
    });
    render_bind_entries.push(wgpu::BindGroupEntry {
        binding: BINDING_REFRACTION_SAMPLER,
        resource: wgpu::BindingResource::Sampler(refraction_sampler),
    });
    let render_bind_group: wgpu::BindGroup = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("metro-render-bg"),
        layout: render_bgl,
        entries: &render_bind_entries,
    });

    MetroBindGroups {
        render_bind_group,
        compute_bind_group,
    }
}
