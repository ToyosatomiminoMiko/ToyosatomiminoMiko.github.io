# 地铁车窗 · Rust + WASM + WebGPU

> **本子项目已并入站点仓库** `ToyosatomiminoMiko.github.io`,不再是独立项目,
> 源码整体位于 `src/metro_window/`(Rust 在 `rust/`,前端在 `web/`).
> 上游仓库 `ToyosatomiminoMiko/metro_window` 已归档(只读),本地 clone 已删除 --
> 本目录现在是唯一的可写副本;迁移范围,改了什么,为什么这么改,
> 见文末[「迁移与归档」](#迁移与归档).

用 Rust 编写/编译为 WebAssembly,再通过 wgpu(浏览器原生 WebGPU 后端)实现的
地铁车窗玻璃效果.原有 JavaScript 实现已由 Rust 重写,所有绘制/水滴物理和
纹理生成都运行在 Rust + WGSL 中.

## 在站点里的位置

| | |
| --- | --- |
| 站点位置 | 站点首页 `index.html` 的 HOME 卡片体:空宿主 `#metro-window`,挂载见 `src/main.ts`(已没有独立入口页) |
| Rust 源码 | `src/metro_window/rust/`(crate `metro-window`,编译为 wasm32-unknown-unknown) |
| 前端源码 | `src/metro_window/web/src/` |
| 组件行为 | `web/src/metro_window.ts`,导出 `mountMetroWindow(root: HTMLElement)` / `mountMetroWindowAtMountId()` |
| 运行时贴图 | 源码 `public/metro_window/resource/*.png`(站点 public),公开地址 `/metro_window/resource/*.png` |

### 组件形态

前端做成了"挂载函数"而不是页面入口:**宿主只提供一个空容器**,标记由组件生成:

```ts
import { mountMetroWindowAtMountId } from '@/metro_window/web/src/metro_window';

mountMetroWindowAtMountId();   // 找约定的挂载点 #metro-window,找不到就报错
```

- **宿主只提供空容器**:站点首页里只有一个 `<div id="metro-window">`,
  标题 / 副标题 / 画布由 `web/src/ui/window_content.ts` 按 `web/src/config.ts` 的
  文案与分辨率生成,设置面板(风格按钮 / 播放控制 / 滑块 / 状态区)由
  `web/src/ui/settings.ts` 按同一份模型生成,插在画布之后.宿主页不出现任何车窗
  标记,加一个滑块只需要往 `SLIDER_GROUPS` 里加一条,改文案只动 `config.ts`.
- **声明式组件**:`web/src/ui/dom.ts` 的 `h()` 是唯一的 DOM 构造原语(描述 -> 元素),
  `web/src/ui/window_content.ts`(车窗标记)与 `web/src/ui/settings.ts`(设置面板)
  都是纯函数,不读页面,不改全局;`metro_window.ts` 把标记插进宿主,拿到组件交回的
  元素引用后绑事件,不再按 id 去 DOM 里找.滑块布局只在 `createSlider()` 里定义
  一处:最外层 `div.slider`,上层滑杆,下层"名称(左) + 数值(右)".
- `metro_window.ts` 只做行为,`metro_window.css` 只做组件样式.
  `.metro-window` 类名由 `metro_window.ts` 挂上(宿主不用记这个约定),
  组件只在容器内解析元素.
- 组件样式里**没有**页面级选择器:`body { margin: 0 }` 这类规则的宿主是站点,
  由站点的 `public/css/index.css` 负责;写进 `metro_window.css` 就等于让组件去改
  宿主页面的 body.原先独立页用的 `metro_index.css` 随入口页一起删掉了.
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
src/metro_window/
├── rust/                   Rust 渲染核心(编译为 wasm32-unknown-unknown)
│   ├── Cargo.toml / Cargo.lock   Rust 依赖与锁定
│   ├── src/
│   │   ├── lib.rs           入口:wasm 导出/动画循环/线程局部状态
│   │   ├── app.rs           App 状态机/帧循环/WebGPU 设备/表面
│   │   ├── pipelines.rs     渲染/计算管线与绑定组
│   │   ├── textures.rs      纹理加载/PNG 解码/程序化材质生成
│   │   ├── droplet_params.rs 水滴全部可调参数(Rust/WGSL 共享,WGSL 声明由 Rust 生成)
│   │   ├── droplets.rs      水滴结构与初始化
│   │   ├── uniforms.rs      uniform 布局
│   │   ├── random.rs / random_params.rs  哈希噪声工具与常量
│   │   ├── app_params.rs    主循环/资源路径/滑块参数表
│   │   ├── render_params.rs GPU 管线参数与绑定槽位
│   │   ├── texture_params.rs 程序化贴图生成参数
│   │   └── shaders.wgsl     WGSL 着色器
│   ├── examples/        本地验证与预览程序
│   ├── target/          生成:cargo 构建缓存(gitignore)
│   └── prompt/          生成:cargo test 的可视化 ppm 素材(gitignore)
├── web/                 前端
│   ├── src/             配置 / 组件 / 行为 / 样式
│   │   ├── config.ts        全部常量 + 标记与设置面板的声明式模型(文案/分辨率/滑块/风格/按钮)
│   │   ├── config.test.ts   配置的单测(与 config.ts 同目录)
│   │   ├── metro_window.ts  挂载函数:长出标记/组装面板/交互/WebGPU 适配器检查/生命周期
│   │   ├── ui/
│   │   │   ├── dom.ts             h():声明式 DOM 构造原语(描述 -> 元素)
│   │   │   ├── window_content.ts  车窗标记组件(标题/副标题/画布)
│   │   │   └── settings.ts        设置面板组件(按 config.ts 的模型生成并交回元素引用)
│   │   ├── tokens.css       设计令牌(全部可调数值)
│   │   └── metro_window.css 组件样式(全部以 .metro-window 作用域)
│   └── pkg/             生成:wasm-bindgen 输出(gitignore)
└── .cargo-tools/        生成:按 Cargo.lock 对齐版本的 wasm-bindgen CLI(gitignore)
```

Rust -> wasm 的构建脚本放在**仓库的 tools 目录** `scripts/build_wasm.sh`(和
`scripts/check_wasm.mjs`, `scripts/perf/451.mjs` 一起),因为它要做 npm 脚本做不到
的事:探测/补装 wasm32 target,并按 `Cargo.lock` 对齐 wasm-bindgen CLI 版本.

> 这里没有 `index.html` / `page.ts` / `metro_index.css` / `public/`:并入站点后
> 曾有一个 `/metro_window/` 独立入口页,后来撤掉,车窗只在站点首页 HOME 卡片
> 挂一次 -- 页面级标记改由 `web/src/ui/window_content.ts` 生成,宿主只留空容器.
> 运行时贴图也不再单独养一份 `public/`,而是集中到站点唯一的静态资源根
> `public/metro_window/resource/`(URL 仍是 `/metro_window/resource/*.png`).

**这个子项目里没有 `package.json` / `vite.config.ts` / `tsconfig.json` / `build.sh`.**
并进站点后,这些"独立仓库的边界文件"由站点统一接管(Vite 配置在仓库根,
构建步骤序列在根 `package.json` 的 `build:all`).这样"构建步骤只有一处事实源"
这条约定仍然成立.

生成物(`rust/target/` / `web/pkg/` / `.cargo-tools/` / `rust/prompt/`)均已在仓库根
`.gitignore` 排除;前端源码(`web/src/`)与生成产物(`web/pkg/`)严格分离,
不手工维护生成文件.

> 说明:更早的架构用 `tsc` 直接编译出 `web/main.js`,再用 Python 静态服务器
> 托管整个目录;后来改为 Vite:TypeScript/CSS/HTML 由 Vite 统一处理,
> `web/pkg/` 中的 wasm-bindgen 产物也由 Vite 打包并重写 wasm 资源地址.

## 构建

构建入口在**仓库根**,不在本目录:

```bash
./build.sh          # 完整构建:检查工具链 -> npm ci -> 跑完整流水线
npm run build:all   # 跳过依赖安装,只跑流水线(CI 与本地完全一致的步骤序列)
npm run build:wasm  # 只重新编译 Rust->wasm(等价于 bash scripts/build_wasm.sh)
```

流水线步骤定义在仓库根 `package.json` 的 `build:all`(单一事实源),顺序如下:

| 步骤 | 命令 | 说明 |
| --- | --- | --- |
| 1 | `npm run lint:rs` | `cargo fmt --check` + `cargo clippy --all-targets -- -D warnings` |
| 2 | `npm run clean` | 删除 `dist/` 与 `src/metro_window/web/pkg/`,避免改名后残留旧产物 |
| 3 | `npm run build:wasm` | `cargo build --release --target wasm32-unknown-unknown`,再用与 `Cargo.lock` 同版本的 wasm-bindgen 生成 `web/pkg/` |
| 4 | `npm test` | `vitest run`(站点 + 前端单测) |
| 5 | `npm run test:rs` | `cargo test`(原生单元测试,wgpu 那部分不需要 GPU) |
| 6 | `npm run build:app` | `check:wasm` + `tsc -p tsconfig.json --noEmit` + `vite build` 输出 `dist/` |

工具链要求:`node` / `npm` / `cargo` / `rustc`,以及 `wasm32-unknown-unknown`
target(缺了构建脚本会 `rustup target add` 补装).`wasm-bindgen` CLI **不需要**
预先安装:版本与 `Cargo.lock` 不一致时,脚本会装到 `src/metro_window/.cargo-tools/`.

CI 侧(`.github/workflows/deploy.yml`)只多两步:`dtolnay/rust-toolchain@stable`
装 Rust + wasm32 target + rustfmt/clippy,`Swatinem/rust-cache` 缓存
`src/metro_window/rust/target` 与 `src/metro_window/.cargo-tools`;wasm 产物
(`web/pkg/`)同样不入库.

## 运行

```bash
npm run dev        # 仓库根的 Vite 开发服务器,车窗在首页 http://127.0.0.1:5173/ 的 HOME 卡片里
npm run preview    # 预览 dist/ 里的构建产物
```

缺 wasm 产物时 `npm run dev` 会先报错提示先跑 `npm run build:wasm`
(`scripts/check_wasm.mjs`),而不是让 Vite 抛一句 "Failed to resolve import".

> 开发时改动 `web/src/` 下的 TypeScript/CSS 会自动热更新;改动 Rust/WGSL
> 需要重新运行 `npm run build:wasm`(会重新生成 `web/pkg/`,Vite 会自动加载新产物).
> `vite.config.ts` 已把 `rust/target/` 排除出文件监听,避免 chokidar 去遍历 GB 级的
> 构建缓存.

[启用WebGPU](chrome://flags/#enable-unsafe-webgpu)

无沙盒模式启动浏览器

```sh
chromium-browser --no-sandbox --enable-unsafe-webgpu http://127.0.0.1:5173/
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
cargo run --manifest-path src/metro_window/rust/Cargo.toml --example validate_wgsl  # WGSL 语法/校验
cargo run --manifest-path src/metro_window/rust/Cargo.toml --example native_smoke   # 用软件 Vulkan 实际跑一遍计算+渲染管线
cargo run --manifest-path src/metro_window/rust/Cargo.toml --example preview        # 用真实城市纹理渲染一帧,输出 preview.png
```

> `cargo test` 的 cwd 是 crate 根,所以可视化 ppm 落在
> `src/metro_window/rust/prompt/`(已 gitignore);`preview` 写出的 `preview.png`
> 落在**调用目录**(`cargo run` 不改 cwd,从仓库根调就落在仓库根,已 gitignore).
> `preview` 读城市贴图用的是编译期注入的绝对路径(`CARGO_MANIFEST_DIR` 向上三级),
> 指向站点静态资源根 `public/metro_window/resource/*.png`,不受 cwd 影响.

## 迁移与归档

### 从哪来

- 上游仓库:<https://github.com/ToyosatomiminoMiko/metro_window>(**已归档,只读**)
- 迁移时的上游 `main`:**`36922c6`(样式调整)**
- 上游的本地 clone **已删除**:本目录是唯一的可写副本,只读副本在 GitHub 归档仓库里.

### 搬过来了什么(上游全部被跟踪文件)

`Cargo.toml` / `Cargo.lock`,`src/`(Rust + WGSL),`examples/`,
`public/resource/*.png`(4 张城市贴图,后来挪到站点 `public/metro_window/resource/`,
见下面"搬进来改了什么"),`web/`(前端源码 + 设计源文件),
`index.html`,`README.md`.归档前逐项核对过,没有遗漏.

上游 `.gitignore` 里的 `/prompt` 是本地草稿目录(未跟踪),不在归档范围内:
其中 `prompt/prompt.md` 记录了本项目的总体目标与演进过程,本地 clone 删除后
它就只剩别处的副本了.

### 搬进来改了什么

| 改动 | 为什么 |
| --- | --- |
| 删掉 `package.json` / `package-lock.json` / `vite.config.ts` / `tsconfig.json` / `build.sh` / `.gitignore` | 独立仓库的边界文件,由站点仓库统一接管;`scripts/build_wasm.sh` 保留了 npm 脚本做不到的那部分,`build:all` 步骤序列仍是单一事实源 |
| 整个子项目从仓库根 `metro_window/` 挪进 `src/metro_window/`(Rust -> `rust/`,前端 -> `web/`) | 站点约定"代码在 `src/`":并入后不再留一个与 `src/` 平级的源码树;按语言/角色分成 `rust/` 与 `web/` 两个子目录,构建脚本归到仓库 tools 目录 `scripts/` |
| 前端入口 `main.ts` -> `metro_window.ts`(行为)+ `metro_window.css`(样式) | 把行为做成"有标记就能挂"的模块,不再养一个页面级入口 |
| 后来撤掉 `/metro_window/` 独立入口页(`index.html` / `page.ts` / `metro_index.css`),并入站点首页 | 车窗只在首页 HOME 卡片挂一次;页面级标记(标题/副标题/画布)改由 `web/src/ui/window_content.ts` 生成,宿主只留空容器 `#metro-window` |
| 删掉 `web/design/city_mid.png.kra`(1.5 MB 的设计源文件) | 它只在独立页时代有用;入口页撤掉后不再参与构建,随后从仓库删除 |
| `style.css` 全部选择器加 `.metro-window` 作用域,自定义属性加 `--metro-` 前缀 | 站点有一条 `* { ... }` 通配重置和 bootstrap,原来 `body`/`canvas`/`button` 的裸元素选择器会污染站点的其它页面 |
| 新增渲染生命周期(IntersectionObserver + visibilitychange) | rAF 不会因为容器 `display:none` 而停,不禁的话切走标签页后 GPU 一直空转 |
| Rust 里贴图路径 `/resource/...` -> `/metro_window/resource/...`,集中成 `app.rs` 的 `RESOURCE_BASE` | 并进站点后资源挂在子路径下;地址是 Rust 里写死的,必须和产物里的真实路径一致 |
| 城市贴图从子项目的 `public/resource/` 挪进站点唯一静态资源根 `public/metro_window/resource/`,删掉 `metroWindowAssets()` 插件 | 站点 Vite 只有一个 `publicDir`,另建 `public/` 就得靠插件在 dev 重写,在 build 手动 emit;放进 `public/` 后 URL 与目录同构,dev/build 行为天然一致 |
| 删掉上游 `LICENSE`(GPL-3.0) | 站点是 **AGPL-3.0**;作者同为一人,合并后整体按站点许可走,保留一份子目录许可只会让人误以为这个子树单独授权 |
| 删掉上游 `prompt/` | 未跟踪的本地草稿,不属于仓库内容 |

### 归档状态与遗留

已经做完的:

1. 上游仓库在 GitHub 上**已归档**(只读),本地 clone 已删除.
2. 归档前逐项核对过"搬过来了什么",没有遗漏.
3. 站内没有任何指向 `github.com/.../metro_window` 的链接,不需要改指向.

还剩一件事要确认:

1. **上游 project 仓库的 GitHub Pages 是否开着**.`metro_window` 的 Pages 会占
   `toyosatomiminomiko.github.io/metro_window/`.本站是 user Pages
   (`ToyosatomiminoMiko.github.io`),撤掉独立入口页后本站不再有
   `/metro_window/index.html`,只在该路径下提供运行时贴图
   (`/metro_window/resource/*.png`),所以两者已不再抢同一个页面;但如果你希望
   上游归档仓库彻底停止发布,仍要去它的 Settings -> Pages 把 source 置成 None.
