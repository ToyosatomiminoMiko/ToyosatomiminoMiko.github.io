/*
启动配置模块:前端 -> Rust 的**唯一数据来源**入口.

为什么要有这一层:凡是"产品 / 资源 / 界面可决定"的值 -- 有几种风格,有哪几层
城市贴图,贴图文件叫什么,资源挂在哪个 URL,上传图片允许多大,每个滑块的
clamp 区间 -- 都写在 src/metro_window/src/config.ts 里,由挂载函数作为
`startApp(canvas, status, config)` 的第三个参数一次性传进来.

Rust 侧不再各存一份:这里的 [`BootConfig`] 只是"接收 + 校验 + 夹取",没有
任何产品默认值.剩下留在 Rust 的常量分两类,都不属于配置:

  - **着色器/管线的实现能力**([`SHADER_STYLE_COUNT`] / [`SHADER_CITY_LAYER_COUNT`]):
    要加风格或图层,必须同时改 shaders.wgsl / pipelines.rs,所以它是实现事实;
    TS 声明的数量与它不一致时,这里直接报错而不是静默降级.
  - **渲染内部调参**(帧率,时间步长,噪声频率,贴图尺寸等):见
    render_params.rs / texture_params.rs / random_params.rs.

早先这些值在两侧各写一份,再靠"镜像单测"互相钉住(见 README 的迁移记录),
那种做法每加一个值都要改两处,加两个测试,漏一处就是静默错配 -- 现在改成
单向传参 + 启动时校验,错了就在启动那一刻报出来.
*/
use js_sys::{Array, Reflect};
use wasm_bindgen::JsValue;

use crate::app_params::is_known_param;

/// 着色器 `applyStyle` 实际实现了几个分支(实现能力,不是配置).
///
/// 要新增风格必须同时改 `shaders.wgsl`;前端 `STYLE_PRESETS` 提供几种风格由
/// TS 声明,两边取小作为有效上限 -- 前端多声明了不会被静默接受.
pub(crate) const SHADER_STYLE_COUNT: u32 = 3;

/// `material_views` 的前几项是城市图层(实现能力,不是配置).
///
/// 纹理绑定槽位由 `render_params.rs` 与 `shaders.wgsl` 一起固定,城市层数改不了
/// 而不动它们,所以这里只是"校验前端声明了几层":不一致直接报错.
pub(crate) const SHADER_CITY_LAYER_COUNT: u32 = 4;

/// 一层可上传的城市贴图(来自前端 `config.ts` 的 `UPLOAD_LAYERS`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LayerConfig {
    /// 材质槽位号(`material_views` 下标),必须等于它在清单里的位置.
    pub(crate) slot: u32,
    /// 槽位名:只用于报错与契约对照(真正定位用的是槽位号).
    pub(crate) name: String,
    /// 站点 `public/` 下的文件名(相对 `resource_base`).
    pub(crate) file: String,
    /// 原图 alpha 是否恒为不透明;是就不预乘(见 textures.rs 的 premultiply_alpha).
    pub(crate) opaque: bool,
}

/// 一个滑块的参数名与 clamp 区间(来自前端 `SLIDER_GROUPS`).
///
/// 区间是**前端说了算**:`setParam` 收到越界值时按这里的范围夹取.参数名 ->
/// `GlassParams` 字段的映射仍在 Rust(`app_params::write_param`),那是实现.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ParamRange {
    pub(crate) name: String,
    pub(crate) min: f32,
    pub(crate) max: f32,
}

/// 一次性启动配置(前端声明,Rust 消费).
#[derive(Debug)]
pub(crate) struct BootConfig {
    /// 初始风格编号(前端 `DEFAULT_STYLE_INDEX`).
    pub(crate) style_index: u32,
    /// 前端提供了几种风格(`STYLE_PRESETS.length`).
    pub(crate) style_count: u32,
    /// 城市贴图的公开路径前缀(相对站点根,不带结尾斜杠).
    pub(crate) resource_base: String,
    /// 前端允许的上传图片边长上限(策略值;与设备能力取小后才是有效上限).
    pub(crate) upload_max_dimension: u32,
    /// 城市图层清单,顺序即槽位号.
    pub(crate) layers: Vec<LayerConfig>,
    /// 滑块参数名与 clamp 区间.
    pub(crate) params: Vec<ParamRange>,
}

impl BootConfig {
    /// 从纯 Rust 值构造并校验(host 单测直接走这里;JS 边界见 [`BootConfig::from_js`]).
    pub(crate) fn new(
        style_index: u32,
        style_count: u32,
        resource_base: String,
        upload_max_dimension: u32,
        layers: Vec<LayerConfig>,
        params: Vec<ParamRange>,
    ) -> Result<Self, String> {
        let config = Self {
            style_index,
            style_count,
            // 去掉结尾斜杠,拼 URL 时不会出现 `//`.
            resource_base: resource_base.trim_end_matches('/').to_string(),
            upload_max_dimension,
            layers,
            params,
        };
        config.validate()?;
        Ok(config)
    }

    /// 启动配置校验:错误在这里一次性报出来,而不是留到渲染时静默错配.
    fn validate(&self) -> Result<(), String> {
        if self.style_count == 0 {
            return Err("启动配置 styleCount 至少为 1".to_string());
        }
        if self.resource_base.is_empty() {
            return Err("启动配置 resourceBase 不能为空".to_string());
        }
        if self.upload_max_dimension == 0 {
            return Err("启动配置 uploadMaxDimension 至少为 1".to_string());
        }

        if self.layers.len() != SHADER_CITY_LAYER_COUNT as usize {
            return Err(format!(
                "启动配置 layers 有 {} 层,但着色器/管线实现了 {SHADER_CITY_LAYER_COUNT} 层城市贴图;改层数要同时改 shaders.wgsl 与 pipelines.rs",
                self.layers.len()
            ));
        }
        for (index, layer) in self.layers.iter().enumerate() {
            if layer.slot != index as u32 {
                return Err(format!(
                    "启动配置 layers[{index}] 的 slot 是 {},槽位号必须等于它在清单里的位置",
                    layer.slot
                ));
            }
            if layer.name.is_empty() || layer.file.is_empty() {
                return Err(format!("启动配置 layers[{index}] 的 name / file 不能为空"));
            }
            if self.layers[..index]
                .iter()
                .any(|other| other.name == layer.name)
            {
                return Err(format!("启动配置里图层名重复: {}", layer.name));
            }
        }

        if self.params.is_empty() {
            return Err("启动配置 params 不能为空".to_string());
        }
        for (index, param) in self.params.iter().enumerate() {
            if self.params[..index]
                .iter()
                .any(|other| other.name == param.name)
            {
                return Err(format!("启动配置里滑块参数名重复: {}", param.name));
            }
            if !param.min.is_finite() || !param.max.is_finite() || param.min > param.max {
                return Err(format!(
                    "启动配置里滑块区间非法: {}({},{})",
                    param.name, param.min, param.max
                ));
            }
            // 名字是跨语言契约里唯一"躲不掉"的一部分:Rust 必须有
            // "名字 -> GlassParams 字段"的分发,前端传了分发不了的名字时,
            // 与其静默不生效,不如启动就报错.
            if !is_known_param(&param.name) {
                return Err(format!(
                    "前端声明的滑块参数 {} 在 Rust 侧没有对应的 GlassParams 字段",
                    param.name
                ));
            }
        }
        Ok(())
    }

    /// 有效风格上限:前端提供了几种,着色器实现了几个,取小.
    pub(crate) fn max_style_index(&self) -> u32 {
        self.style_count
            .saturating_sub(1)
            .min(SHADER_STYLE_COUNT.saturating_sub(1))
    }

    /// 把风格编号夹进有效范围.
    pub(crate) fn clamp_style(&self, style: u32) -> u32 {
        style.min(self.max_style_index())
    }

    /// 按槽位号找图层声明.
    pub(crate) fn layer(&self, slot: u32) -> Option<&LayerConfig> {
        self.layers.iter().find(|layer| layer.slot == slot)
    }

    /// 按名字找 clamp 区间.
    pub(crate) fn param_range(&self, name: &str) -> Option<(f32, f32)> {
        self.params
            .iter()
            .find(|param| param.name == name)
            .map(|param| (param.min, param.max))
    }

    /// 有效上传边长上限:前端的策略值与设备真实能力取小.
    ///
    /// 设备能力(`device.limits().max_texture_dimension_2d`)是硬件事实,
    /// 不是谁能配置的值,所以它留在这里,不从前端传.
    pub(crate) fn effective_upload_max(&self, device_max: u32) -> u32 {
        self.upload_max_dimension.min(device_max)
    }

    /// 拼出某张城市贴图的公开地址.
    pub(crate) fn texture_url(&self, file: &str) -> String {
        format!("{}/{file}", self.resource_base)
    }

    /// 解析前端传来的配置对象(唯一的 JS 边界,host 单测不覆盖这一层).
    pub(crate) fn from_js(config: &JsValue) -> Result<Self, String> {
        if !config.is_object() {
            return Err("startApp 的 config 必须是一个对象".to_string());
        }

        let layers = get_array(config, "layers")?
            .iter()
            .enumerate()
            .map(|(index, item)| LayerConfig::from_js(&item, index))
            .collect::<Result<Vec<_>, String>>()?;

        let params = get_array(config, "params")?
            .iter()
            .enumerate()
            .map(|(index, item)| ParamRange::from_js(&item, index))
            .collect::<Result<Vec<_>, String>>()?;

        Self::new(
            get_u32(config, "styleIndex")?,
            get_u32(config, "styleCount")?,
            get_string(config, "resourceBase")?,
            get_u32(config, "uploadMaxDimension")?,
            layers,
            params,
        )
    }
}

impl LayerConfig {
    fn from_js(value: &JsValue, index: usize) -> Result<Self, String> {
        if !value.is_object() {
            return Err(format!("启动配置 layers[{index}] 必须是对象"));
        }
        Ok(Self {
            slot: get_u32(value, "slot")?,
            name: get_string(value, "name")?,
            file: get_string(value, "file")?,
            opaque: get_bool(value, "opaque")?,
        })
    }
}

impl ParamRange {
    fn from_js(value: &JsValue, index: usize) -> Result<Self, String> {
        if !value.is_object() {
            return Err(format!("启动配置 params[{index}] 必须是对象"));
        }
        Ok(Self {
            name: get_string(value, "name")?,
            min: get_f32(value, "min")?,
            max: get_f32(value, "max")?,
        })
    }
}

// ---------- JsValue 取值小工具 ----------
//
// 都是"缺字段 / 类型不对就说清楚是哪个字段":配置是前端写的,报错必须能直接定位.

fn get_field(object: &JsValue, key: &str) -> Result<JsValue, String> {
    let value = Reflect::get(object, &JsValue::from_str(key))
        .map_err(|_| format!("读取字段 {key} 失败"))?;
    if value.is_undefined() || value.is_null() {
        return Err(format!("启动配置缺少字段 {key}"));
    }
    Ok(value)
}

fn get_string(object: &JsValue, key: &str) -> Result<String, String> {
    get_field(object, key)?
        .as_string()
        .ok_or_else(|| format!("启动配置的 {key} 必须是字符串"))
}

fn get_bool(object: &JsValue, key: &str) -> Result<bool, String> {
    get_field(object, key)?
        .as_bool()
        .ok_or_else(|| format!("启动配置的 {key} 必须是布尔值"))
}

fn get_u32(object: &JsValue, key: &str) -> Result<u32, String> {
    let raw = get_field(object, key)?
        .as_f64()
        .ok_or_else(|| format!("启动配置的 {key} 必须是数字"))?;
    if !raw.is_finite() || raw < 0.0 || raw.fract() != 0.0 || raw > u32::MAX as f64 {
        return Err(format!(
            "启动配置的 {key} 必须是 0..={} 的整数,实际 {raw}",
            u32::MAX
        ));
    }
    Ok(raw as u32)
}

fn get_f32(object: &JsValue, key: &str) -> Result<f32, String> {
    let raw = get_field(object, key)?
        .as_f64()
        .ok_or_else(|| format!("启动配置的 {key} 必须是数字"))?;
    if !raw.is_finite() {
        return Err(format!("启动配置的 {key} 必须是有限数字,实际 {raw}"));
    }
    Ok(raw as f32)
}

fn get_array(object: &JsValue, key: &str) -> Result<Array, String> {
    let value = get_field(object, key)?;
    if !Array::is_array(&value) {
        return Err(format!("启动配置的 {key} 必须是数组"));
    }
    Ok(Array::from(&value))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 典型的合法配置(数值对齐前端 config.ts,但这里只当测试数据用).
    fn layers() -> Vec<LayerConfig> {
        vec![
            layer(0, "level_3", "level_3.png", true),
            layer(1, "level_2", "level_2.png", false),
            layer(2, "level_1", "level_1.png", false),
            layer(3, "level_0", "level_0.png", false),
        ]
    }

    fn layer(slot: u32, name: &str, file: &str, opaque: bool) -> LayerConfig {
        LayerConfig {
            slot,
            name: name.to_string(),
            file: file.to_string(),
            opaque,
        }
    }

    fn params() -> Vec<ParamRange> {
        vec![
            range("vehicle_speed", 0.0, 3.0),
            range("interior_opacity", 0.0, 1.0),
        ]
    }

    fn range(name: &str, min: f32, max: f32) -> ParamRange {
        ParamRange {
            name: name.to_string(),
            min,
            max,
        }
    }

    fn config(style_index: u32, style_count: u32) -> Result<BootConfig, String> {
        BootConfig::new(
            style_index,
            style_count,
            "/metro_window/resource/".to_string(),
            8192,
            layers(),
            params(),
        )
    }

    #[test]
    fn accepts_well_formed_config() {
        let boot = config(1, 3).expect("合法配置必须通过");
        // 结尾斜杠被去掉,拼出来的 URL 不会出现 `//`.
        assert_eq!(boot.resource_base, "/metro_window/resource");
        assert_eq!(
            boot.texture_url("level_0.png"),
            "/metro_window/resource/level_0.png"
        );
        assert_eq!(boot.max_style_index(), 2);
        assert_eq!(boot.clamp_style(1), 1);
        assert_eq!(boot.param_range("vehicle_speed"), Some((0.0, 3.0)));
        assert_eq!(boot.param_range("nope"), None);
        assert!(boot.layer(3).is_some());
        assert!(boot.layer(4).is_none());
    }

    #[test]
    fn style_index_is_clamped_to_both_limits() {
        // 前端提供的风格数比着色器实现的少:按前端来.
        assert_eq!(config(9, 2).unwrap().max_style_index(), 1);
        // 前端提供得比着色器多:不能静默接受着色器没有的分支.
        assert_eq!(config(9, 99).unwrap().max_style_index(), 2);
        assert_eq!(config(9, 3).unwrap().clamp_style(9), 2);
    }

    #[test]
    fn effective_upload_max_takes_the_smaller_one() {
        let boot = config(0, 3).unwrap();
        assert_eq!(boot.effective_upload_max(16384), 8192);
        // 设备能力低于前端策略值时以设备为准.
        assert_eq!(boot.effective_upload_max(4096), 4096);
    }

    #[test]
    fn rejects_layer_count_that_shader_cannot_render() {
        let error = BootConfig::new(
            0,
            3,
            "/r".to_string(),
            8192,
            vec![layer(0, "a", "a.png", true)],
            params(),
        )
        .expect_err("层数与着色器不一致必须报错");
        assert!(error.contains("着色器/管线"), "报错文案不对: {error}");
    }

    #[test]
    fn rejects_out_of_order_or_duplicate_layers() {
        let mut out_of_order = layers();
        out_of_order.swap(0, 1);
        let error = BootConfig::new(0, 3, "/r".to_string(), 8192, out_of_order, params())
            .expect_err("槽位号与位置不一致必须报错");
        assert!(error.contains("slot"), "报错文案不对: {error}");

        let mut duplicate = layers();
        duplicate[1].name = duplicate[0].name.clone();
        let error = BootConfig::new(0, 3, "/r".to_string(), 8192, duplicate, params())
            .expect_err("重名必须报错");
        assert!(error.contains("重复"), "报错文案不对: {error}");
    }

    #[test]
    fn rejects_bad_ranges_and_unknown_param_names() {
        for bad in [
            range("vehicle_speed", 2.0, 1.0),
            range("vehicle_speed", 0.0, f32::NAN),
        ] {
            let error = BootConfig::new(0, 3, "/r".to_string(), 8192, layers(), vec![bad.clone()])
                .expect_err("非法区间必须报错");
            assert!(error.contains("区间非法"), "报错文案不对: {error}");
        }

        // 前端写了 Rust 分发不了的名字:启动即报错,而不是"拖了没反应".
        let error = BootConfig::new(
            0,
            3,
            "/r".to_string(),
            8192,
            layers(),
            vec![range("vehicle_speeed", 0.0, 3.0)],
        )
        .expect_err("未知参数名必须报错");
        assert!(error.contains("没有对应的 GlassParams 字段"), "{error}");
    }

    #[test]
    fn rejects_empty_or_zero_valued_config() {
        assert!(
            BootConfig::new(0, 0, "/r".to_string(), 8192, layers(), params())
                .unwrap_err()
                .contains("styleCount")
        );
        assert!(
            BootConfig::new(0, 3, String::new(), 8192, layers(), params())
                .unwrap_err()
                .contains("resourceBase")
        );
        assert!(
            BootConfig::new(0, 3, "/r".to_string(), 0, layers(), params())
                .unwrap_err()
                .contains("uploadMaxDimension")
        );
        assert!(
            BootConfig::new(0, 3, "/r".to_string(), 8192, layers(), Vec::new())
                .unwrap_err()
                .contains("params")
        );
    }
}
