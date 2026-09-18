/*
应用层参数配置模块
- 主循环节奏(帧率上限 / 时间步长),资源路径,初始 Uniforms,样式数量上限
  以及前端滑块的"名字 + clamp 范围"配置表集中于此.
- 这些常量原先散落在 src/lib.rs 与 src/app.rs 里,数值为等价替换,不改变行为.
- 纯 GPU 管线参数见 src/render_params.rs,程序化贴图参数见 src/texture_params.rs,
  水滴物理参数见 src/droplet_params.rs.
*/
use crate::droplet_params::DropletParams;

/// 渲染帧率上限 60fps 对应的最小帧间隔(毫秒).
///
/// 含义:主循环累计的真实流逝时间达到该值才真正渲染一帧,防止在无垂直同步 /
/// 高刷新率环境下无意义地跑满 CPU 与 GPU.
/// 单位:毫秒(ms).公式:`1000.0 / 60.0`(每秒 1000ms 除以目标帧率 60).
/// 调参影响:调小 => 帧率上限提高(更顺滑但更耗电);调大 => 省电但动画变卡.
pub(crate) const FRAME_INTERVAL_MS: f64 = 1000.0 / 60.0;

/// 毫秒 -> 秒的换算系数.
///
/// 含义:`performance.now()` 返回毫秒,着色器要求秒,做单位换算用.
/// 单位:ms/s.固定 1000,不是可调参数.
pub(crate) const MS_PER_SECOND: f32 = 1000.0;

/// 单帧最大时间步长(秒).
///
/// 含义:标签页切回 / 断点暂停后两帧间隔会非常大,这里截断防止水滴物理积分爆炸.
/// 取值:0.1(相当于 10fps 的时间步).调大 => 掉帧时水滴一步跳得更远.
pub(crate) const MAX_FRAME_DELTA_SECONDS: f32 = 0.1;

/// 启动时写入 Uniforms 的帧间隔(秒).
///
/// 含义:首帧的占位值,之后每帧都会被真实 delta 覆盖.
/// 典型取值 0.016(≈60fps).
pub(crate) const INITIAL_DELTA_SECONDS: f32 = 0.016;

/// 启动时写入 Uniforms 的时间(秒).
///
/// 含义:动画时钟起点;改大相当于跳过开头一段动画.
pub(crate) const INITIAL_TIME_SECONDS: f32 = 0.0;

/// 启动时的样式编号.
///
/// 含义:着色器 applyStyle 的分支编号,0 = 默认样式;
/// 取值范围 0..=MAX_STYLE_INDEX,与前端按钮的 data-style 对应.
pub(crate) const INITIAL_STYLE_ID: u32 = 0;

/// setStyle 允许的最大样式编号.
///
/// 含义:前端可选样式数量 - 1;越界编号会被夹到该值,避免着色器走进未定义分支.
/// 前端 (web/src/page.ts) 目前提供 0 / 1 / 2 三种样式,因此上限为 2.
pub(crate) const MAX_STYLE_INDEX: u32 = 2;

/// 城市贴图在站点里的公开路径前缀.
///
/// 这四张 PNG 是 Rust 在运行时自己 fetch 的,既不进 wasm 包,也不走 Vite 的
/// 资源图(拿不到带 hash 的地址),所以这里只能是构建后真实可访问的绝对路径.
/// 并进本站后资源挂在 `/metro_window/resource/` 下,映射由 `vite.config.ts`
/// 的 `metroWindowAssets()` 负责(dev 下重写请求,build 下按原路径 emit).
///
/// 用绝对路径而不是相对路径:相对路径会随页面 URL 变化(例如 /web/index.html
/// 这类回退地址),导致 fetch 拿到 HTML 回退页而不是 PNG,从而报
/// Invalid PNG signature.
pub(crate) const RESOURCE_BASE: &str = "/metro_window/resource";

/// 城市背景层贴图文件名(Layer 0,最远的一层).
pub(crate) const CITY_BG_FILE: &str = "city_bg.png";
/// 城市远景层贴图文件名(Layer 1).
pub(crate) const CITY_FAR_FILE: &str = "city_far.png";
/// 城市中景层贴图文件名(Layer 2).
pub(crate) const CITY_MID_FILE: &str = "city_mid.png";
/// 城市近景层贴图文件名(Layer 3).
pub(crate) const CITY_NEAR_FILE: &str = "city_near.png";

/// 拼出某张城市贴图的公开地址(约定见 [`RESOURCE_BASE`]).
pub(crate) fn city_png(file: &str) -> String {
    format!("{RESOURCE_BASE}/{file}")
}

/// 单个实时滑块的配置.
///
/// `name` 是前端 `setParam(name, value)` 传入的参数名,必须与
/// web/src/metro_window.ts 的 `param` 字段逐字一致(前端按名字调用,
/// 名字一旦改动前端就会打到未知分支).
#[derive(Clone, Copy, Debug)]
pub(crate) struct SliderSpec {
    /// 前端使用的参数名(字面值不可改动).
    pub(crate) name: &'static str,
    /// clamp 下限(含).前端越界时夹到该值,避免着色器出现非法输入.
    pub(crate) min: f32,
    /// clamp 上限(含).
    pub(crate) max: f32,
}

impl SliderSpec {
    /// 把前端传来的值夹到 [min, max].
    pub(crate) fn clamp(self, value: f32) -> f32 {
        value.clamp(self.min, self.max)
    }

    /// 把 value 夹到本滑块范围后写入 [`DropletParams`] 的对应字段.
    ///
    /// 分支字符串与 [`SLIDERS`] 中的 `name` 一一对应;
    /// `set_param` 已先按表查过名字,所以正常不会走到兜底分支.
    pub(crate) fn apply(self, params: &mut DropletParams, value: f32) {
        let v = self.clamp(value);
        match self.name {
            // 车速 / 背景层距离
            "vehicle_speed" => params.vehicle_speed = v,
            "far_distance" => params.far_distance = v,
            "mid_distance" => params.mid_distance = v,
            "near_distance" => params.near_distance = v,
            // 水滴外观 / 物理
            "droplet_size" => params.droplet_size = v,
            "wind_backward_factor" => params.wind_backward_factor = v,
            "wind_sway_scale" => params.wind_sway_scale = v,
            "gravity_scale" => params.gravity_scale = v,
            "refraction_scale" => params.refraction_scale = v,
            // 玻璃材质浓度
            "dirt_opacity" => params.dirt_opacity = v,
            "fog_opacity" => params.fog_opacity = v,
            "interior_opacity" => params.interior_opacity = v,
            // 表与 apply 不同步时才会触发(有单测约束 SLIDERS 全覆盖).
            _ => unreachable!("SLIDERS 中的参数未在 apply 中实现: {}", self.name),
        }
    }
}

/// 全部实时滑块的配置表(名字 + clamp 范围).
///
/// 顺序与前端控件一致;每一项的 `name` 必须与 web/src/metro_window.ts
/// 的 `param` 字段一致.`min` / `max` 是前端数值的合法区间:
/// 越界值会被夹到边界而不是拒绝,保证着色器永远拿到安全输入.
pub(crate) const SLIDERS: &[SliderSpec] = &[
    // ===== 车速 / 背景层距离 =====
    // 车速倍率:同时驱动背景滚动与水滴后吹风;0 = 静止,越大越快.
    SliderSpec {
        name: "vehicle_speed",
        min: 0.0,
        max: 5.0,
    },
    // 远景层距离系数:视差速度 = 基础速度 / 距离,范围 0.1..3.0.
    SliderSpec {
        name: "far_distance",
        min: 0.1,
        max: 3.0,
    },
    // 中景层距离系数.
    SliderSpec {
        name: "mid_distance",
        min: 0.1,
        max: 3.0,
    },
    // 近景层距离系数.
    SliderSpec {
        name: "near_distance",
        min: 0.1,
        max: 3.0,
    },
    // ===== 水滴外观 / 物理 =====
    // 水滴整体大小倍率(直接缩放半径).
    SliderSpec {
        name: "droplet_size",
        min: 0.1,
        max: 3.0,
    },
    // 后吹风系数:水平风速 = -车速 × 该系数.
    SliderSpec {
        name: "wind_backward_factor",
        min: 0.0,
        max: 1.0,
    },
    // 原有正弦摇摆风的整体倍率.
    SliderSpec {
        name: "wind_sway_scale",
        min: 0.0,
        max: 3.0,
    },
    // 重力(下落速度)倍率.
    SliderSpec {
        name: "gravity_scale",
        min: 0.0,
        max: 3.0,
    },
    // 斯涅尔折射偏移的整体倍率.
    SliderSpec {
        name: "refraction_scale",
        min: 0.0,
        max: 3.0,
    },
    // ===== 玻璃材质浓度 =====
    // 污渍混合强度.
    SliderSpec {
        name: "dirt_opacity",
        min: 0.0,
        max: 1.0,
    },
    // 雾气混合强度.
    SliderSpec {
        name: "fog_opacity",
        min: 0.0,
        max: 1.0,
    },
    // 车厢灯光反射混合强度.
    SliderSpec {
        name: "interior_opacity",
        min: 0.0,
        max: 1.0,
    },
];

/// 按名字查滑块配置;未登记的名字返回 `None`(`set_param` 会打印警告).
pub(crate) fn slider_spec(name: &str) -> Option<SliderSpec> {
    SLIDERS.iter().copied().find(|spec| spec.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 前端实际使用的 12 个参数名(与 web/src/metro_window.ts 一致).
    /// 这份清单是断言用的期望集合:表里多一个/少一个都会失败.
    const EXPECTED_SLIDER_NAMES: [&str; 12] = [
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
    ];

    #[test]
    fn slider_names_match_frontend() {
        assert_eq!(SLIDERS.len(), EXPECTED_SLIDER_NAMES.len());
        for name in EXPECTED_SLIDER_NAMES {
            assert!(slider_spec(name).is_some(), "SLIDERS 缺少前端参数: {name}");
        }
    }

    #[test]
    fn slider_names_are_unique() {
        for (i, a) in SLIDERS.iter().enumerate() {
            for b in &SLIDERS[i + 1..] {
                assert_ne!(a.name, b.name, "滑块名字重复: {}", a.name);
            }
        }
    }

    #[test]
    fn every_slider_spec_writes_a_field() {
        // 用"低于下限"的输入触发 clamp 到 min,再断言参数确实被写入:
        // 表里有条目但 apply 漏了分支时会 panic / 断言失败.
        for spec in SLIDERS {
            let mut params = DropletParams::DEFAULT;
            spec.apply(&mut params, spec.min - 1.0);
            assert_ne!(
                params,
                DropletParams::DEFAULT,
                "滑块 {} 没有写入任何字段",
                spec.name
            );
        }
    }
}
