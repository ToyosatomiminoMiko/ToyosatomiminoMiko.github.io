/*
水滴参数模块
- 水滴 生成 / 出界重置 / 物理模拟 / 折射渲染 的全部可调参数集中于此
- Rust 结构体与 WGSL 的 struct DropletParams 由同一份字段清单生成:
  `DropletParams::WGSL_DECL` 会在管线编译时注入 src/shaders.wgsl,
  因此两边不会出现各自手写,逐步漂移的问题.
- 所有字段均为 f32,结构体大小保持 16 字节倍数以满足 WGSL uniform 布局要求
  (由单元测试约束).
*/

macro_rules! define_droplet_params {
    ($($field:ident = $value:expr;)*) => {
        #[repr(C)]
        #[derive(Clone, Copy, Debug, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
        pub struct DropletParams {
            $(pub $field: f32,)*
        }

        impl DropletParams {
            /// 默认参数,也是 Rust 生成水滴与 WGSL 出界重置共同使用的唯一取值来源.
            pub const DEFAULT: Self = Self {
                $($field: $value,)*
            };

            /// WGSL 端声明,由 Rust 字段清单生成,保证两边字段名与顺序完全一致.
            pub const WGSL_DECL: &'static str = concat!(
                "struct DropletParams {\n",
                $("    ", stringify!($field), ": f32,\n",)*
                "};\n",
            );
        }

        impl Default for DropletParams {
            fn default() -> Self {
                Self::DEFAULT
            }
        }
    };
}

define_droplet_params! {
    // ===== 生成:初始随机位置 / 速度 / 半径 / 强度 =====
    // 生成公式:x = x_min + r1 * x_span,其余同理.
    spawn_x_min = 0.03;
    spawn_x_span = 0.94;
    spawn_y_min = -0.05;
    spawn_y_span = 1.05;
    velocity_x_span = 0.08;
    velocity_y_min = 0.01;
    velocity_y_span = 0.05;
    // radius_min / radius_span:水珠半径,单位是"画布高度"的比例(0.006 = 画面
    // 高度的 0.6%),即直径像素 = 2 × 半径 × 画布高;横竖同一尺度,所以半径决定
    // 的边界在屏幕上是正圆(换算见 shaders.wgsl 的 toIsotropic).
    radius_min = 0.006;
    radius_span = 0.018;
    strength_min = 0.020;
    strength_span = 0.030;

    // ===== 出界重置 =====
    // reset_y_min / reset_y_span 控制重新进入画面的上方区域;
    // reset_margin 是四边各留的屏宽余量,让水滴完全离开画面后再重置.
    reset_y_min = -0.15;
    reset_y_span = 0.45;
    reset_margin = 0.08;
    random_time_scale = 60.0;

    // ===== 物理模拟 =====
    // dt_max:单步最大时间,防止掉帧后 Euler 积分爆炸;
    // gravity_y:y 向下为正的重力加速度;
    // wind_*:横向正弦风的频率 / 相位 / 摆幅及其随强度 per 的增益;
    // drag_*:线性空气阻力,大水滴阻力小落得快.
    dt_max = 0.05;
    gravity_y = 0.22;
    wind_frequency_base = 0.7;
    wind_frequency_per = 6.0;
    wind_phase_step = 0.73;
    wind_amplitude_base = 0.03;
    wind_amplitude_per = 0.8;
    drag_min = 0.25;
    drag_base = 0.85;
    drag_radius_sensitivity = 8.0;

    // ===== 折射渲染 =====
    // radius_epsilon:半径过小时跳过(cs_refraction);同时用作"圆心附近"的除零
    //   保护阈值(fs_main 重建圆心方向时);
    // refraction_eta_water:水折射率,用于斯涅尔公式(fs_main 的 lateralProfile);
    // refraction_strength_per:强度对折射放大因子的增益(cs_refraction 存进偏移大小);
    // refraction_offset_clamp:折射偏移上限(uv 比例:x 按画布宽,y 按画布高);
    // lateral_z_epsilon:折射方向投影到 z = -1 平面时防止除零的阈值.
    radius_epsilon = 0.0001;
    refraction_eta_water = 1.333;
    refraction_strength_per = 10.0;
    refraction_offset_clamp = 0.12;
    lateral_z_epsilon = 0.001;

    // ===== 水滴边缘高光 =====
    // highlight_edge0/1:高光随覆盖度衰减的起止阈值;
    // highlight_strength:高光叠加强度;
    // highlight_color_r/g/b:高光颜色.
    highlight_edge0 = 0.25;
    highlight_edge1 = 0.85;
    highlight_strength = 0.05;
    highlight_color_r = 0.90;
    highlight_color_g = 0.96;
    highlight_color_b = 1.00;

    // ===== 车速 / 背景层距离(实时滑块) =====
    // vehicle_speed:车速倍率,同时驱动背景滚动与水滴后吹风;
    // far_distance / mid_distance / near_distance:三层背景的"距离"系数,
    //   距离越大滚动越慢(视差速度 = 基础速度 / 距离).
    vehicle_speed = 1.0;
    far_distance = 1.0;
    mid_distance = 1.0;
    near_distance = 1.0;

    // ===== 水滴外观 / 物理(实时滑块) =====
    // droplet_size:水滴整体大小倍率,直接缩放半径(半径的尺度见 radius_min);
    // wind_backward_factor:后吹风系数,水平风速 = -车速 × 该系数;
    // wind_sway_scale:原有正弦摇摆风的整体倍率;
    // gravity_scale:重力(下落速度)倍率;
    // refraction_scale:斯涅尔折射偏移的整体倍率.
    droplet_size = 1.0;
    wind_backward_factor = 0.15;
    wind_sway_scale = 1.0;
    gravity_scale = 1.0;
    refraction_scale = 1.0;

    // ===== 玻璃材质浓度(实时滑块) =====
    // dirt_opacity / fog_opacity / interior_opacity:
    // 污渍,雾气,车厢灯光反射的混合强度.
    dirt_opacity = 0.55;
    fog_opacity = 0.30;
    interior_opacity = 0.55;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniform_layout_is_16_byte_aligned() {
        // WGSL uniform 要求结构体大小为 16 字节倍数.
        assert_eq!(std::mem::size_of::<DropletParams>() % 16, 0);
        assert!(std::mem::size_of::<DropletParams>() >= 16);
    }

    #[test]
    fn wgsl_decl_is_injected_once() {
        let source = crate::pipelines::shader_source();
        // 注入后的完整着色器源码里,struct DropletParams 的声明只能出现一次.
        assert_eq!(source.matches("struct DropletParams {").count(), 1);
        // 全部字段都进入了注入的 WGSL 声明.
        for field in [
            "spawn_x_min",
            "spawn_x_span",
            "spawn_y_min",
            "spawn_y_span",
            "velocity_x_span",
            "velocity_y_min",
            "velocity_y_span",
            "radius_min",
            "radius_span",
            "strength_min",
            "strength_span",
            "reset_y_min",
            "reset_y_span",
            "reset_margin",
            "random_time_scale",
            "dt_max",
            "gravity_y",
            "wind_frequency_base",
            "wind_frequency_per",
            "wind_phase_step",
            "wind_amplitude_base",
            "wind_amplitude_per",
            "drag_min",
            "drag_base",
            "drag_radius_sensitivity",
            "radius_epsilon",
            "refraction_eta_water",
            "refraction_strength_per",
            "refraction_offset_clamp",
            "lateral_z_epsilon",
            "highlight_edge0",
            "highlight_edge1",
            "highlight_strength",
            "highlight_color_r",
            "highlight_color_g",
            "highlight_color_b",
            "vehicle_speed",
            "far_distance",
            "mid_distance",
            "near_distance",
            "droplet_size",
            "wind_backward_factor",
            "wind_sway_scale",
            "gravity_scale",
            "refraction_scale",
            "dirt_opacity",
            "fog_opacity",
            "interior_opacity",
        ] {
            assert!(source.contains(field), "注入的 WGSL 声明缺少字段: {field}");
        }
    }

    #[test]
    fn droplet_count_matches_wgsl() {
        let source = crate::pipelines::shader_source();
        let count = crate::droplets::DROPLET_COUNT;
        // 水滴数量是编译期常量(数组长度 / workgroup 大小不能用 uniform),
        // 这里显式校验 Rust 与 WGSL 两处文本保持一致.
        assert!(source.contains(&format!("array<Droplet, {count}>")));
        assert!(source.contains(&format!("@workgroup_size({count})")));
        assert!(source.contains(&format!("i >= {count}u")));
        assert!(source.contains(&format!("i < {count}u")));
    }
}
