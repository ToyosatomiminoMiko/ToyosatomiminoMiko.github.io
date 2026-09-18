/*
crate 入口(WASM 绑定层)
- 导出 startApp / setStyle / setRunning / reset 给前端 JavaScript 调用
- 持有全局 App 实例,通过 requestAnimationFrame 驱动渲染主循环
*/
mod app;
mod droplet_params;
mod droplets;
mod pipelines;
mod random;
mod textures;
mod uniforms;

pub use droplet_params::DropletParams;
pub use droplets::{make_droplets, Droplet, DROPLET_COUNT};
pub use pipelines::{create_metro_pipelines, shader_source, MetroPipelines, MetroTextures};
pub use textures::{create_texture, decode_png, generate_dirt, generate_fog, generate_interior};
pub use uniforms::Uniforms;

use std::cell::RefCell;
use std::rc::Rc;

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{console, window, HtmlCanvasElement, HtmlElement};

use crate::app::App;

// 渲染帧率上限:60fps.
// 防止在无垂直同步/高刷新率环境下无意义地跑满 CPU 和 GPU.
pub(crate) const FRAME_INTERVAL_MS: f64 = 1000.0 / 60.0;

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
        app.style = style.min(2);
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
        let p = &mut app.droplet_params;
        match name {
            // 车速 / 背景层距离
            "vehicle_speed" => p.vehicle_speed = value.clamp(0.0, 5.0),
            "far_distance" => p.far_distance = value.clamp(0.1, 3.0),
            "mid_distance" => p.mid_distance = value.clamp(0.1, 3.0),
            "near_distance" => p.near_distance = value.clamp(0.1, 3.0),
            // 水滴外观 / 物理
            "droplet_size" => p.droplet_size = value.clamp(0.1, 3.0),
            "wind_backward_factor" => p.wind_backward_factor = value.clamp(0.0, 1.0),
            "wind_sway_scale" => p.wind_sway_scale = value.clamp(0.0, 3.0),
            "gravity_scale" => p.gravity_scale = value.clamp(0.0, 3.0),
            "refraction_scale" => p.refraction_scale = value.clamp(0.0, 3.0),
            // 玻璃材质浓度
            "dirt_opacity" => p.dirt_opacity = value.clamp(0.0, 1.0),
            "fog_opacity" => p.fog_opacity = value.clamp(0.0, 1.0),
            "interior_opacity" => p.interior_opacity = value.clamp(0.0, 1.0),
            _ => console::warn_1(&format!("未知滑块参数: {name}").into()),
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
