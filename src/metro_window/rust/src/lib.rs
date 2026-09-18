/*
crate 入口(WASM 绑定层)
- 导出 startApp / setStyle / setRunning / reset 给前端 JavaScript 调用
- 持有全局 App 实例,通过 requestAnimationFrame 驱动渲染主循环
*/
mod app;
mod app_params;
mod droplet_params;
mod droplets;
mod pipelines;
mod random;
mod random_params;
mod render_params;
mod texture_params;
mod textures;
mod uniforms;

pub use droplet_params::DropletParams;
pub use droplets::{make_droplets, Droplet, DROPLET_COUNT};
pub use pipelines::{create_metro_pipelines, shader_source, MetroPipelines, MetroTextures};
// 下面几组常量同时被 examples/ 使用:导出同一份定义,避免示例与运行时数值漂移.
pub use render_params::{
    FULLSCREEN_QUAD_INDICES, FULLSCREEN_QUAD_VERTICES, MIN_TEXTURE_DIMENSION, QUAD_INDEX_FORMAT,
    REFRACTION_TEXTURE_FORMAT, REFRACTION_WORKGROUP_EDGE, RENDER_TARGET_FORMAT,
    RGBA_BYTES_PER_PIXEL, SAMPLER_ADDRESS_MODE_CLAMP, SAMPLER_ADDRESS_MODE_REPEAT,
    SAMPLER_FILTER_MODE,
};
pub use texture_params::{DIRT_TEXTURE_SIZE, FOG_TEXTURE_SIZE, INTERIOR_TEXTURE_SIZE};
pub use textures::{create_texture, decode_png, generate_dirt, generate_fog, generate_interior};
pub use uniforms::Uniforms;

use std::cell::RefCell;
use std::rc::Rc;

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{console, window, HtmlCanvasElement, HtmlElement};

use crate::app::App;

thread_local! {
    static APP: RefCell<Option<App>> = const { RefCell::new(None) };
}

#[wasm_bindgen(js_name = startApp)]
pub async fn start_app(canvas: HtmlCanvasElement, status: HtmlElement) -> Result<(), JsValue> {
    console::log_1(&"metro-window: starting".into());
    let app = App::new(canvas, status)
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
        app.style = style.min(app_params::MAX_STYLE_INDEX);
    });
}

#[wasm_bindgen(js_name = setRunning)]
pub fn set_running(running: bool) {
    with_app(|app| {
        app.running = running;
    });
}

#[wasm_bindgen(js_name = setParam)]
pub fn set_param(name: &str, value: f32) {
    with_app(|app| {
        // 参数名与 clamp 上下限统一由 src/app_params.rs 的 SLIDERS 配置表维护:
        // 表里的 name 就是前端 setParam(name, value) 传的字面值(不可改动),
        // apply 负责夹到合法区间后写入对应的 DropletParams 字段.
        match app_params::slider_spec(name) {
            Some(spec) => spec.apply(&mut app.droplet_params, value),
            None => console::warn_1(&format!("未知滑块参数: {name}").into()),
        }
    });
}

#[wasm_bindgen(js_name = reset)]
pub fn reset() {
    with_app(|app| {
        app.time = 0.0;
        let droplets = make_droplets(&app.droplet_params);
        app.queue
            .write_buffer(&app.droplet_buffer, 0, bytemuck::cast_slice(&droplets));
    });
}

fn with_app<F: FnOnce(&mut App)>(f: F) {
    APP.with(|cell| {
        if let Some(app) = cell.borrow_mut().as_mut() {
            f(app);
        }
    });
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
