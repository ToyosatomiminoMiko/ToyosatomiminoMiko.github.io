/*
统一缓冲区(Uniform Buffer)
- 每帧向 GPU 传递 时间 / 帧间隔 / 风格编号 / 画布宽高比
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
    /// 画布宽高比 `aspect = 画布宽 / 画布高`(1344×756 运行时画布 => 1.7778).
    ///
    /// 作用:uv 是 [0,1]² 的归一化坐标,x 方向 1 个单位跨画布宽 W 像素,
    /// y 方向 1 个单位跨画布高 H 像素,两根轴的"单位长度"并不相等.若直接拿
    /// `length(Δuv) < r` 判定水滴范围,它等价于屏幕上的椭圆方程
    /// `(ΔX / (r·W))² + (ΔY / (r·H))² = 1`,圆形水珠会被沿长边拉成 W/H 倍的
    /// 椭圆(16:9 画布上就是 1.78:1 的扁椭圆).着色器把 uv.x 乘上本值换到
    /// 各向同性空间后再算距离,水珠才会是正圆(见 shaders.wgsl 的
    /// `toIsotropic` / `toUvOffset`).
    ///
    /// 取值来源:`App::aspect()` 由 surface_config 的宽高现算,每帧写 uniform 时
    /// 都取一次,所以 resize 之后不需要单独同步这个字段--尺寸与 aspect 永远同源,
    /// 不存在"改了尺寸忘了改 aspect"的漂移.
    /// 这个字段同时把结构体填满 16 字节(uniform 结构按 16 字节对齐),
    /// 因此不再需要单独的 `_padding`.
    aspect: f32,
}

impl Uniforms {
    pub fn new(time: f32, delta_time: f32, style_id: u32, aspect: f32) -> Self {
        Self {
            time,
            delta_time,
            style_id,
            aspect,
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
        for field in ["time: f32", "deltaTime: f32", "styleId: u32", "aspect: f32"] {
            assert!(
                decl.contains(field),
                "shaders.wgsl 的 struct Uniforms 缺少字段: {field}"
            );
        }
    }
}
