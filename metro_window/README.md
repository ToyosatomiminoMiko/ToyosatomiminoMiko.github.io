# 地铁车窗 · Rust + WASM + WebGPU

> **本目录已并入站点仓库** `ToyosatomiminoMiko.github.io`,不再是独立项目.
> 上游仓库 `ToyosatomiminoMiko/metro_window` 已归档(只读),本地 clone 已删除 --
> 本目录现在是唯一的可写副本;迁移范围,改了什么,为什么这么改,
> 见文末[「迁移与归档」](#迁移与归档).

用 Rust 编写/编译为 WebAssembly,再通过 wgpu(浏览器原生 WebGPU 后端)实现的
地铁车窗玻璃效果.原有 JavaScript 实现已由 Rust 重写,所有绘制/水滴物理和
纹理生成都运行在 Rust + WGSL 中.

## 在站点里的位置

| | |
| --- | --- |
| 独立入口页 | `metro_window/index.html`(标记也在这一页)-> 线上 `/metro_window/` |
| 站点欢迎页 | **待定**:视觉设计未定,先把架构做完(见"组件形态") |
| 组件行为 | `web/src/metro_window.ts`,导出 `mountMetroWindow(root: HTMLElement)` |
| 运行时贴图 | `/metro_window/resource/*.png` |

### 组件形态

前端做成了"挂载函数"而不是页面入口,标记留在页面里,宿主只负责把它交上来:

```ts
import { mountMetroWindow } from '../metro_window/web/src/metro-window';

const host = document.getElementById('metro-window');
if (host) mountMetroWindow(host);
```

- **标记在页面里**(`index.html` 的 `#metro-window`),`metro_window.ts` 只做行为,
  `metro_window.css` 只做组件样式,`page.css`(只有独立页引)只做页面级样式,
  `page.ts` 只做挂载.容器必须带 `.metro-window` 类名,组件按 id 查元素且只在容器内解析.
- 组件样式与页面样式**分开**:`body { margin: 0 }` 这种只能进 `page.css` --
  放进 `metro_window.css` 就等于让组件去改宿主页面的 body.
- 样式**全部**以 `.metro-window` 作用域开头.站点首页引了 bootstrap,还有一条
  `* { margin:0; padding:0; border:0; background:none }` 的通配重置,
  原来那份独立页写法里的 `body` / `canvas` / `button` 裸元素选择器一旦进站,
  会把 OLED 的 `#pixelCanvas`,RBT 的 `#rbCanvas` 一起改样.
- **单实例**:wasm 侧的 `App` 是 crate 内的 `thread_local` 单例,
  `setStyle` / `setParam` / `setRunning` / `reset` 全都作用于它,
  所以一个页面只应挂载一次.

### 渲染生命周期

`requestAnimationFrame` 不会因为容器被 `display:none` 就停下来.车窗是常驻的
计算着色器负载,如果不管,切走标签页以后 GPU 会一直空转.所以组件把
**「用户想不想跑」(▶/⏸)和「现在能不能看见」分开记**,实际渲染 = 两者相与:

- `IntersectionObserver` 盯容器(标签页切走时交集为空);
- `visibilitychange` 盯整个文档(浏览器最小化/切到后台标签);
- 两者都只影响"能不能跑",不会覆盖用户自己按下的暂停.

## 架构

```text
metro_window/
├── src/             Rust 渲染核心(编译为 wasm32-unknown-unknown)
│   ├── lib.rs           入口:wasm 导出/动画循环/线程局部状态
│   ├── app.rs           App 状态机/帧循环/WebGPU 设备/表面
│   ├── pipelines.rs     渲染/计算管线与绑定组
│   ├── textures.rs      纹理加载/PNG 解码/程序化材质生成
│   ├── droplet_params.rs 水滴全部可调参数(Rust/WGSL 共享,WGSL 声明由 Rust 生成)
│   ├── droplets.rs      水滴结构与初始化
│   ├── uniforms.rs      uniform 布局
│   ├── random.rs        哈希噪声工具
│   └── shaders.wgsl     WGSL 着色器
├── examples/        本地验证与预览程序
├── scripts/
│   └── build_wasm.sh    Rust -> wasm 的构建脚本(由仓库根的 npm 脚本调用)
├── index.html       页面:车窗的全部标记 + 一个入口脚本
├── public/          运行时贴图,按 /metro_window/resource/ 公开
│   └── resource/    城市纹理 PNG(Rust 在运行时按 URL fetch)
├── web/             前端源码
│   ├── src/             行为与样式
│   │   ├── metro_window.ts  挂载函数:交互/WebGPU 适配器检查/生命周期
│   │   ├── metro_window.css  组件样式(全部以 .metro-window 作用域)
│   │   ├── page.css          页面级样式(只有去 body 外边距)
│   │   └── page.ts           入口脚本(引 page.css + 调用挂载函数)
│   ├── design/          设计源文件(.kra),不参与构建
│   └── pkg/             生成:wasm-bindgen 输出(gitignore)
├── Cargo.toml       Rust 依赖
└── Cargo.lock       Rust 依赖锁定
```

**这个目录里没有 `package.json` / `vite.config.ts` / `tsconfig.json` / `build.sh`.**
并进站点后,这些"独立仓库的边界文件"由站点统一接管(Vite 配置在仓库根,
构建步骤序列在根 `package.json` 的 `build:all`),子项目只保留一个
`scripts/build_wasm.sh`,因为它要做 npm 脚本做不到的事(探测 wasm32 target,
按 `Cargo.lock` 对齐 wasm-bindgen CLI 版本).这样"构建步骤只有一处事实源"
这条约定仍然成立.

生成物(`target/` / `web/pkg/` / `.cargo-tools/`)均已在仓库根 `.gitignore` 排除;
前端源码(`web/src/`)与生成产物(`web/pkg/`)严格分离,不手工维护生成文件.

> 说明:更早的架构用 `tsc` 直接编译出 `web/main.js`,再用 Python 静态服务器
> 托管整个目录;后来改为 Vite:TypeScript/CSS/HTML 由 Vite 统一处理,
> `web/pkg/` 中的 wasm-bindgen 产物也由 Vite 打包并重写 wasm 资源地址.

## 构建

构建入口在**仓库根**,不在本目录:

```bash
./build.sh          # 完整构建:检查工具链 -> npm ci -> 跑完整流水线
npm run build:all   # 跳过依赖安装,只跑流水线(CI 与本地完全一致的步骤序列)
npm run build:wasm  # 只重新编译 Rust->wasm(等价于 bash metro_window/scripts/build_wasm.sh)
```

流水线步骤定义在仓库根 `package.json` 的 `build:all`(单一事实源),顺序如下:

| 步骤 | 命令 | 说明 |
| --- | --- | --- |
| 1 | `npm run lint:rs` | `cargo fmt --check` + `cargo clippy --all-targets -- -D warnings` |
| 2 | `npm run clean` | 删除 `dist/` 与 `metro_window/web/pkg/`,避免改名后残留旧产物 |
| 3 | `npm run build:wasm` | `cargo build --release --target wasm32-unknown-unknown`,再用与 `Cargo.lock` 同版本的 wasm-bindgen 生成 `web/pkg/` |
| 4 | `npm test` | `vitest run`(站点侧单测) |
| 5 | `npm run test:rs` | `cargo test`(原生单元测试,wgpu 那部分不需要 GPU) |
| 6 | `npm run build:app` | `check:wasm` + `tsc -p tsconfig.json --noEmit` + `vite build` 输出 `dist/` |

工具链要求:`node` / `npm` / `cargo` / `rustc`,以及 `wasm32-unknown-unknown`
target(缺了构建脚本会 `rustup target add` 补装).`wasm-bindgen` CLI **不需要**
预先安装:版本与 `Cargo.lock` 不一致时,脚本会装到本目录的 `.cargo-tools/`.

CI 侧(`.github/workflows/deploy.yml`)只多两步:`dtolnay/rust-toolchain@stable`
装 Rust + wasm32 target + rustfmt/clippy,`Swatinem/rust-cache` 缓存
`metro_window/target` 与 `metro_window/.cargo-tools`.wasm 产物不入库.

## 运行

```bash
npm run dev        # 仓库根的 Vite 开发服务器,车窗在 http://127.0.0.1:5173/metro_window/
npm run preview    # 预览 dist/ 里的构建产物
```

缺 wasm 产物时 `npm run dev` 会先报错提示先跑 `npm run build:wasm`
(`scripts/check_wasm.mjs`),而不是让 Vite 抛一句 "Failed to resolve import".

> 开发时改动 `web/src/` 下的 TypeScript/CSS 会自动热更新;改动 Rust/WGSL
> 需要重新运行 `npm run build:wasm`(会重新生成 `web/pkg/`,Vite 会自动加载新产物).

[启用WebGPU](chrome://flags/#enable-unsafe-webgpu)

无沙盒模式启动浏览器

```sh
chromium-browser --no-sandbox --enable-unsafe-webgpu http://127.0.0.1:5173/metro_window/
# vscode 启用新实例参数无效
code --no-sandbox --enable-unsafe-webgpu 
```

> 如果页面报错"当前 WebGPU 适配器为 CPU 软件渲染",说明这个浏览器实例
> 访问不到独立显卡(正在用 llvmpipe/SwiftShader 在 CPU 上模拟).请在
> 系统浏览器(不要用沙箱/内置浏览器)打开页面,并到 chrome://gpu 确认
> WebGPU 走的是 NVIDIA/AMD 显卡.Fedora/Chromium 已知会因沙箱挡掉
> NVIDIA Vulkan 驱动而退回软件渲染:可用 Firefox,或以
> `chromium-browser --no-sandbox --enable-unsafe-webgpu` 启动(仅限本机
> 可信页面).不要启用 chrome://flags/#enable-vulkan,它可能导致黑屏.

## 实现内容

- Layer 0:窗外实景 -- 多层城市纹理按不同速度滚动
- Layer 1:窗外虚像 -- 计算着色器模拟 64 颗水滴的重力/风力物理,
  再按斯涅尔折射(空气/水 ≈ 1.0 / 1.333)把水滴当成球面水透镜,
  预计算低分辨率折射偏移图;片段着色器只采样一次,避免逐像素循环造成的卡顿
- Layer 2:玻璃杂质与污渍 -- Rust 程序化生成污渍/划痕/灰尘纹理
- Layer 3:窗内雾气 -- 程序化噪声纹理做冷凝水汽扩散,柔化并降低对比度
- Layer 4:窗内灯光与反射 -- 程序化生成车厢灯带与乘客倒影纹理
- 水滴参数:生成/重置/物理/折射/高光的全部可调值集中在 droplet_params.rs,
  WGSL 的 struct DropletParams 由 Rust 生成并注入,两边不会各自漂移
- 实时滑块:车速/三层背景距离/水滴大小/后吹风/摇摆风/下落速度/折射强度/
  污渍/雾气/车厢灯光均可拖动实时调整;水滴后吹风与背景滚动都由同一
  vehicle_speed 参数驱动(公式见 droplet_params.rs 与 shaders.wgsl 注释)
- 风格切换:uniform 传入 styleId,WGSL 片段着色器内实现
  泡沫时期东京电车/赛博朋克/上海磁悬浮三套调色与氛围

## 技术栈

- Rust(`wgpu`/`wasm-bindgen`/`png`/`bytemuck`)
- TypeScript(交互层)+ Vite(开发服务器/HMR/构建)
- WGSL 计算着色器 + 渲染管线
- wasm32-unknown-unknown / WebGPU

## 本地验证

```bash
cargo run --manifest-path metro_window/Cargo.toml --example validate_wgsl  # WGSL 语法/校验
cargo run --manifest-path metro_window/Cargo.toml --example native_smoke   # 用软件 Vulkan 实际跑一遍计算+渲染管线
cargo run --manifest-path metro_window/Cargo.toml --example preview        # 用真实城市纹理渲染一帧,输出 preview.png
```

> 程序里的相对路径都相对 **crate 根**(`cargo run`/`cargo test` 的 cwd 就是包根):
> `preview` 读 `public/resource/*.png`,写出的 `preview.png` 也落在 `metro_window/`
> 下(已被 .gitignore 忽略);`cargo test` 的可视化 ppm 落在 `metro_window/prompt/`.

## 迁移与归档

### 从哪来

- 上游仓库:<https://github.com/ToyosatomiminoMiko/metro_window>(**已归档,只读**)
- 迁移时的上游 `main`:**`36922c6`(样式调整)**
- 上游的本地 clone **已删除**:本目录是唯一的可写副本,只读副本在 GitHub 归档仓库里.

### 搬过来了什么(上游全部被跟踪文件)

`Cargo.toml` / `Cargo.lock`,`src/`(Rust + WGSL),`examples/`,
`public/resource/*.png`(4 张城市贴图),`web/`(前端源码 + 设计源文件),
`index.html`,`README.md`.归档前逐项核对过,没有遗漏;尤其是
`web/design/city_mid.png.kra`(1.5 MB,唯一的设计源文件).

上游 `.gitignore` 里的 `/prompt` 是本地草稿目录(未跟踪),不在归档范围内:
其中 `prompt/prompt.md` 记录了本项目的总体目标与演进过程,本地 clone 删除后
它就只剩别处的副本了.

### 搬进来改了什么

| 改动 | 为什么 |
| --- | --- |
| 删掉 `package.json` / `package-lock.json` / `vite.config.ts` / `tsconfig.json` / `build.sh` / `.gitignore` | 独立仓库的边界文件,由站点仓库统一接管;`scripts/build_wasm.sh` 保留了 npm 脚本做不到的那部分,`build:all` 步骤序列仍是单一事实源 |
| 前端入口 `main.ts` -> `metro_window.ts`(行为)+ `metro_window.css`(样式)+ `page.ts`(挂载) | 把行为做成"有标记就能挂"的模块,标记留在 `index.html` 里,不再单独养一个组件标记文件 |
| `style.css` 全部选择器加 `.metro-window` 作用域,自定义属性加 `--metro-` 前缀 | 站点有一条 `* { ... }` 通配重置和 bootstrap,原来 `body`/`canvas`/`button` 的裸元素选择器会污染站点的其它页面 |
| 新增渲染生命周期(IntersectionObserver + visibilitychange) | rAF 不会因为容器 `display:none` 而停,不禁的话切走标签页后 GPU 一直空转 |
| Rust 里贴图路径 `/resource/...` -> `/metro_window/resource/...`,集中成 `app.rs` 的 `RESOURCE_BASE` | 并进站点后资源挂在子路径下;地址是 Rust 里写死的,必须和产物里的真实路径一致 |
| 新增 `vite.config.ts` 的 `metroWindowAssets()` 插件 | 站点 Vite 只有一个 `publicDir`,子项目的 `public/` 不会被自动挂载;dev 重写,build 按原路径 emit,两边 URL 一致 |
| 删掉上游 `LICENSE`(GPL-3.0) | 站点是 **AGPL-3.0**;作者同为一人,合并后整体按站点许可走,保留一份子目录许可只会让人误以为这个子树单独授权 |
| 删掉上游 `prompt/` | 未跟踪的本地草稿,不属于仓库内容 |

### 归档状态与遗留

已经做完的:

1. 上游仓库在 GitHub 上**已归档**(只读),本地 clone 已删除.
2. 归档前逐项核对过"搬过来了什么",没有遗漏.
3. 站内没有任何指向 `github.com/.../metro_window` 的链接,不需要改指向.

还剩一件事要确认:

4. **上游 project 仓库的 GitHub Pages 是否开着**.`metro_window` 的 Pages 会占
   `toyosatomiminomiko.github.io/metro_window/`,而本站是 user Pages
   (`ToyosatomiminoMiko.github.io`),现在也在**同一个路径** `/metro_window/`
   提供内容 -- 两边都发布就是抢同一个路径.归档**不会**自动关 Pages,
   要单独去 Settings -> Pages 把 source 置成 None.
