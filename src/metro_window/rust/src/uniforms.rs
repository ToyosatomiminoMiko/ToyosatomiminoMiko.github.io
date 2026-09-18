/*
统一缓冲区(Uniform Buffer)
- 每帧向 GPU 传递 时间 / 帧间隔 / 风格 / 分辨率 与模型矩阵
- 内存布局必须与 src/shaders.wgsl 的 struct Uniforms 完全一致
*/
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Uniforms {
    model_matrix: [f32; 16],
    time: f32,
    delta_time: f32,
    style_id: u32,
    pad: u32,
    resolution: [f32; 2],
    pad2: [f32; 2],
}

impl Uniforms {
    pub fn new(time: f32, delta_time: f32, style_id: u32, width: u32, height: u32) -> Self {
        Self {
            model_matrix: [
                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
            time,
            delta_time,
            style_id,
            pad: 0,
            resolution: [width as f32, height as f32],
            pad2: [0.0, 0.0],
        }
    }
}
