/*
WGSL 校验工具
- 用 naga 解析并校验完整着色器源码
- 源码 = Rust 生成的 struct DropletParams 声明 + src/shaders.wgsl,
  与管线编译时使用的源码完全一致
*/
fn main() {
    let code = metro_window::shader_source();
    let module = naga::front::wgsl::parse_str(&code)
        .map_err(|e| format!("WGSL 语法错误:\n{e:?}"))
        .unwrap();
    let mut validator = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::all(),
    );
    validator
        .validate(&module)
        .map_err(|e| format!("WGSL 校验错误:\n{e:?}"))
        .unwrap();
    println!("WGSL 校验通过");
}
