/*
应用层参数配置模块
- 主循环节奏(帧率上限 / 时间步长),资源路径,初始 Uniforms,样式数量上限
  以及前端滑块的"名字 + clamp 范围"配置表集中于此.
- 这些常量原先散落在 src/lib.rs 与 src/app.rs 里,数值为等价替换,不改变行为.
- 纯 GPU 管线参数见 src/render_params.rs,程序化贴图参数见 src/texture_params.rs,
  水滴物理参数见 src/droplet_params.rs.
*/
use crate::droplet_params::DropletParams;
use crate::render_params::{MAX_TEXTURE_DIMENSION, RGBA_BYTES_PER_PIXEL};

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
/// 前端 (src/metro_window/src/config.ts 的 STYLE_PRESETS) 目前提供 0 / 1 / 2 三种样式,因此上限为 2.
pub(crate) const MAX_STYLE_INDEX: u32 = 2;

/// 城市贴图在站点里的公开路径前缀.
///
/// 这四张 PNG 是 Rust 在运行时自己 fetch 的,既不进 wasm 包,也不走 Vite 的
/// 资源图(拿不到带 hash 的地址),所以这里只能是构建后真实可访问的绝对路径.
/// 文件放在站点唯一的静态资源根 `public/metro_window/resource/` 下,Vite 把
/// `public/` 按原路径挂载(dev)/拷贝(build),因此 URL 与目录层级一致,
/// 不需要任何重写插件.
///
/// 用绝对路径而不是相对路径:相对路径会随页面 URL 变化(例如 /4xx_page/404.html
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

// ---------- 前端上传替换贴图 ----------

/// 允许前端上传替换的材质槽位:`(material_views 下标, 槽位名)`.
///
/// 槽位号就是 `App::material_views` 的下标(见 src/app.rs 里那张表的构建顺序:
/// bg / far / mid / near / dirt / fog / interior),所以 0..=3 正好是城市背景四层,
/// 也就是 `public/metro_window/resource/` 下按层分开交付的那四张 PNG --
/// 前端一层给一个上传按钮,换掉其中一层不影响另外三层(视差照旧).
///
/// 效果贴图(污渍 / 雾气 / 车厢倒影)是程序化生成的,与背景贴图的原理不同,
/// **不在当前范围内**:它们的槽位在这里没有登记,`upload_slot` 会直接拒绝.
/// 宁可报错也不要出现"前端以为在换污渍,实际换了城市层"这种静默错配.
/// 将来要放开某一层:在下面加一行,并在前端 config.ts 的 `UPLOAD_LAYERS`
/// 同步加一条(两侧各有单测守着这份跨语言契约).
pub(crate) const UPLOADABLE_LAYERS: &[(u32, &str)] = &[
    (0, "city_bg"),
    (1, "city_far"),
    (2, "city_mid"),
    (3, "city_near"),
];

// 编译期不变量:槽位号必须等于它在表里的下标.
// 上传路径按"表里的下标 -> material_views 下标"取用,槽位号又会被前端写死,
// 两者一旦不一致,前端传 2 就可能落到别的层;这条断言把它变成编译错误.
const _: () = {
    let mut i = 0;
    while i < UPLOADABLE_LAYERS.len() {
        assert!(UPLOADABLE_LAYERS[i].0 == i as u32);
        i += 1;
    }
};

/// 查"可上传槽位"白名单,返回 `(material_views 下标, 槽位名)`.
///
/// 单独拆出来是因为"恢复默认"不需要校验尺寸与像素字节数,只需要白名单;
/// 真正的上传再走 [`upload_target`] 补齐这两项.
pub(crate) fn upload_slot(layer: u32) -> Result<(usize, &'static str), String> {
    if let Some(&(slot, name)) = UPLOADABLE_LAYERS.iter().find(|(slot, _)| *slot == layer) {
        return Ok((slot as usize, name));
    }
    let allowed: Vec<String> = UPLOADABLE_LAYERS
        .iter()
        .map(|(slot, name)| format!("{slot}={name}"))
        .collect();
    Err(format!(
        "不支持上传的材质槽位: {layer}(可上传: {})",
        allowed.join(", ")
    ))
}

/// 校验一次"上传替换贴图"的入参,返回 `material_views` 下标.
///
/// 单独拆成纯函数(不碰设备 / 纹理)是为了能在**没有 GPU** 的单测里覆盖全部
/// 拒绝分支:真正的上传路径要建 wgpu 纹理,而建纹理必须有设备.
///
/// `byte_len` 是前端传来的 RGBA8 缓冲区长度,必须与 `width * height * 4` 严格相等:
/// 少了会越界读,多了会被 wgpu 当成行距不匹配 -- 两种都在这里挡掉.
pub(crate) fn upload_target(
    layer: u32,
    width: u32,
    height: u32,
    byte_len: usize,
) -> Result<usize, String> {
    let (slot, name) = upload_slot(layer)?;
    if width == 0 || height == 0 {
        return Err(format!("{name}: 图片尺寸非法({width}x{height})"));
    }
    // 先比边长再算像素总数:上限内 8192 * 8192 * 4 = 256MiB 仍在 usize(32 位 wasm)
    // 范围内,但更早拒绝可以少一次乘法,也顺带避免将来放宽上限时溢出.
    if width > MAX_TEXTURE_DIMENSION || height > MAX_TEXTURE_DIMENSION {
        return Err(format!(
            "{name}: 图片边长超过上限 {MAX_TEXTURE_DIMENSION}px({width}x{height})"
        ));
    }
    let expected: usize = width as usize * height as usize * RGBA_BYTES_PER_PIXEL as usize;
    if byte_len != expected {
        return Err(format!(
            "{name}: 像素字节数与尺寸不符,期望 {expected},实际 {byte_len}"
        ));
    }
    Ok(slot)
}

/// 单个实时滑块的配置.
///
/// `name` 是前端 `setParam(name, value)` 传入的参数名,必须与
/// src/metro_window/src/config.ts 的 `param` 字段逐字一致(前端按名字调用,
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
            // 形状(滑动中的拉长倍数)
            "elongation_max" => params.elongation_max = v,
            // 静止阈值(小珠被表面张力钉住)
            "pin_radius" => params.pin_radius = v,
            // 背景景深(水珠是清晰岛)
            "blur_max_lod" => params.blur_max_lod = v,
            "blur_min_lod" => params.blur_min_lod = v,
            "droplet_clear" => params.droplet_clear = v,
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
/// 顺序与前端控件一致;每一项的 `name` 必须与 src/metro_window/src/config.ts
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
    // 滑动中水珠的拉长倍数(1 = 永远正圆,长轴沿速度方向).
    SliderSpec {
        name: "elongation_max",
        min: 1.0,
        max: 6.0,
    },
    // 静止阈值:半径小于它的小珠子被钉住(不滑,只在原地长大又消失).
    SliderSpec {
        name: "pin_radius",
        min: 0.0,
        max: 0.03,
    },
    // ===== 背景景深(水珠是清晰岛)=====
    // 无水处的 mip 级:0 = 完全不糊,越大背景越糊(水珠越显眼).
    SliderSpec {
        name: "blur_max_lod",
        min: 0.0,
        max: 7.0,
    },
    // 水珠内部的 mip 级:0 = 水珠里最清晰.
    SliderSpec {
        name: "blur_min_lod",
        min: 0.0,
        max: 4.0,
    },
    // 水珠对雾气/污渍的擦除比例.
    SliderSpec {
        name: "droplet_clear",
        min: 0.0,
        max: 1.0,
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

/// 按名字把值写进 [`DropletParams`] 的对应字段(clamp 到该滑块的区间).
///
/// 返回是否命中已知参数名.这是"参数名 -> 字段"的**唯一**入口:
///   - wasm 侧 `setParam` 走它(前端拖滑块);
///   - 原生示例 `examples/preview.rs` 也走它(用环境变量覆盖单个参数做 A/B),
///     两边共用同一张表,不会出现"示例能改的参数与线上不是一套".
pub fn apply_param(params: &mut DropletParams, name: &str, value: f32) -> bool {
    match slider_spec(name) {
        Some(spec) => {
            spec.apply(params, value);
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 前端实际使用的参数名(与 src/metro_window/src/config.ts 的 SLIDER_GROUPS 一致).
    /// 这份清单是断言用的期望集合:表里多一个/少一个都会失败.
    const EXPECTED_SLIDER_NAMES: [&str; 17] = [
        "vehicle_speed",
        "far_distance",
        "mid_distance",
        "near_distance",
        "droplet_size",
        "wind_backward_factor",
        "wind_sway_scale",
        "gravity_scale",
        "refraction_scale",
        "elongation_max",
        "pin_radius",
        "blur_max_lod",
        "blur_min_lod",
        "droplet_clear",
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

    /// 前端 config.ts 的 UPLOAD_LAYERS 里的槽位名(跨语言契约,逐字一致).
    const EXPECTED_UPLOAD_LAYERS: [&str; 4] = ["city_bg", "city_far", "city_mid", "city_near"];

    #[test]
    fn uploadable_layers_match_frontend() {
        assert_eq!(UPLOADABLE_LAYERS.len(), EXPECTED_UPLOAD_LAYERS.len());
        for (i, name) in EXPECTED_UPLOAD_LAYERS.iter().enumerate() {
            assert_eq!(
                UPLOADABLE_LAYERS[i].1, *name,
                "上传槽位 {i} 的名字与前端不一致"
            );
        }
    }

    /*
     上传槽位的名字必须与启动时真正 fetch 的那四张 PNG 对应:
     名字只是给前端看的,真正决定"换的是哪张图"的是槽位号 -> material_views 下标,
     而 material_views 的前四项就是 App::new 里按 CITY_*_FILE 顺序建出来的纹理.
     这条测试把"名字 <-> 文件名"钉死,前端清单又用同样的名字做契约,两边同时改才漂移.
    */
    #[test]
    fn uploadable_layers_match_city_files() {
        let files: [&str; 4] = [CITY_BG_FILE, CITY_FAR_FILE, CITY_MID_FILE, CITY_NEAR_FILE];
        for ((slot, name), file) in UPLOADABLE_LAYERS.iter().zip(files) {
            assert_eq!(
                format!("{name}.png"),
                file,
                "槽位 {slot} 的名字与城市贴图文件名对不上"
            );
        }
    }

    #[test]
    fn upload_slot_rejects_unknown_layer() {
        assert!(upload_slot(0).is_ok());
        // 4..=6 是污渍 / 雾气 / 车厢:程序化贴图,当前不允许上传.
        for layer in [4, 5, 6, 7, 99] {
            let error = upload_slot(layer).expect_err("越界槽位必须被拒绝");
            assert!(error.contains("不支持上传"), "报错文案不对: {error}");
        }
    }

    #[test]
    fn upload_target_validates_size_and_length() {
        // 合法:64x32 的 RGBA8 像素
        assert_eq!(upload_target(2, 64, 32, 64 * 32 * 4).unwrap(), 2);
        // 尺寸为 0 / 边长超上限 / 字节数对不上,三种都要拒绝
        for (w, h, len) in [
            (0_u32, 32_u32, 0_usize),
            (32, 0, 0),
            (MAX_TEXTURE_DIMENSION + 1, 1, 0),
            (1, MAX_TEXTURE_DIMENSION + 1, 0),
            (64, 32, 64 * 32 * 4 - 1),
            (64, 32, 64 * 32 * 4 + 4),
        ] {
            assert!(
                upload_target(0, w, h, len).is_err(),
                "{w}x{h} / {len} 字节应该被拒绝"
            );
        }
    }
}
