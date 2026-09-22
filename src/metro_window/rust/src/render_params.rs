/*
渲染管线参数配置模块
- 全屏四边形几何,顶点布局,绑定槽位,纹理格式,采样器状态,清屏色,
  适配器偏好等 GPU 管线相关常量集中于此.
- 其中绑定槽位与管线入口点同时出现在 src/shaders.wgsl 中,
  统一从这里取值,并由本模块的单测校验两边文本一致,避免只改一边导致漂移.
- 数值为等价替换,不改变任何渲染结果.
*/
/// 全屏四边形的顶点数据.
///
/// 布局:每顶点 4 个 f32 = (x, y, u, v),共 4 个顶点(左下/右下/左上/右上);
/// 覆盖 NDC 的 [-1, 1] 正方形,uv 与屏幕方向一致,配合索引表画出两个三角形.
/// 顶点顺序必须与 [`FULLSCREEN_QUAD_INDICES`] 对应,随意调整会翻转/撕裂画面.
pub const FULLSCREEN_QUAD_VERTICES: [f32; 16] = [
    -1.0, -1.0, 0.0, 1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0,
];

/// 全屏四边形的索引(u16).
///
/// 两个三角形 (0,1,2) 与 (1,3,2) 共享对角线 1-3;
/// 索引指向 [`FULLSCREEN_QUAD_VERTICES`] 的顶点,值必须小于顶点数.
pub const FULLSCREEN_QUAD_INDICES: [u16; 6] = [0, 1, 2, 1, 3, 2];

/// 每个顶点的 f32 分量数:位置 xy(2) + uv(2).
pub(crate) const VERTEX_COMPONENTS: usize = 4;
/// 位置分量数(x, y).
pub(crate) const VERTEX_POSITION_COMPONENTS: usize = 2;
/// 单个 f32 占用的字节数.
pub(crate) const F32_BYTES: usize = 4;
/// 顶点缓冲步长(字节)= 每顶点 4 个 f32.
pub(crate) const VERTEX_STRIDE_BYTES: u64 = (VERTEX_COMPONENTS * F32_BYTES) as u64;
/// 顶点属性偏移(字节):位置 xy 从顶点起点 0 开始.
pub(crate) const VERTEX_POSITION_OFFSET: u64 = 0;
/// 顶点属性偏移(字节):uv 跳过位置 xy 的 2 个 f32.
pub(crate) const VERTEX_UV_OFFSET: u64 = (VERTEX_POSITION_COMPONENTS * F32_BYTES) as u64;

/// 顶点属性在着色器里的 location:位置 xy 用 0.
///
/// 必须与 src/shaders.wgsl 的 `vs_main(@location(0) ...)` 一致(由单测校验).
pub(crate) const VERTEX_POSITION_LOCATION: u32 = 0;
/// 顶点属性在着色器里的 location:uv 用 1.
pub(crate) const VERTEX_UV_LOCATION: u32 = 1;

// 编译期不变量:uv 偏移必须落在顶点步长之内,否则属性会读到下一个顶点.
const _: () = assert!(VERTEX_UV_OFFSET < VERTEX_STRIDE_BYTES);

/// 顶点/片元入口点名字,必须与 src/shaders.wgsl 的 `fn` 名一致(由单测校验).
pub(crate) const VERTEX_ENTRY_POINT: &str = "vs_main";
pub(crate) const FRAGMENT_ENTRY_POINT: &str = "fs_main";

/// 索引缓冲格式,必须与 [`FULLSCREEN_QUAD_INDICES`] 的 u16 元素类型一致.
pub const QUAD_INDEX_FORMAT: wgpu::IndexFormat = wgpu::IndexFormat::Uint16;

/// 普通贴图(城市 PNG / 程序化贴图)的纹素格式:RGBA8 无归一化.
pub const RENDER_TARGET_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// RGBA8 每像素字节数,用于 `write_texture` 的字节行距与缓冲区尺寸计算.
pub const RGBA_BYTES_PER_PIXEL: u32 = 4;

/// 纹理 / 画布的最小边长(像素).
///
/// wgpu 不允许 0 尺寸资源,所有从画布尺寸派生的纹理都用它兜底.
pub const MIN_TEXTURE_DIMENSION: u32 = 1;

/// 表面呈现模式:自动垂直同步.
///
/// 含义:跟随显示器刷新率提交帧,避免画面撕裂;配合 [`crate::app_params::FRAME_INTERVAL_MS`]
/// 的限帧使用.改成 Immediate 会解除限速但可能撕裂.
pub(crate) const SURFACE_PRESENT_MODE: wgpu::PresentMode = wgpu::PresentMode::AutoVsync;

/// 期望的最大在途帧数(帧).
///
/// 含义:值越大越不容易被 GPU 卡住,但输入延迟更高;
/// 2 是常见的"双缓冲"折中值.
pub(crate) const SURFACE_MAX_FRAME_LATENCY: u32 = 2;

/// 适配器性能偏好:优先独立显卡.
///
/// 与 app.rs 中"拒绝 CPU 软件渲染适配器"的策略配套:低功耗 / 集显在高分屏上
/// 跑不动这套多层合成.
pub(crate) const ADAPTER_POWER_PREFERENCE: wgpu::PowerPreference =
    wgpu::PowerPreference::HighPerformance;

/// 清屏色(线性 RGBA).
///
/// 含义:没有任何背景贴图覆盖时的兜底底色,深蓝黑;
/// 调大 RGB 画面会发灰,alpha 固定 1.0(不透明).
pub(crate) const CLEAR_COLOR: wgpu::Color = wgpu::Color {
    r: 0.05,
    g: 0.05,
    b: 0.08,
    a: 1.0,
};

/// 采样器地址模式:u 方向重复(城市层横向无限滚动).
pub const SAMPLER_ADDRESS_MODE_REPEAT: wgpu::AddressMode = wgpu::AddressMode::Repeat;
/// 采样器地址模式:越界时取边缘像素(程序化贴图靠着色器 fract 折回,不靠它平铺).
pub const SAMPLER_ADDRESS_MODE_CLAMP: wgpu::AddressMode = wgpu::AddressMode::ClampToEdge;
/// 采样器过滤模式:线性(放大/缩小都用线性,避免色块).
pub const SAMPLER_FILTER_MODE: wgpu::FilterMode = wgpu::FilterMode::Linear;

/// 颜色输出混合状态:直接替换.
///
/// 含义:全屏四边形只画一次,不需要与已有像素混合;改成 Alpha 混合会导致叠加变亮.
pub(crate) const OUTPUT_BLEND_STATE: wgpu::BlendState = wgpu::BlendState::REPLACE;
/// 颜色写掩码:允许写入全部 RGBA 通道.
pub(crate) const OUTPUT_WRITE_MASK: wgpu::ColorWrites = wgpu::ColorWrites::ALL;

// ===== 绑定槽位(必须与 src/shaders.wgsl 的 @binding 编号一致,由单测校验)=====
/// 渲染管线共用的 Uniforms 缓冲区.
pub(crate) const BINDING_UNIFORMS: u32 = 0;
/// 渲染管线共用的车窗玻璃参数 uniform.
pub(crate) const BINDING_GLASS_PARAMS: u32 = 3;
/// 背景 / 材质纹理采样器.
pub(crate) const BINDING_SAMPLER: u32 = 10;
/// 背景 / 材质纹理的起始槽位,第 i 层绑定在 BINDING_TEXTURE_BASE + i.
pub(crate) const BINDING_TEXTURE_BASE: u32 = 11;

/// 背景 / 材质纹理层数(bg / far / mid / near / dirt / fog / interior).
///
/// 必须与 [`crate::pipelines::MetroTextures::texture_views`] 的数组长度以及
/// 着色器里的 textureBG..textureInterior 数量一致.
pub(crate) const TEXTURE_LAYER_COUNT: u32 = 7;

/// 绑定组布局 / 绑定组条目数组的预分配容量.
///
/// 只是 `Vec::with_capacity` 的初始容量,不影响功能;条目数增长过多时重新分配.
pub(crate) const BIND_ENTRY_CAPACITY: usize = 12;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipeline_entry_points_exist_in_wgsl() {
        let source = crate::pipelines::shader_source();
        for entry in [VERTEX_ENTRY_POINT, FRAGMENT_ENTRY_POINT] {
            let decl = format!("fn {entry}(");
            assert!(source.contains(&decl), "shaders.wgsl 缺少入口点: {entry}");
        }
    }

    #[test]
    fn binding_slots_match_wgsl() {
        let source = crate::pipelines::shader_source();
        let mut slots = vec![BINDING_UNIFORMS, BINDING_GLASS_PARAMS, BINDING_SAMPLER];
        slots.extend((0..TEXTURE_LAYER_COUNT).map(|i| BINDING_TEXTURE_BASE + i));
        for slot in slots {
            let decl = format!("@binding({slot})");
            assert!(source.contains(&decl), "shaders.wgsl 缺少绑定槽位 {decl}");
        }
    }

    #[test]
    fn vertex_locations_exist_in_wgsl() {
        let source = crate::pipelines::shader_source();
        for location in [VERTEX_POSITION_LOCATION, VERTEX_UV_LOCATION] {
            let decl = format!("@location({location})");
            assert!(source.contains(&decl), "shaders.wgsl 缺少顶点属性 {decl}");
        }
    }

    #[test]
    fn quad_geometry_is_consistent() {
        // 顶点数 × 每顶点分量数 = 顶点数组长度.
        assert_eq!(
            FULLSCREEN_QUAD_VERTICES.len() % VERTEX_COMPONENTS,
            0,
            "顶点数组长度不是每顶点分量数的整数倍"
        );
        let vertex_count = FULLSCREEN_QUAD_VERTICES.len() / VERTEX_COMPONENTS;
        // 两个三角形,各 3 个索引.
        assert_eq!(FULLSCREEN_QUAD_INDICES.len(), 6);
        for &index in &FULLSCREEN_QUAD_INDICES {
            assert!(
                (index as usize) < vertex_count,
                "索引越界: {index} >= {vertex_count}"
            );
        }
    }
}
