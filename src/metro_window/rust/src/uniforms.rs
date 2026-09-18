/*
统一缓冲区(Uniform Buffer)
- 每帧向 GPU 传递 时间 / 帧间隔 / 风格编号
- 内存布局必须与 src/shaders.wgsl 的 struct Uniforms 完全一致
- 曾经还带着 modelMatrix(单位阵)与 resolution,但着色器从头到尾都没读过它们,
  属于独立项目时期的模板残留,已删除;uniform 结构只保留真正参与计算的字段.
*/
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Uniforms {
    time: f32,
    delta_time: f32,
    style_id: u32,
    /// 补齐到 16 字节:uniform 结构按 16 字节对齐,显式写出与 WGSL 的 `_padding`
    /// 一一对应,避免两边各自隐式补齐而悄悄错位.
    _padding: u32,
}

impl Uniforms {
    pub fn new(time: f32, delta_time: f32, style_id: u32) -> Self {
        Self {
            time,
            delta_time,
            style_id,
            _padding: 0,
        }
    }
}
