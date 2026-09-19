/*
mip 链生成
- create_mip_pipeline:建"逐级缩小"的 blit 管线(着色器见 src/mip.wgsl)
- generate_mipmaps:对一张纹理从 level 1 起逐级生成

为什么需要它:背景的"景深模糊"是让片段着色器用 textureSampleLevel 取更高的 mip 级
(见 shaders.wgsl 的 focus).WebGPU 没有"自动生成 mip"的开关 -- 创建纹理时只声明
`mip_level_count`,各级内容必须自己写.标准写法就是逐级 blit:每个目标级开一个
render pass,全屏三角形采样上一级,双线性过滤恰好构成 2x2 的盒式平均,
逐级叠加近似高斯.

代价:城市四层各 11 级,一次性(纹理加载时)生成,约 40 个小 pass;
运行期每帧**零**额外开销 -- 这正是"用 mip 做景深"相对"逐像素多抽几个点做模糊"
的最大优势(后者每帧每像素要多 8~16 次采样,还要乘上背景层数).

注意:只有内容**静态**的纹理才适合在加载时生成 mip.城市四层的滚动只是改变采样
坐标,纹理本身不动,所以是一次性的;若将来自动生成的内容要模糊,得每帧重新生成.
*/
use crate::render_params::{
    BINDING_MIP_SAMPLER, BINDING_MIP_SOURCE, MIP_FRAGMENT_ENTRY_POINT, MIP_VERTEX_ENTRY_POINT,
    RENDER_TARGET_FORMAT,
};

/// mip blit 管线与它的绑定组布局.
///
/// 布局留着是因为每级都要现建一个绑定组(源视图 + 采样器),
/// 而建绑定组必须用与管线**同一份**布局(见 pipelines.rs 里同样的理由).
pub struct MipPipeline {
    pub pipeline: wgpu::RenderPipeline,
    pub bind_group_layout: wgpu::BindGroupLayout,
}

pub fn create_mip_pipeline(device: &wgpu::Device) -> MipPipeline {
    let shader: wgpu::ShaderModule = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("metro-mip-shader"),
        source: wgpu::ShaderSource::Wgsl(crate::pipelines::mip_shader_source().into()),
    });
    let bind_group_layout: wgpu::BindGroupLayout =
        device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("metro-mip-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: BINDING_MIP_SOURCE,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: BINDING_MIP_SAMPLER,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
    let layout: wgpu::PipelineLayout =
        device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("metro-mip-layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });
    let pipeline: wgpu::RenderPipeline =
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("metro-mip-pipeline"),
            layout: Some(&layout),
            // 顶点着色器不用顶点缓冲:三个顶点由 vertex_index 现算(见 mip.wgsl).
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some(MIP_VERTEX_ENTRY_POINT),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some(MIP_FRAGMENT_ENTRY_POINT),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    // 城市层纹理固定是 RENDER_TARGET_FORMAT(Rgba8Unorm),
                    // 与 surface 的格式无关,所以这里不传 surface format.
                    format: RENDER_TARGET_FORMAT,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview: None,
            cache: None,
        });
    MipPipeline {
        pipeline,
        bind_group_layout,
    }
}

/// 逐级生成 `texture` 的 mip 链(level 1..mip_level_count).
///
/// `sampler` 必须是过滤式采样器(mipmap_filter 也要是线性的),否则 blit 就不是
/// 盒式平均而是最近邻抽样,缩小后会出现闪烁的锯齿.
/// 只有一级时是空操作:逐级 blit 一条都不用发.
pub fn generate_mipmaps(
    device: &wgpu::Device,
    encoder: &mut wgpu::CommandEncoder,
    mip: &MipPipeline,
    sampler: &wgpu::Sampler,
    texture: &wgpu::Texture,
    mip_level_count: u32,
) {
    for level in 1..mip_level_count {
        // 源视图:只看上一级(单级视图,这样采样器的 LOD 没有别的级可选).
        let source_view: wgpu::TextureView = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("mip-source"),
            base_mip_level: level - 1,
            mip_level_count: Some(1),
            ..Default::default()
        });
        // 目标视图:只看这一级(它就是这次 render pass 的颜色附件).
        let target_view: wgpu::TextureView = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("mip-target"),
            base_mip_level: level,
            mip_level_count: Some(1),
            ..Default::default()
        });
        let bind_group: wgpu::BindGroup = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("mip-bind-group"),
            layout: &mip.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: BINDING_MIP_SOURCE,
                    resource: wgpu::BindingResource::TextureView(&source_view),
                },
                wgpu::BindGroupEntry {
                    binding: BINDING_MIP_SAMPLER,
                    resource: wgpu::BindingResource::Sampler(sampler),
                },
            ],
        });
        let mut pass: wgpu::RenderPass<'_> =
            encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("mip-blit"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target_view,
                    resolve_target: None,
                    // 每个 texel 都会被这次的三角形覆盖,不需要保留上一帧内容;
                    // 用 Clear 而不是 Load,让驱动知道这一级不必先读回显存.
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
        pass.set_pipeline(&mip.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        // 一个三角形(3 个顶点)盖住整级.
        pass.draw(0..3, 0..1);
    }
}
