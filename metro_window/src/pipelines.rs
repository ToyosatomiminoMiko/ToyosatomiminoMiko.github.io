/*
创建 WebGPU 管线与绑定组
- 计算管线:水滴物理(cs_main)/斯涅尔折射偏移(cs_refraction)
- 渲染管线:全屏四边形绘制地铁车窗玻璃效果
- 绑定组布局必须与 src/shaders.wgsl 中的声明保持一致
- struct DropletParams 由 Rust 侧生成并注入,保证 WGSL 与 Rust 字段完全同步
*/
use crate::droplet_params::DropletParams;

pub struct MetroPipelines {
    pub render_pipeline: wgpu::RenderPipeline,
    pub physics_pipeline: wgpu::ComputePipeline,
    pub refraction_pipeline: wgpu::ComputePipeline,
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
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba16Float,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
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

    let mut render_entries: Vec<wgpu::BindGroupLayoutEntry> = Vec::with_capacity(12);
    render_entries.push(wgpu::BindGroupLayoutEntry {
        binding: 0,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    });
    render_entries.push(wgpu::BindGroupLayoutEntry {
        binding: 3,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    });
    render_entries.push(wgpu::BindGroupLayoutEntry {
        binding: 10,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
        count: None,
    });
    for i in 0..7 {
        render_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 11 + i as u32,
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
        binding: 18,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    });
    render_entries.push(wgpu::BindGroupLayoutEntry {
        binding: 19,
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

    let compute_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("metro-compute-bg"),
        layout: &compute_bgl,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: droplet_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::TextureView(refraction_view),
            },
            wgpu::BindGroupEntry {
                binding: 3,
                resource: droplet_params_buffer.as_entire_binding(),
            },
        ],
    });

    let mut render_bind_entries: Vec<wgpu::BindGroupEntry<'_>> = Vec::with_capacity(12);
    render_bind_entries.push(wgpu::BindGroupEntry {
        binding: 0,
        resource: uniform_buffer.as_entire_binding(),
    });
    render_bind_entries.push(wgpu::BindGroupEntry {
        binding: 3,
        resource: droplet_params_buffer.as_entire_binding(),
    });
    render_bind_entries.push(wgpu::BindGroupEntry {
        binding: 10,
        resource: wgpu::BindingResource::Sampler(sampler),
    });
    for (i, view) in texture_views.iter().enumerate() {
        render_bind_entries.push(wgpu::BindGroupEntry {
            binding: 11 + i as u32,
            resource: wgpu::BindingResource::TextureView(view),
        });
    }
    render_bind_entries.push(wgpu::BindGroupEntry {
        binding: 18,
        resource: wgpu::BindingResource::TextureView(refraction_view),
    });
    render_bind_entries.push(wgpu::BindGroupEntry {
        binding: 19,
        resource: wgpu::BindingResource::Sampler(refraction_sampler),
    });
    let render_bind_group: wgpu::BindGroup = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("metro-render-bg"),
        layout: &render_bgl,
        entries: &render_bind_entries,
    });

    let render_pipeline: wgpu::RenderPipeline =
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("metro-render-pipeline"),
            layout: Some(&render_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: 16,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: 0,
                            shader_location: 0,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: 8,
                            shader_location: 1,
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
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
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
            entry_point: Some("cs_main"),
            compilation_options: Default::default(),
            cache: None,
        });
    let refraction_pipeline: wgpu::ComputePipeline =
        device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("metro-refraction-pipeline"),
            layout: Some(&compute_layout),
            module: &shader,
            entry_point: Some("cs_refraction"),
            compilation_options: Default::default(),
            cache: None,
        });

    MetroPipelines {
        render_pipeline,
        physics_pipeline,
        refraction_pipeline,
        render_bind_group,
        compute_bind_group,
    }
}
