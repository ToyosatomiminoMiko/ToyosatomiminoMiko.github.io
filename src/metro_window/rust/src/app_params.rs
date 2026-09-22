/*
应用层参数模块
- 主循环节奏(帧率上限 / 时间步长),初始时间,以及"前端参数名 -> GlassParams 字段"
  的分发与上传入参校验.
- **这里没有产品默认值**:风格编号,滑块区间,图层清单,资源路径,上传上限
  都由前端 config.ts 声明,经 `startApp` 传入(见 boot_config.rs 的模块说明).
  本模块只保留两类东西:纯渲染内部调参(帧率 / 时间步长),以及实现性质的分发.
- 纯 GPU 管线参数见 render_params.rs,程序化贴图参数见 texture_params.rs,
  车窗玻璃参数见 glass_params.rs.
*/
use crate::boot_config::BootConfig;
use crate::glass_params::GlassParams;
use crate::render_params::RGBA_BYTES_PER_PIXEL;

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
pub(crate) const MS_PER_SECOND: f32 = 1000.0;

/// 单帧最大时间步长(秒).
///
/// 含义:标签页切回 / 断点暂停后两帧间隔会非常大,这里截断,避免动画时钟一次跳很远.
/// 取值:0.1(相当于 10fps 的时间步).
pub(crate) const MAX_FRAME_DELTA_SECONDS: f32 = 0.1;

/// 启动时写入 Uniforms 的时间(秒).
///
/// 含义:动画时钟起点;改大相当于跳过开头一段动画.
pub(crate) const INITIAL_TIME_SECONDS: f32 = 0.0;

// ---------- 滑块参数:名字 -> GlassParams 字段 ----------

/// 按名字取 `GlassParams` 里的对应字段.
///
/// 这是**实现**:uniform 结构体有哪些字段是着色器的事,前端只声明"界面提供哪些
/// 滑块与它们的区间".名字对不上就返回 `None`,由调用方决定是报错还是忽略.
/// 内部字段(如对齐用的 `_padding`)不在这里登记,前端也传不进来.
fn param_field<'a>(params: &'a mut GlassParams, name: &str) -> Option<&'a mut f32> {
    match name {
        // 车速 / 背景层距离
        "vehicle_speed" => Some(&mut params.vehicle_speed),
        "far_distance" => Some(&mut params.far_distance),
        "mid_distance" => Some(&mut params.mid_distance),
        "near_distance" => Some(&mut params.near_distance),
        // 玻璃材质浓度
        "dirt_opacity" => Some(&mut params.dirt_opacity),
        "fog_opacity" => Some(&mut params.fog_opacity),
        "interior_opacity" => Some(&mut params.interior_opacity),
        _ => None,
    }
}

/// 该名字是不是可写入的滑块参数(启动时校验前端清单用).
///
/// 用一次真实查找实现而不是再维护一份名字表:名单只有 `param_field` 一处事实源.
pub(crate) fn is_known_param(name: &str) -> bool {
    let mut params = GlassParams::DEFAULT;
    param_field(&mut params, name).is_some()
}

/// 把已经夹好的值写进对应字段;名字未知返回 `false`.
///
/// `pub` 是因为原生示例(`examples/preview.rs`)用它做离线调参,与线上
/// `setParam` 走同一份字段分发.
pub fn write_param(params: &mut GlassParams, name: &str, value: f32) -> bool {
    match param_field(params, name) {
        Some(field) => {
            *field = value;
            true
        }
        None => false,
    }
}

// ---------- 前端上传替换贴图:入参校验 ----------

/// 查"可上传槽位"白名单,返回 `(material_views 下标, 槽位名)`.
///
/// 白名单来自前端清单(`config.ts` 的 `UPLOAD_LAYERS`):哪些层允许被替换是产品
/// 决定,不是 Rust 决定."恢复默认"只需要白名单,真正的上传再走 [`upload_target`].
pub(crate) fn upload_slot(boot: &BootConfig, layer: u32) -> Result<(u32, &str), String> {
    if let Some(config) = boot.layer(layer) {
        return Ok((config.slot, config.name.as_str()));
    }
    let allowed: Vec<String> = boot
        .layers
        .iter()
        .map(|config| format!("{}={}", config.slot, config.name))
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
/// `max_dimension` 是有效边长上限(前端策略值与设备能力取小,见
/// [`BootConfig::effective_upload_max`]);`byte_len` 是前端传来的 RGBA8 缓冲区
/// 长度,必须与 `width * height * 4` 严格相等:少了会越界读,多了会被 wgpu 当成
/// 行距不匹配 -- 两种都在这里挡掉.
pub(crate) fn upload_target(
    boot: &BootConfig,
    max_dimension: u32,
    layer: u32,
    width: u32,
    height: u32,
    byte_len: usize,
) -> Result<u32, String> {
    let (slot, name) = upload_slot(boot, layer)?;
    if width == 0 || height == 0 {
        return Err(format!("{name}: 图片尺寸非法({width}x{height})"));
    }
    // 先比边长再算像素总数:上限内 8192 * 8192 * 4 = 256MiB 仍在 usize(32 位 wasm)
    // 范围内,但更早拒绝可以少一次乘法,也顺带避免将来放宽上限时溢出.
    if width > max_dimension || height > max_dimension {
        return Err(format!(
            "{name}: 图片边长超过上限 {max_dimension}px({width}x{height})"
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::boot_config::{LayerConfig, ParamRange, SHADER_CITY_LAYER_COUNT};

    /// 测试用配置:数值与前端 config.ts 对齐,但这里只当测试数据.
    fn boot() -> BootConfig {
        let names = ["level_3", "level_2", "level_1", "level_0"];
        let layers = names
            .iter()
            .enumerate()
            .map(|(index, name)| LayerConfig {
                slot: index as u32,
                name: (*name).to_string(),
                file: format!("{name}.png"),
                opaque: index == 0,
            })
            .collect();
        let params = ["vehicle_speed", "dirt_opacity"]
            .iter()
            .map(|name| ParamRange {
                name: (*name).to_string(),
                min: 0.0,
                max: 1.0,
            })
            .collect();
        BootConfig::new(
            0,
            3,
            "/metro_window/resource".to_string(),
            8192,
            layers,
            params,
        )
        .expect("测试配置必须合法")
    }

    #[test]
    fn shader_layer_count_matches_the_test_config() {
        // 测试数据自己也要跟"实现能力"对齐,否则下面的用例会因为别的原因失败.
        assert_eq!(boot().layers.len(), SHADER_CITY_LAYER_COUNT as usize);
    }

    #[test]
    fn every_public_glass_field_is_dispatchable() {
        // `_` 前缀的字段是内部用的(如对齐填充),不参与 setParam 分发.
        for name in GlassParams::FIELD_NAMES
            .iter()
            .filter(|name| !name.starts_with('_'))
        {
            assert!(
                is_known_param(name),
                "GlassParams 字段 {name} 没有对应的 setParam 分发"
            );
        }
    }

    #[test]
    fn internal_fields_are_not_dispatchable() {
        // 约定:内部字段以 `_` 开头,前端传不进来(传了也只会被当成未知参数).
        for name in GlassParams::FIELD_NAMES
            .iter()
            .filter(|n| n.starts_with('_'))
        {
            assert!(!is_known_param(name), "内部字段 {name} 不该可写");
        }
        assert!(!is_known_param("vehicle_speeed"));
    }

    #[test]
    fn write_param_writes_only_known_fields() {
        let mut params = GlassParams::DEFAULT;
        assert!(write_param(&mut params, "vehicle_speed", 2.5));
        assert_eq!(params.vehicle_speed, 2.5);
        assert!(!write_param(&mut params, "nope", 1.0));
        assert_eq!(params, {
            let mut expected = GlassParams::DEFAULT;
            expected.vehicle_speed = 2.5;
            expected
        });
    }

    #[test]
    fn upload_slot_lists_allowed_slots_in_error() {
        assert_eq!(upload_slot(&boot(), 2), Ok((2, "level_1")));
        let error = upload_slot(&boot(), 7).expect_err("越界槽位必须被拒绝");
        assert!(error.contains("不支持上传"), "报错文案不对: {error}");
        assert!(error.contains("0=level_3"), "报错应列出白名单: {error}");
    }

    #[test]
    fn upload_target_validates_size_and_length() {
        let boot = boot();
        let max = boot.effective_upload_max(8192);
        // 合法:64x32 的 RGBA8 像素
        assert_eq!(upload_target(&boot, max, 1, 64, 32, 64 * 32 * 4), Ok(1));
        // 零尺寸
        assert!(upload_target(&boot, max, 1, 0, 32, 0).is_err());
        // 超上限(用设备能力更低的情形,证明用的是"有效上限"而不是配置值)
        let small = boot.effective_upload_max(64);
        assert_eq!(small, 64);
        assert!(upload_target(&boot, small, 1, 65, 32, 65 * 32 * 4).is_err());
        // 像素字节数不匹配
        assert!(upload_target(&boot, max, 1, 64, 32, 64 * 32 * 3).is_err());
    }
}
