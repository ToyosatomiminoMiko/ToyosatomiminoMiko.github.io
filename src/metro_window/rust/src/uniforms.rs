/*
统一缓冲区(Uniform Buffer)
- 每帧向 GPU 传递 时间 / 风格编号
- 内存布局必须与 src/shaders.wgsl 的 struct Uniforms 完全一致
- 曾经还带着 modelMatrix(单位阵)与 resolution,以及给水珠用的 deltaTime / aspect,
  但它们都已经没有消费者(前两个是独立项目时期的模板残留,后两个随水珠一起拆到了
  water_droplet_demo/),所以这里只保留真正参与计算的字段.
*/
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Uniforms {
    time: f32,
    style_id: u32,
    /// 对齐填充:uniform 结构体必须 16 字节对齐,前两个标量只有 8 字节.
    _padding0: f32,
    _padding1: f32,
}

impl Uniforms {
    pub fn new(time: f32, style_id: u32) -> Self {
        Self {
            time,
            style_id,
            _padding0: 0.0,
            _padding1: 0.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniform_layout_is_16_byte_aligned() {
        // uniform 结构体大小必须是 16 字节的倍数,这里恰好由 4 个标量填满:
        // 再加字段就会破坏对齐(需要显式补齐),所以把大小钉死在单测里.
        assert_eq!(std::mem::size_of::<Uniforms>(), 16);
    }

    #[test]
    fn uniform_fields_match_wgsl_decl() {
        let source = crate::pipelines::shader_source();
        let start = source
            .find("struct Uniforms {")
            .expect("shaders.wgsl 缺少 struct Uniforms");
        let end = start + source[start..].find('}').expect("struct Uniforms 没有闭合");
        let decl = &source[start..end];
        // 两边字段一一对应:字段名写错不会报错,只会静默读到 0,所以逐字校验.
        for field in ["time: f32", "styleId: u32"] {
            assert!(
                decl.contains(field),
                "shaders.wgsl 的 struct Uniforms 缺少字段: {field}"
            );
        }
    }
}
