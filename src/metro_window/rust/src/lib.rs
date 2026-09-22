/*
crate 入口(WASM 绑定层)
- 导出 startApp / setStyle / setRunning / resize / setParam / reset /
  setLayerImage / resetLayerImage 给前端 JavaScript 调用
- 持有全局 App 实例,通过 requestAnimationFrame 驱动渲染主循环
*/
mod app;
mod app_params;
mod boot_config;
mod glass_params;
mod pipelines;
mod random;
mod random_params;
mod render_params;
mod texture_params;
mod textures;
mod uniforms;

// 对外暴露的 API 全部服务于原生示例(examples/):
//   - validate_wgsl 要 shader_source():与管线编译时**逐字一致**的完整 WGSL
//     源码(含 Rust 生成的 GlassParams 声明);
//   - preview 要下面这一组:它自己搭一遍设备 / 纹理 / 管线,离线渲染一帧.
pub use app_params::write_param;
pub use glass_params::GlassParams;
pub use pipelines::{create_metro_pipelines, shader_source, MetroTextures};
pub use render_params::{
    FULLSCREEN_QUAD_INDICES, FULLSCREEN_QUAD_VERTICES, MIN_TEXTURE_DIMENSION, QUAD_INDEX_FORMAT,
    RENDER_TARGET_FORMAT, RGBA_BYTES_PER_PIXEL, SAMPLER_ADDRESS_MODE_CLAMP,
    SAMPLER_ADDRESS_MODE_REPEAT, SAMPLER_FILTER_MODE,
};
pub use texture_params::{DIRT_TEXTURE_SIZE, FOG_TEXTURE_SIZE, INTERIOR_TEXTURE_SIZE};
pub use textures::{create_texture, decode_png, generate_dirt, generate_fog, generate_interior};
pub use uniforms::Uniforms;

/// 生成物的落点:本 crate 根下的 `test_output/`,**绝对路径**.
///
/// 这个目录只在这里定义一次,因为有两类产物都落在它下面,而它们原先各自按 cwd
/// 找地方:`cargo test` 的可视化 PPM 基准图(见 `textures::write_ppm`)与
/// `cargo run --example preview` 的 `preview.png`.`cargo test` 的 cwd 恰好是
/// crate 根,但 `cargo run` 的 cwd 是**你敲命令的那个目录** -- 同一份产物会按调用
/// 位置落到不同地方(以前 preview.png 就落在仓库根,还得为它单开一条 .gitignore).
/// 按 `CARGO_MANIFEST_DIR` 算成绝对路径之后,从哪跑都落在同一个目录.
///
/// 该目录已在仓库根 .gitignore 里,不往仓库里丢生成物.
pub fn test_output_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test_output")
}

use std::cell::RefCell;
use std::rc::Rc;

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{console, window, HtmlCanvasElement, HtmlElement};

use crate::app::App;
use crate::boot_config::BootConfig;

thread_local! {
    static APP: RefCell<Option<App>> = const { RefCell::new(None) };
}

/// 只校验一份启动配置是否合法,不初始化渲染器.
///
/// 为什么单独开一个导出:配置是**跨语言契约**(字段名,层数,参数名),而
/// `startApp` 之后马上要设备 / GPU,CI 与无 GPU 环境根本走不到校验那一步.
/// 有了它,前端可以在真正启动前自查,测试也能用真实 wasm 验证"TS 写的字段名
/// 与 Rust 读的一致" -- 这类漂移不报错时表现为"启动卡住/画面不对",最难查.
#[wasm_bindgen(js_name = validateConfig)]
pub fn validate_config(config: JsValue) -> Result<(), JsValue> {
    BootConfig::from_js(&config)
        .map(|_| ())
        .map_err(JsValue::from)
}

/// 启动应用:建好渲染器并开始每帧渲染.
///
/// - `canvas` / `status`:画布与状态文案元素;
/// - `config`:**前端声明的全部可配置值**(风格 / 图层清单 / 资源路径 / 上传上限 /
///   滑块区间),由 `src/metro_window/src/config.ts` 的 `RUNTIME_CONFIG` 生成.
///   缺字段,类型不对,层数与着色器不一致,滑块名 Rust 分发不了 -- 都在这里
///   一次性报错,而不是留到渲染时静默错配(见 boot_config.rs 的模块说明).
#[wasm_bindgen(js_name = startApp)]
pub async fn start_app(
    canvas: HtmlCanvasElement,
    status: HtmlElement,
    config: JsValue,
) -> Result<(), JsValue> {
    console::log_1(&"metro-window: starting".into());
    let boot = BootConfig::from_js(&config).map_err(JsValue::from)?;
    let app = App::new(canvas, status, boot)
        .await
        .map_err(|e| JsValue::from_str(&e))?;
    APP.with(|cell| {
        *cell.borrow_mut() = Some(app);
    });
    start_animation();
    Ok(())
}

#[wasm_bindgen(js_name = setStyle)]
pub fn set_style(style: u32) {
    with_app(|app| {
        // 有效风格上限来自启动配置(前端风格数 与 着色器分支数 取小).
        app.set_style(style);
    });
}

#[wasm_bindgen(js_name = setRunning)]
pub fn set_running(running: bool) {
    with_app(|app| {
        app.running = running;
    });
}

/// 画布后备缓冲尺寸变化.
///
/// 站点先改 `<canvas>` 的 `width`/`height` 属性,再调用这里 --
/// 前端按"覆盖宿主所需的 16:9 尺寸"算宽高(见 `src/stage_size.ts`),
/// 所以画布比例恒为 16:9,美术素材的 uv 铺满方式始终对得上.
/// `App` 还没建好时是空操作(`with_app` 的约定):那种情况下
/// `startApp` 会直接读画布的当前尺寸建资源,不需要额外补一次.
#[wasm_bindgen(js_name = resize)]
pub fn resize(width: u32, height: u32) {
    with_app(|app| {
        app.resize(width, height);
    });
}

#[wasm_bindgen(js_name = setParam)]
pub fn set_param(name: &str, value: f32) {
    with_app(|app| {
        // 参数名与 clamp 区间都来自前端声明(`config.ts` 的 `SLIDER_GROUPS`):
        // 名字 -> GlassParams 字段的分发在 Rust,夹取用前端给的区间.
        // 没命中说明两边名字漂移了 -- 启动时的 config 校验已经挡过一次,
        // 这里再警告一次是给"运行中改了名字"这种开发场景留的提示.
        if !app.set_param(name, value) {
            console::warn_1(&format!("未知滑块参数: {name}").into());
        }
    });
}

/// 动画时钟归零(前端"重置"按钮).
#[wasm_bindgen(js_name = reset)]
pub fn reset() {
    with_app(|app| {
        app.reset();
    });
}

/// 用前端上传的图片像素替换某个材质槽位的贴图.
///
/// - `layer`:材质槽位号,当前只放开城市背景四层(见 app_params::UPLOADABLE_LAYERS);
/// - `rgba` :已经解码好的 RGBA8 像素,长度必须恰好 `width * height * 4`.
///
/// 解码放在前端做(createImageBitmap + canvas):浏览器本来就支持 PNG/JPEG/WebP,
/// 而 Rust 侧只有 png crate,再养一套解码器纯属重复.这样也意味着**没有后端**:
/// 文件不上传服务器,只在浏览器内存里转成像素.
///
/// 失败(槽位越界 / 尺寸非法 / 像素长度不匹配 / wasm 还没初始化好)返回 `Err`,
/// 由前端显示在该层的状态行上 -- 上传是用户动作,静默失败等于"点了没反应".
#[wasm_bindgen(js_name = setLayerImage)]
pub fn set_layer_image(layer: u32, width: u32, height: u32, rgba: &[u8]) -> Result<(), JsValue> {
    with_app_result(|app| app.set_layer_texture(layer, width, height, rgba))
}

/// 把某个材质槽位恢复成站点自带的默认贴图(用留在 App 里的那份原图,不重新 fetch).
#[wasm_bindgen(js_name = resetLayerImage)]
pub fn reset_layer_image(layer: u32) -> Result<(), JsValue> {
    with_app_result(|app| app.reset_layer_texture(layer))
}

fn with_app<F: FnOnce(&mut App)>(f: F) {
    APP.with(|cell| {
        if let Some(app) = cell.borrow_mut().as_mut() {
            f(app);
        }
    });
}

/// 与 `with_app` 的区别:"App 还没建好"在这里是**错误**,而不是空操作.
///
/// 给上传这类用户主动触发的操作使用:初始化失败或还没跑完时,前端要把
/// "暂时不可用"显示出来,而不是让用户看着点了没反应.
fn with_app_result<F: FnOnce(&mut App) -> Result<(), String>>(f: F) -> Result<(), JsValue> {
    APP.with(|cell| match cell.borrow_mut().as_mut() {
        Some(app) => f(app).map_err(|e| JsValue::from_str(&e)),
        None => Err(JsValue::from_str("车窗尚未初始化完成,贴图替换暂时不可用")),
    })
}

pub(crate) fn performance_now() -> f64 {
    window()
        .and_then(|w| w.performance())
        .map(|p| p.now())
        .unwrap_or(0.0)
}

/// requestAnimationFrame 回调的持有者.
/// Closure 必须活到页面结束,否则回调被回收;类型复杂,单独起别名避免各处重复书写.
type RafClosure = Rc<RefCell<Option<Closure<dyn FnMut()>>>>;

fn start_animation() {
    let win = window().expect("window");
    let win2 = win.clone();
    let holder: RafClosure = Rc::new(RefCell::new(None));
    let holder2 = holder.clone();
    let closure = Closure::wrap(Box::new(move || {
        APP.with(|cell| {
            if let Some(app) = cell.borrow_mut().as_mut() {
                app.frame();
            }
        });
        let h = holder2.borrow();
        if let Some(cb) = h.as_ref() {
            let f = cb.as_ref().unchecked_ref::<js_sys::Function>();
            let _ = win2.request_animation_frame(f);
        }
    }) as Box<dyn FnMut()>);

    *holder.borrow_mut() = Some(closure);
    if let Some(cb) = holder.borrow().as_ref() {
        let f = cb.as_ref().unchecked_ref::<js_sys::Function>();
        if let Err(e) = win.request_animation_frame(f) {
            console::error_1(&e);
        }
    }
    std::mem::forget(holder);
}
