/*
车窗玻璃参数模块
- 车速 / 背景层距离 / 污渍 / 雾气 / 车厢灯光 这些"车窗本身"的可调参数集中于此.
  (水珠那套参数已经整体拆到仓库根目录的 water_droplet_demo/,这里不再有它们.)
- Rust 结构体与 WGSL 的 struct GlassParams 由同一份字段清单生成:
  `GlassParams::WGSL_DECL` 会在管线编译时注入 src/shaders.wgsl,
  因此两边不会出现各自手写,逐步漂移的问题.
- 所有字段均为 f32,结构体大小保持 16 字节倍数以满足 WGSL uniform 布局要求
  (由单元测试约束;末尾的 `_padding` 就是为对齐留下的).
*/

macro_rules! define_glass_params {
    ($($field:ident = $value:expr;)*) => {
        #[repr(C)]
        #[derive(Clone, Copy, Debug, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
        pub struct GlassParams {
            $(pub $field: f32,)*
        }

        impl GlassParams {
            /// 默认参数,也是 WGSL 与 Rust 共用的唯一取值来源.
            pub const DEFAULT: Self = Self {
                $($field: $value,)*
            };

            /// 全部字段名(顺序与结构体一致).
            ///
            /// 用途:单测据此检查"每个字段都有对应的 setParam 分发" -- 加了字段却
            /// 忘了 `app_params::param_field` 的 match 时立刻失败.以 `_` 开头的
            /// 字段是内部字段(如对齐填充),不参与前端分发.
            pub const FIELD_NAMES: &'static [&'static str] = &[$(stringify!($field)),*];

            /// WGSL 端声明,由 Rust 字段清单生成,保证两边字段名与顺序完全一致.
            pub const WGSL_DECL: &'static str = concat!(
                "struct GlassParams {\n",
                $("    ", stringify!($field), ": f32,\n",)*
                "};\n",
            );
        }

        impl Default for GlassParams {
            fn default() -> Self {
                Self::DEFAULT
            }
        }
    };
}

define_glass_params! {
    // ===== 车速 / 背景层距离(实时滑块) =====
    // vehicle_speed:车速倍率,驱动城市四层的视差滚动;
    // far_distance / mid_distance / near_distance:三层背景的"距离"系数,
    //   距离越大滚动越慢(视差速度 = 基础速度 / 距离).
    vehicle_speed = 1.0;
    far_distance = 1.0;
    mid_distance = 1.0;
    near_distance = 1.0;

    // ===== 玻璃材质浓度(实时滑块) =====
    // dirt_opacity / fog_opacity / interior_opacity:
    // 污渍,雾气,车厢灯光反射的混合强度.
    dirt_opacity = 0.55;
    fog_opacity = 0.30;
    interior_opacity = 0.55;

    // ===== 对齐填充 =====
    // WGSL uniform 结构体大小必须是 16 字节的倍数:上面 7 个 f32 = 28 字节,
    // 补一个标量到 32(2 × 16).留着名字是为了让"为什么多一个字段"一眼可见,
    // 不要在着色器里读它.
    _padding = 0.0;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniform_layout_is_16_byte_aligned() {
        // WGSL uniform 要求结构体大小为 16 字节倍数.
        assert_eq!(std::mem::size_of::<GlassParams>() % 16, 0);
        assert!(std::mem::size_of::<GlassParams>() >= 16);
    }

    #[test]
    fn wgsl_decl_is_injected_once() {
        let source = crate::pipelines::shader_source();
        // 注入后的完整着色器源码里,struct GlassParams 的声明只能出现一次.
        assert_eq!(source.matches("struct GlassParams {").count(), 1);
        // 全部字段都进入了注入的 WGSL 声明.
        for field in [
            "vehicle_speed",
            "far_distance",
            "mid_distance",
            "near_distance",
            "dirt_opacity",
            "fog_opacity",
            "interior_opacity",
        ] {
            assert!(source.contains(field), "注入的 WGSL 声明缺少字段: {field}");
        }
    }
}
