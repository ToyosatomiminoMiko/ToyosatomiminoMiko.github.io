/*
单测共用的测试数据.
app_params.rs 与 boot_config.rs 都需要一份"合法的典型启动配置",
放在这里一份,层数 / 槽位 / 参数名就不会各自漂移.
*/
use crate::boot_config::{BootConfig, LayerConfig, ParamRange};

/// 灰度 PPM 每像素通道数(只写 R=G=B,无 alpha).
///
/// random.rs 与 textures.rs 的 PPM 可视化测试共用同一份约定.
pub(crate) const PPM_CHANNELS: u32 = 3;

/// 典型的合法图层清单:城市四层,槽位号 = 下标,只有最底层不透明.
pub(crate) fn layers() -> Vec<LayerConfig> {
    vec![
        layer(0, "level_3", "level_3.png", true),
        layer(1, "level_2", "level_2.png", false),
        layer(2, "level_1", "level_1.png", false),
        layer(3, "level_0", "level_0.png", false),
    ]
}

pub(crate) fn layer(slot: u32, name: &str, file: &str, opaque: bool) -> LayerConfig {
    LayerConfig {
        slot,
        name: name.to_string(),
        file: file.to_string(),
        opaque,
    }
}

/// 典型的合法滑块清单:名字都必须是 `app_params::param_field` 能分发的.
pub(crate) fn params() -> Vec<ParamRange> {
    vec![
        range("vehicle_speed", 0.0, 3.0),
        range("interior_opacity", 0.0, 1.0),
    ]
}

pub(crate) fn range(name: &str, min: f32, max: f32) -> ParamRange {
    ParamRange {
        name: name.to_string(),
        min,
        max,
    }
}

/// 用上面的清单装一个校验通过的启动配置(资源路径带结尾斜杠,顺带覆盖去斜杠逻辑).
pub(crate) fn config(style_index: u32, style_count: u32) -> Result<BootConfig, String> {
    BootConfig::new(
        style_index,
        style_count,
        "/metro_window/resource/".to_string(),
        8192,
        layers(),
        params(),
    )
}
