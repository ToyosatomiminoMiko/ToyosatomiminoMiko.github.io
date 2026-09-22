# 地铁车窗 · Rust + WASM + WebGPU

> **本子项目已并入站点仓库** `ToyosatomiminoMiko.github.io`,不再是独立项目,
> 源码整体位于 `src/metro_window/`(Rust crate 在 `rust/`,前端源码在 `src/`,
> wasm 生成物在 `wasm/`;`Cargo.lock` 与 `target/` 在仓库根,因为是 workspace 级).
> 上游仓库 `ToyosatomiminoMiko/metro_window` 已归档(只读),本地 clone 已删除 --
> 本目录现在是唯一的可写副本;迁移范围,改了什么,为什么这么改,
> 见文末[「迁移与归档」](#迁移与归档).

用 Rust 编写/编译为 WebAssembly,再通过 wgpu(浏览器原生 WebGPU 后端)实现的
地铁车窗玻璃效果:**窗外城市多层视差 + 玻璃污渍 + 窗内冷凝雾气 + 车厢灯光与
乘客倒影**,外加三套风格调色.原有 JavaScript 实现已由 Rust 重写,纹理生成与
合成全部运行在 Rust + WGSL 中.

> **水珠(雨滴)那套效果已经拆走.** 车窗剩下的是"一块起雾/有污渍的玻璃 + 窗外
> 城市";水珠(物理 / 折射 / 高光 / 背景景深 + 它依赖的 mip 链)现在住在
> `water_droplet_demo/`(自包含的可运行 demo,但**已整体移出本仓库单独维护**,
> 不再随本站一起构建).本目录里不再有任何水珠代码,拆分边界见文末[「水珠拆分」](#水珠拆分).

## 在站点里的位置

| | |
| --- | --- |
| 站点位置 | 站点首页的**四个**空宿主:舞台(画布)`#metro-window` 与风格按钮 `#metro-styles` 在 HOME 标签页的**首屏**(前者在 `.hero__stage` 里铺满整屏,后者在 `.hero__bottom` 里与 LED 时钟同排),其余设置面板 `#metro-params` 与它下方的图层贴图上传面板 `#metro-uploads` 在 SETTING 标签页;这四个宿主由站点骨架按 `config.ts` 的 `MOUNT_IDS` **生成**(站点把整页 UI 也改成了声明式编排:`index.html` 只剩 `<div id="site-root">`,骨架见 `src/common/ui/site_shell.ts`),挂载见 `src/main.ts`(已没有独立入口页) |
| Rust 源码 | `src/metro_window/rust/`(crate `metro-window`,编译为 wasm32-unknown-unknown) |
| 前端源码 | `src/metro_window/src/` |
| 组件行为 | `src/metro_window/src/metro_window.ts`,导出 `mountMetroWindow(points: MetroMountPoints)` / `mountMetroWindowAtMountIds()`(站内入口给的是**宿主引用**:`mountMetroWindow({ stage: shell.metroStage, ... })`) |
| 运行时贴图 | 源码 `public/metro_window/resource/level_0.png` ~ `level_3.png`(站点 public,编号由近到远),公开地址 `/metro_window/resource/*.png` |

### 组件形态

前端做成了"挂载函数"而不是页面入口:**宿主只提供空容器**,标记由组件生成;
组件拆成**舞台**(画布),**风格按钮行**,**控制台**(其余设置面板)与
**上传面板**(图层贴图替换)四块,各挂各的宿主:

```ts
import { mountMetroWindowAtMountIds } from '@/metro_window/src/metro_window';

mountMetroWindowAtMountIds();   // 自己按约定的四个 id 找容器(见 MOUNT_IDS),缺一个就报错
```

```ts
// 或者自己给宿主(站点入口用这种:宿主引用来自站点骨架,不查 DOM)
// 舞台必填,风格按钮 / 控制台 / 上传面板都可省略
import { mountMetroWindow } from '@/metro_window/src/metro_window';

// styles 不给 => 风格按钮留在控制台里;panel 不给 => 面板与状态区仍在,只是不显示;
// uploads 不给 => 上传面板落在控制台宿主内部(仍在设置面板之后)
mountMetroWindow({ stage, styles, panel, uploads });
```

- **宿主只提供空容器**:站点里有四个 `<div id="metro-window">` /
  `<div id="metro-styles">` / `<div id="metro-params">` /
  `<div id="metro-uploads">`(最后两个在 SETTING 标签页里上下相邻;它们由站点骨架
  按本组件 `config.ts` 的 `MOUNT_IDS` 生成并**把元素引用**交给
  `mountMetroWindowAtMountIds` 之外的入口,站点侧不再按 id 查 DOM);画布由
  `src/ui/stage_content.ts` 按 `src/config.ts` 的分辨率生成,风格按钮行与设置面板
  (播放控制 / 滑块 / 状态区)由
  `src/ui/settings.ts` 按同一份模型生成,上传面板由 `src/ui/uploads.ts` 按
  `UPLOAD_LAYERS` 生成,分别插进各自的宿主 --
  风格按钮行**只建一份**(给 `styles` 宿主就挂首屏,不给就留在控制台里,
  两个地方不会各出现一份).宿主页不出现任何
  车窗标记,加一个滑块只需要往 `SLIDER_GROUPS` 里加一条,加一层可上传贴图只需要往
  `UPLOAD_LAYERS` 里加一条 -- 这两份声明会随 `RUNTIME_CONFIG` 传给 wasm,
  Rust 侧不需要同步登记一份清单(层数与着色器实现不一致时 wasm 启动就会报错,
  见"TS 与 Rust 的职责边界"),
  改文案只动 `config.ts`.
- **"调参"与"换素材"分两块**:设置面板与上传面板是**两个 fieldset,两个宿主**,
  不合并 -- 前者改渲染参数,后者换美术素材,混在一起会让两件事都不好找;
  两者的"卡片"外观由 `metro_window.css` 里写在一起的选择器统一(改一处两块一起变).
- **拆分的两条硬约束**:
  - 样式作用域类 `.metro-window` 由挂载函数往**每个**宿主上都补 --
    `metro_window.css` 的每条选择器都以它开头,面板换了宿主却没这个类,
    样式会**静默失效**(看着"没坏"但全乱);
  - 渲染可见性只看**舞台**:`IntersectionObserver` 观察的是画布所在容器,
    面板在别的标签页里可见与否不代表画面可见与否,不能拿来当暂停依据.
- **声明式组件**:`@/common/dom` 的 `h()` 是**全站唯一**的 DOM 构造原语(描述 -> 元素,
  原先养在本组件的 `src/ui/dom.ts` 里,站点其它 UI 也按同一条约定编排后提升到
  `src/common/dom.ts` 共用),
  `src/ui/stage_content.ts`(舞台标记)与 `src/ui/settings.ts`(设置面板)
  都是纯函数,不读页面,不改全局;`metro_window.ts` 把标记插进各自的宿主,拿到组件交回的
  元素引用后绑事件,不再按 id 去 DOM 里找.滑块布局只在 `createSlider()` 里定义
  一处:最外层 `div.slider`,上层滑杆,下层"名称(左) + 数值(右)".
- `metro_window.ts` 只做行为,`metro_window.css` 只做组件样式.
  `.metro-window` 类名由 `metro_window.ts` 挂上(宿主不用记这个约定),
  组件只在容器内解析元素.
- **舞台修饰类 `.metro-window--stage`**(由挂载函数固定加在舞台宿主上,
  面板宿主不加):它把舞台变成"铺满宿主的一层" -- `position: absolute; inset: 0`
  加去掉面板的内边距与底色;**因此带这个类的舞台,其宿主必须是定位祖先**
  (站点里是 `.hero__stage`).画布在这一层里用 `object-fit: cover` 铺满:

  ```css
  .metro-window--stage canvas { width:100%; height:100%; max-width:none;
                                aspect-ratio:auto; object-fit:cover; }
  ```

  为什么是 `object-fit` 而不是自己算尺寸:后备缓冲仍是 **16:9**(默认 1344×756,
  Rust 侧所有按 uv 铺满的图层都跟这个比例绑定),`cover` 让合成器把这张位图按
  "覆盖"缩放进宿主盒子,超出的部分裁掉 -- 比例不变,所以城市层不会被拉变形.
  实测 Chromium 对 `<canvas>` 的 `object-fit` 是生效的(用"正方形画布画正圆,
  显示盒子做成 4:1"验证过:`cover` 下仍是正圆,上下被裁,`none` 下按原始尺寸居中
  而不是拉伸).若哪天遇到忽略 canvas `object-fit` 的浏览器,回退写法是
  `width: max(100%, calc(100dvh * 16 / 9))` + 父层 `overflow: hidden` --
  代价是画布比例要在站点样式里再写一遍.
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
逐帧合成负载,如果不管,切走标签页以后 GPU 会一直空转.所以组件把
**「用户想不想跑」(▶/⏸)和「现在能不能看见」分开记**,实际渲染 = 两者相与:

- `IntersectionObserver` 盯容器(标签页切走时交集为空);
- `visibilitychange` 盯整个文档(浏览器最小化/切到后台标签);
- 两者都只影响"能不能跑",不会覆盖用户自己按下的暂停.

### 后备缓冲尺寸(随首屏变化)

首屏要铺满整个视口,而后备缓冲**比例恒为 16:9** -- 城市四层 / 污渍 / 雾气都是拿
uv 直接铺满画布的(见 `shaders.wgsl` 的 `uvFar` / `dirtUv` / `fogUv` 等),
画布比例一变整幅场景就被横向拉伸(21:9 上建筑变胖,竖屏上被压扁).
所以尺寸取"**覆盖宿主所需的 16:9**"再乘 dpr(见 `src/stage_size.ts`,纯函数,有单测):

```text
w = max(宿主宽, 宿主高 × 16/9) × dpr      ← 两边都至少铺满
h = w / (16/9)
```

覆盖多出来的那一部分由 CSS 的 `object-fit: cover` 裁掉(见"组件形态"),
所以**显示上仍是 1:1 物理像素**:`dpr` 不乘的话,高分屏等于让浏览器把位图放大
dpr 倍.

触发与代价:

- `ResizeObserver` 观察**舞台宿主**(它 absolute 铺满首屏),**防抖 150ms** --
  拖动窗口会连续触发,而每次重建都要重新分配画布后备缓冲与 Rust 侧的 surface;
- dpr 变化单独用 `matchMedia('(resolution: Xdppx)')` 盯:换显示器时宿主尺寸不变,
  `ResizeObserver` 不会触发;
- **宿主不可见时(切走的标签页,量出来 0×0)直接跳过**:否则后备缓冲会被算成 1×1;
- 顺序是"先改 `<canvas>` 的 `width`/`height`,再调 wasm 的 `resize`",
  两件事在同一个任务里做完,中间没有帧被提交,不会出现 surface 配置与画布尺寸
  对不上的那一帧.首次尺寸必须在 `startApp` **之前**算好 --
  `startApp` 直接读画布当前尺寸建资源,于是不需要"建完再立刻重建一遍".

Rust 侧的 `resize()`(见 `app.rs`)只做一件事:

| 改动 | 为什么 |
| --- | --- |
| `SurfaceConfiguration` 的宽高(并重新 `configure`) | 必须等于画布的 `width`/`height` 属性,否则 `get_current_texture` 拿到的尺寸对不上 |

**材质纹理,绑定组与管线都与画布尺寸无关**,所以这里不重建任何一样东西
(重建管线会重新编译着色器,拖动窗口时一顿一顿的).

像素总数上限(`config.ts` 的 `MAX_BACKING_PIXELS`,0 = 不限)已经埋好:
要降代价时改成正数即可,它会按 `sqrt(上限 / 实际)` 等比缩小两个方向.

## WebGPU 不可用时

组件给舞台宿主加 `data-state="unavailable"`(`metro_window.css` 据此**藏掉画布**),
并在首屏底部留一句短提示(`config.ts` 的 `STAGE_NOTE_UNAVAILABLE`).
首屏露出来的就是站点自己的背景(见根 README 的"首屏与导航条")--
不需要额外准备静帧图,也不会留一块"什么都不显示的黑框".
**完整的四步排查说明仍然只进 SETTING 的状态区**:首屏是欢迎页,
不该被一段开发向的排错文字占满.

## 架构

```text
src/metro_window/
├── rust/                   Rust crate `metro-window`(编译为 wasm32-unknown-unknown)
│   ├── Cargo.toml        Rust 依赖声明(Cargo.lock 在仓库根,workspace 级)
│   ├── src/
│   │   ├── lib.rs           入口:wasm 导出/动画循环/线程局部状态
│   │   ├── app.rs           App 状态机/帧循环/WebGPU 设备/表面/纹理上传
│   │   ├── pipelines.rs     渲染管线与绑定组
│   │   ├── textures.rs      纹理加载/PNG 解码/程序化材质生成/预乘 alpha
│   │   ├── glass_params.rs  车窗全部可调参数(Rust/WGSL 共享,WGSL 声明由 Rust 生成)
│   │   ├── uniforms.rs      uniform 布局(时间 / 风格)
│   │   ├── random.rs / random_params.rs  哈希噪声工具与常量
│   │   ├── app_params.rs    主循环/资源路径/滑块参数表/上传槽位白名单
│   │   ├── render_params.rs GPU 管线参数与绑定槽位
│   │   ├── texture_params.rs 程序化贴图生成参数
│   │   └── shaders.wgsl     WGSL 着色器
│   ├── examples/        本地验证程序(validate_wgsl / preview)
│   └── test_output/     生成:cargo test 的可视化 ppm 产物(gitignore)
├── src/                 前端源码:配置 / 组件 / 行为 / 样式
│   ├── config.ts        全部常量 + 标记与设置面板的声明式模型(文案/分辨率/滑块/风格/按钮)
│   ├── config.test.ts   配置的单测(与 config.ts 同目录)
│   ├── stage_size.ts    后备缓冲尺寸计算(纯函数:覆盖宿主的 16:9 × dpr)
│   ├── stage_size.test.ts 上者的单测
│   ├── metro_window.ts  挂载函数:长出标记/组装面板/交互/WebGPU 适配器检查/生命周期
│   ├── ui/
│   │   ├── stage_content.ts   舞台标记组件(画布)
│   │   ├── settings.ts        设置面板组件(按 config.ts 的模型生成并交回元素引用)
│   │   └── uploads.ts         图层贴图上传面板组件
│   ├── tokens.css       设计令牌(全部可调数值)
│   └── metro_window.css 组件样式(全部以 .metro-window 作用域)
├── wasm/                生成:wasm-bindgen 输出(gitignore)
└── .cargo-tools/        生成:按 Cargo.lock 对齐版本的 wasm-bindgen CLI(gitignore)

仓库根(cargo workspace,不属于本子项目但由它引入):
├── Cargo.toml           workspace 定义:members 收录本 crate;release 编译参数也在这里
├── Cargo.lock           全仓库唯一的依赖锁定(workspace 级,所有 crate 共用)
└── target/              生成:cargo 构建缓存(workspace 级,gitignore)

水珠 demo 曾经由本子项目拆出到仓库根目录 `water_droplet_demo/`,现在**已经整体移出
本仓库单独维护**:它是独立 cargo workspace + 独立前端工程,与本目录没有任何互相引用,
所以搬走后这里不会有任何悬空引用.
```

Rust -> wasm 的构建脚本放在**仓库的 tools 目录** `scripts/build_wasm.sh`(和
`scripts/check_wasm.mjs`, `scripts/perf/451.mjs` 一起),因为它要做 npm 脚本做不到
的事:探测/补装 wasm32 target,并按 `Cargo.lock` 对齐 wasm-bindgen CLI 版本.

> 这里没有 `index.html` / `page.ts` / `metro_index.css` / `public/`:并入站点后
> 曾有一个 `/metro_window/` 独立入口页,后来撤掉,车窗只在站点首页挂一次
> (现在是两块:舞台在 HOME,控制台在 SETTING) -- 页面级标记改由
> `src/ui/stage_content.ts` 生成,宿主只留空容器.
> 运行时贴图也不再单独养一份 `public/`,而是集中到站点唯一的静态资源根
> `public/metro_window/resource/`(URL 仍是 `/metro_window/resource/*.png`).

**这个子项目里没有 `package.json` / `vite.config.ts` / `tsconfig.json` / `build.sh`.**
并进站点后,这些"独立仓库的边界文件"由站点统一接管(Vite 配置在仓库根,
构建步骤序列在根 `package.json` 的 `build:all`).这样"构建步骤只有一处事实源"
这条约定仍然成立.

生成物(`target/` / `wasm/` / `.cargo-tools/` / `rust/test_output/`)均已在仓库根
`.gitignore` 排除(其中 `target/` 在仓库根,因为是 workspace 级的);前端源码
(`src/`)与生成产物(`wasm/`)严格分离,不手工维护生成文件.

> 说明:更早的架构用 `tsc` 直接编译出 `web/main.js`,再用 Python 静态服务器
> 托管整个目录;后来改为 Vite:TypeScript/CSS/HTML 由 Vite 统一处理,
> `wasm/` 中的 wasm-bindgen 产物也由 Vite 打包并重写 wasm 资源地址.

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
| 1 | `npm run lint:rs` | `cargo fmt --all -- --check` + `cargo clippy --workspace --all-targets -- -D warnings`(在仓库根对 workspace 跑) |
| 2 | `npm run clean` | 删除 `dist/` 与 `src/metro_window/wasm/`,避免改名后残留旧产物 |
| 3 | `npm run build:wasm` | `cargo build --release --target wasm32-unknown-unknown --package metro-window`,再用与 `Cargo.lock` 同版本的 wasm-bindgen 生成 `wasm/` |
| 4 | `npm test` | `vitest run`(站点 + 前端单测) |
| 5 | `npm run test:rs` | `cargo test --workspace`(原生单元测试,不需要 GPU) |
| 6 | `npm run build:app` | `check:wasm` + `tsc -p tsconfig.json --noEmit` + `vite build` 输出 `dist/` |

工具链要求:`node` / `npm` / `cargo` / `rustc`,以及 `wasm32-unknown-unknown`
target(缺了构建脚本会 `rustup target add` 补装).`wasm-bindgen` CLI **不需要**
预先安装:版本与 `Cargo.lock` 不一致时,脚本会装到 `src/metro_window/.cargo-tools/`.

CI 侧(`.github/workflows/deploy.yml`)只多两步:`dtolnay/rust-toolchain@stable`
装 Rust + wasm32 target + rustfmt/clippy,`Swatinem/rust-cache` 缓存仓库根的
`target`(workspace 级)与 `src/metro_window/.cargo-tools`;wasm 产物
(`wasm/`)同样不入库.

## 运行

```bash
npm run dev        # 仓库根的 Vite 开发服务器:舞台在首页 http://127.0.0.1:5173/ 的 HOME 标签页,控制台在 SETTING 标签页
npm run preview    # 预览 dist/ 里的构建产物
```

缺 wasm 产物时 `npm run dev` 会先报错提示先跑 `npm run build:wasm`
(`scripts/check_wasm.mjs`),而不是让 Vite 抛一句 "Failed to resolve import".

> 开发时改动 `src/metro_window/src/` 下的 TypeScript/CSS 会自动热更新;改动
> Rust/WGSL 需要重新运行 `npm run build:wasm`(会重新生成 `wasm/`,Vite 会自动
> 加载新产物).`vite.config.ts` 已把仓库根的 `target/` 排除出文件监听,避免
> chokidar 去遍历 GB 级的构建缓存.

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

- Layer 0:窗外实景 -- 城市四层纹理按不同速度滚动(远景 / 中景 / 近景是带 alpha
  的美术素材,加载时**预乘 alpha** 后再上传,合成写成 `c = c*(1-a) + rgb`,
  这样建筑轮廓外不会渗黑边)
- Layer 1:玻璃杂质与污渍 -- Rust 程序化生成污渍/划痕/灰尘纹理,RGB 是"乘性颜色"
  (接近 1 的暖灰),A 是浓度
- Layer 2:窗内雾气 -- 程序化噪声纹理做冷凝水汽扩散,柔化并降低对比度
- Layer 3:窗内灯光与反射 -- 程序化生成车厢灯带与乘客倒影纹理
- 玻璃参数:车速 / 三层背景距离 / 污渍 / 雾气 / 车厢灯光全部集中在 `glass_params.rs`,
  WGSL 的 struct GlassParams 由 Rust 生成并注入,两边不会各自漂移
- 实时滑块:车速 / 三层背景距离 / 污渍浓度 / 雾气浓度 / 车厢灯光均可拖动实时调整.
  **初始值只在 `config.ts` 的 `SLIDER_GROUPS` 里写一份**:`startApp` 之后挂载函数
  补推一次(`metro_window.ts` 的 `pushSliderValues`),把滑杆的起始值写进 wasm;
  Rust 的 `GlassParams::DEFAULT` 只是"JS 推入之前的占位值",改滑块初值不必动 Rust
  (拖动路径本来就是 `input` -> `setParam`,补推走的是同一个入口)
- 风格切换:uniform 传入 styleId,WGSL 片段着色器内实现
  东京电车/赛博朋克/上海磁悬浮三套调色与氛围;默认风格是**赛博朋克**
  (`index 1`),而且只有**一份声明**:`config.ts` 的 `DEFAULT_STYLE_INDEX`,
  随 `RUNTIME_CONFIG` 一起进 wasm(初始点亮的按钮与 wasm 的初始风格同源).
  wasm 侧既没有默认风格常量,也没有风格数量常量:可选数量来自前端的
  `STYLE_PRESETS.length`,与着色器实现的分支数取小(见 boot_config.rs)
- 图层贴图上传(SETTING 标签页):城市背景四层各一个上传按钮 + 恢复默认,
  前端把 PNG 解码成 RGBA8 后交给 wasm 侧的 `setLayerImage` 换掉对应材质槽位的
  纹理(只重建渲染绑定组,不动管线与着色器);详见下面"图层贴图上传"一节

### TS 与 Rust 的职责边界(唯一数据来源)

这是本子项目的一条硬约束:**前端 `config.ts` 是唯一数据来源,Rust 只做调用方.**
凡"产品 / 资源 / 界面能决定"的值都只写在前端,挂载时作为
`startApp(canvas, status, config)` 的第三个参数(`RUNTIME_CONFIG`)一次性传给 wasm:

| 值 | 唯一声明处 | Rust 侧消费点 |
| --- | --- | --- |
| 可选风格(初始编号 / 数量) | `DEFAULT_STYLE_INDEX` / `STYLE_PRESETS` | `App::new` 的初始风格,`setStyle` 的上限 |
| 图层清单(槽位 / 名字 / 文件 / 是否不透明) | `UPLOAD_LAYERS` | 启动时逐层 fetch,上传白名单,上传后的预乘 |
| 资源路径前缀 | `RESOURCE_BASE` | 拼 PNG 的公开地址 |
| 上传边长上限(策略值) | `MAX_UPLOAD_DIMENSION` | 前端先筛;wasm 与设备能力取小后再挡一次 |
| 滑块(参数名 + clamp 区间) | `SLIDER_GROUPS` | `setParam` 按名字写字段,按区间夹取 |

留在 Rust 的三类东西**不是配置**,所以不从前端传:

1. **实现能力**:着色器实现了几个风格分支,几层城市贴图(见 `boot_config.rs` 的
   `SHADER_STYLE_COUNT` / `SHADER_CITY_LAYER_COUNT`),以及"参数名 ->
   `GlassParams` 字段"的分发.前端声明的数量与它对不上时,启动即报错;
2. **硬件能力**:如 `max_texture_dimension_2d`,由设备报告,谁也配置不了;
3. **渲染内部调参**:帧率 / 时间步长(`app_params.rs`),噪声频率与贴图尺寸
   (`texture_params.rs`),哈希(`random_params.rs`),顶点与绑定
   (`render_params.rs`),清屏色.

唯一允许"两侧都出现"的是**各自防自己的兜底**:TS 算后备缓冲时挡住 0 尺寸
(`MIN_BACKING_DIMENSION`),Rust 建 surface / 纹理时也把 0 夹到 1
(`MIN_TEXTURE_DIMENSION`)-- 同类防御在两侧各写一次,不是配置的第二来源.
判断标准很简单:**这个值能不能由产品 / 美术 / 界面决定?** 能,就只写在前端.

校验与回归网:

- wasm 启动时 `BootConfig::from_js` 逐项校验(缺字段 / 类型不对 / 层数与实现不一致 /
  滑块名没有对应字段),错误信息直接指出是哪一项,不静默降级;
- `config.wasm.test.ts` 用**真实 wasm** 跑 `validateConfig(RUNTIME_CONFIG)`:把
  "TS 写的字段名与 Rust 读的一致"变成 CI 里的断言(不需要 GPU);
- `metro_window.test.ts` 用 mock wasm 验启动调用序列(配置整体传入,滑块初值补推).

### 图层贴图上传(没有后端的一条链路)

站点自带素材是 `public/metro_window/resource/` 下的四张 PNG,文件名按**由近到远**
编号:`level_0.png`(城市近景,滚动最快)/ `level_1.png`(中景)/ `level_2.png`
(远景)/ `level_3.png`(城市背景,最远,不滚动).画师按层分开交付;
SETTING 标签页里每层一个上传按钮,换掉其中一层
不影响另外三层(视差照旧).整条链路是:

1. **前端选文件**(`src/ui/uploads.ts` 的 `createUploadPanel()`):`accept="image/png"`,
   再按 MIME 复查一次(JPEG 没有 alpha,换上去会把下面几层整片盖住);
2. **前端解码**(`decodeImageToRgba`):`createImageBitmap` + canvas 的 `getImageData`
   -- 浏览器自带解码器,而 wasm 侧只有 `png` crate,不必再养一套;拿到的是**未预乘**
   的 RGBA8,与启动时加载那四张 PNG 交给纹理创建函数的字节语义一致
   (城市层的预乘在 Rust 侧做,上传与启动走同一条路径);
3. **wasm 换图**(`setLayerImage(layer, width, height, rgba)` ->
   `App::set_layer_texture`):校验槽位白名单 / 尺寸 / 像素字节数,建新纹理,换掉
   `material_views[layer]`,再用 `create_render_bind_group` 只重建**渲染**绑定组.
   管线与着色器完全不动 -- 所以换图不会重新编译着色器(没有拖动窗口那种卡顿);
4. **恢复默认**(`resetLayerImage`):默认纹理一直留在 `App::default_material_textures`
   里,这里只是重新建一个视图换回去,不重新 fetch(断网也能用).

几条硬约束:

- **没有后端**:文件不上传服务器,只在浏览器内存里转成像素喂给 wasm;
  **刷新页面即还原**(要持久化得另说,当前不做);
- 图层清单是**前端单方声明**:哪些层可上传,叫什么名字,用哪个文件,是否不透明
  只写在 `config.ts` 的 `UPLOAD_LAYERS` 里,随 `RUNTIME_CONFIG` 进 wasm.
  名字是 `level_N`,N 跟距离编号(0 最近),而**槽位号跟材质表顺序**(0 是最远的
  背景,即 `level_3`),两者方向相反.Rust 侧只校验"层数是否等于着色器实现的层数"
  与"槽位号是否等于清单位置";没登记的槽位(污渍 / 雾气 / 车厢等程序化贴图)会被
  直接拒绝 -- 宁可报错,也不要出现"前端以为在换污渍,实际换了城市层"这种静默错配;
- 采样器仍是 `u=Repeat, v=ClampToEdge`(见"玻璃材质贴图的约定"):城市图横向
  不可平铺时滚动会出现竖缝,所以提示语写的是"请用带透明通道的 PNG";
- 单边上限是**策略值**:前端 `MAX_UPLOAD_DIMENSION` 先挡一次给可读报错,wasm 侧
  再与设备真实能力(`device.limits().max_texture_dimension_2d`)取小后挡一次 --
  设备能力是硬件事实,不从 TS 传;
- 上传面板与设置面板是**两块 fieldset / 两个宿主**:一边调渲染参数,一边换素材,
  不合并(见 `config.ts` 的 `MOUNT_IDS`).

## 水珠拆分

拆分的目标是"把水珠那部分单独拿出来继续做",所以边界画在**水珠特有的东西**上,
而不是"所有能画雨窗的代码":

| 去了 `water_droplet_demo/` | 留在本目录 |
| --- | --- |
| 水珠物理 `cs_main`(重力 / 风 / 阻力 / 出界重置 / 钉扎) | 城市多层视差的采样与合成 |
| 折射归属图 `cs_refraction` 与片段着色器里的偏移重建(`lateralProfile` / 各向同性空间 / 泪滴拉长) | 污渍(乘性颜色 + 浓度) |
| 水珠边缘高光,静态珠生命周期 | 雾气(冷凝水汽) |
| **背景景深**(按水珠覆盖度挑 mip 级的"清晰岛")与它依赖的 mip 链生成(`mipmaps.rs` / `mip.wgsl`) | 车厢灯光与乘客倒影 |
| 水珠参数(生成 / 重置 / 物理 / 折射 / 形状 / 高光 / 景深)与对应滑块 | 风格调色(`applyStyle`)与车窗边框柔化 |
| 原生示例 `examples/preview.rs` / `examples/native_smoke.rs` | 图层贴图上传链路,污渍/雾气/车厢的程序化贴图生成 |

几个顺带发生的改名 / 收敛,都是"水珠走了以后就不成立"的东西:

- `droplet_params.rs` -> `glass_params.rs`,`DropletParams` -> `GlassParams`,
  WGSL 里注入的 `struct DropletParams` -> `struct GlassParams`,
  绑定槽位 `BINDING_DROPLET_PARAMS` -> `BINDING_GLASS_PARAMS`;
  字段只剩车窗自己的 7 个(车速 / 三层距离 / 三个浓度),外加 1 个对齐填充.
- 计算管线(物理 + 折射)整体搬走,`App` 里不再有水滴 buffer / 折射偏移图 /
  计算绑定组;`resize()` 因此简化成"只重新配置 surface".
- mip 链生成搬走:车窗的贴图都是单级(视差只改采样坐标,不需要缩小过滤),
  `textures.rs` 只剩"解码 -> (可选预乘)-> 建纹理".
- `examples/` 只剩 `validate_wgsl`(它校验的仍是本目录的着色器).
- 前端滑块去掉"水滴与风""背景景深"两组,`LAYERS_NOTE` 也按新的图层数改写.

水珠 demo 是**独立 cargo workspace + 独立前端工程**(自己的 `Cargo.toml` /
`package.json` / `vite.config.ts` / 构建脚本,背景图也是它自己的一份),
所以它可以被整体 `mv` 到别处而不影响这里.两份代码之间**没有任何互相引用**.

## 本地验证

```bash
cargo run --package metro-window --example validate_wgsl  # WGSL 语法/校验
cargo run --package metro-window --example preview        # 用软件 Vulkan 渲染一帧到 rust/test_output/preview.png
```

`preview` 走软件 Vulkan(lavapipe),所以没有 WebGPU 浏览器 / 容器里也能跑;
它读的正是站点运行时那四张城市贴图 + 程序化生成的污渍/雾气/车厢,任意滑块参数都能用
环境变量临时覆盖(名字与线上 `setParam` 同一张表,调出来的数值可以直接抄回滑块):

```bash
PREVIEW_PARAM=fog_opacity=1 cargo run --package metro-window --example preview
PREVIEW_PARAM=dirt_opacity=0,interior_opacity=0 cargo run --package metro-window --example preview
```

`cargo test --workspace` 覆盖 Rust 侧的全部纯函数不变量:uniform 布局与 WGSL 字段
一一对应,绑定槽位 / 入口点与着色器文本一致,上传槽位白名单与尺寸校验,
程序化噪声的双向可平铺等.

> 可视化产物**只有一处落点**:`cargo test` 的 ppm 基准图与 `preview` 的
> `preview.png` 都写在 `src/metro_window/rust/test_output/`(已 gitignore).
> 路径由 `lib.rs::test_output_dir()` 按 `CARGO_MANIFEST_DIR` 算成绝对路径,
> 所以与"从哪个目录敲命令"无关 -- `cargo test` 的 cwd 是 crate 根,
> 而 `cargo run` 的 cwd 是调用目录,以前 preview.png 会因此落在仓库根.
> 水珠的离线预览(`preview`)与软件 Vulkan 冒烟测试(`native_smoke`)现在都在
> `water_droplet_demo/rust/examples/` 下,用法见那个目录的 README.

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
| 整个子项目从仓库根 `metro_window/` 挪进 `src/metro_window/`(Rust -> `rust/`,前端 -> `web/`,后者后来取消,见下) | 站点约定"代码在 `src/`":并入后不再留一个与 `src/` 平级的源码树;按语言/角色分成 `rust/` 与 `web/` 两个子目录,构建脚本归到仓库 tools 目录 `scripts/` |
| 前端入口 `main.ts` -> `metro_window.ts`(行为)+ `metro_window.css`(样式) | 把行为做成"有标记就能挂"的模块,不再养一个页面级入口 |
| 后来撤掉 `/metro_window/` 独立入口页(`index.html` / `page.ts` / `metro_index.css`),并入站点首页 | 车窗只在首页挂一次;页面级标记(画布)改由 `src/ui/stage_content.ts` 生成,宿主只留空容器 `#metro-window` |
| 删掉 `web/design/city_mid.png.kra`(1.5 MB 的设计源文件) | 它只在独立页时代有用;入口页撤掉后不再参与构建,随后从仓库删除 |
| `style.css` 全部选择器加 `.metro-window` 作用域,自定义属性加 `--metro-` 前缀 | 站点有一条 `* { ... }` 通配重置和 bootstrap,原来 `body`/`canvas`/`button` 的裸元素选择器会污染站点的其它页面 |
| 新增渲染生命周期(IntersectionObserver + visibilitychange) | rAF 不会因为容器 `display:none` 而停,不禁的话切走标签页后 GPU 一直空转 |
| Rust 里贴图路径 `/resource/...` -> `/metro_window/resource/...`,集中成 `app.rs` 的 `RESOURCE_BASE` | 并进站点后资源挂在子路径下;地址是 Rust 里写死的,必须和产物里的真实路径一致 |
| 城市贴图从子项目的 `public/resource/` 挪进站点唯一静态资源根 `public/metro_window/resource/`,删掉 `metroWindowAssets()` 插件 | 站点 Vite 只有一个 `publicDir`,另建 `public/` 就得靠插件在 dev 重写,在 build 手动 emit;放进 `public/` 后 URL 与目录同构,dev/build 行为天然一致 |
| 删掉上游 `LICENSE`(GPL-3.0) | 站点是 **AGPL-3.0**;作者同为一人,合并后整体按站点许可走,保留一份子目录许可只会让人误以为这个子树单独授权 |
| 删掉上游 `prompt/` | 未跟踪的本地草稿,不属于仓库内容 |

### 后来的目录与构建调整

上面的迁移完成后,又做了一轮与内容对齐的调整:

| 改动 | 为什么 |
| --- | --- |
| 取消 `web/` 这一层:前端源码 `web/src/` -> 子项目根的 `src/`,wasm 产物 `web/pkg/` -> 子项目根的 `pkg/` | 前端只有一层,`web/` 没有任何信息量;子项目根直接是 `rust/`(crate)+ `src/`(前端)+ `pkg/`(产物),层级更短 |
| `rust/prompt/` -> `rust/test_output/` | 该目录里放的是 `cargo test` 输出的 PPM 可视化产物,与"prompt(提示词/素材)"无关,旧名字会误导 |
| 仓库根新增 `Cargo.toml`(cargo workspace),`Cargo.lock` 从 crate 移到仓库根,`[profile.release]` 也从 crate 移到根 manifest | 这个仓库以后还会加别的 Rust crate:workspace 让全仓库共用一份锁文件和一个 `target/`,在仓库根就能 `cargo test/clippy --workspace`,CI 也只缓存一处;成员在根 manifest 的 `members` 里显式列出 |
| wasm 产物目录 `pkg/` -> `wasm/` | `pkg` 是 wasm-bindgen 的默认叫法,但在这个子项目里它和 `package.json` 的"包",`cargo pkgid` 的"包"都不相干;**目录里装的就是 wasm 产物**,直接叫 `wasm/` 才一眼看得懂.同步改了构建脚本 / `check:wasm` / 前端 import / `tsconfig` exclude / `clean` / `.gitignore` |
| `preview.png` 与 `cargo test` 的 PPM 统一落到 `rust/test_output/` | 两者都是"生成出来给人看的可视化产物",原先一个落仓库根(为它单开了一条 .gitignore),一个落 `test_output/`.路径改由 `lib.rs::test_output_dir()` 按 `CARGO_MANIFEST_DIR` 算成绝对路径:与调用时的 cwd 无关,从哪跑都落同一处,仓库根也不用再忽略 `preview.png` |
| 城市贴图从 `city_bg / city_far / city_mid / city_near` 改名为 `level_3 / level_2 / level_1 / level_0`(编号由近到远) | 旧名字是四个语义标签,顺序只能靠读英文单词判断;统一成带编号的 `level_N` 后,远近一眼可见,也和"城市四层"这个说法对齐.改名要同时动:Rust 的 `app_params.rs`(文件名常量 + `UPLOADABLE_LAYERS` 槽位名),`app.rs` 的加载与调试标签,`examples/preview.rs`,前端 `config.ts` 的 `UPLOAD_LAYERS` 与 `config.test.ts` 的镜像清单.注意**槽位号与编号方向相反**(槽位 0 是最远的背景 = `level_3`),两侧单测各钉了一次 |
| 默认风格改为"由前端经 `startApp(canvas, status, style)` 传入",删掉 Rust 的 `INITIAL_STYLE_ID`;滑块初值也在 boot 后由 `pushSliderValues()` 补推 | 两者都是"两份默认值"造成的静默错配.风格那份更隐蔽:它只写了 uniform buffer 的初值,而 `App::frame` 每帧渲染前都会用 `self.style` 覆盖该缓冲区,`self.style` 又硬编码为 0 -- 于是那个常量改了不起任何作用.现在默认值只有 `config.ts` 一份声明(`DEFAULT_STYLE_INDEX` / `SLIDER_GROUPS[].value`),`metro_window.test.ts` 用 mock wasm 的调用序列把这两条路径钉住 |
| 全面收口"唯一数据来源":`startApp` 改成收一份 `RUNTIME_CONFIG`(风格 / 图层清单 / 资源路径 / 上传上限 / 滑块区间),删除 Rust 侧的 `UPLOADABLE_LAYERS`,`SLIDERS`,`LEVEL_*_FILE`,`RESOURCE_BASE`,`MAX_STYLE_INDEX`,`MAX_TEXTURE_DIMENSION`,新增 `boot_config.rs` 做接收与校验,并新增 `validateConfig` 导出与 `config.wasm.test.ts` | 同一事实在两侧各写一份 + 各配一个镜像单测,每加一个值要改四处,漏一处就是静默错配(风格数量当时甚至是三份:TS 清单,Rust 上限,WGSL 分支).现在只有单向传参:TS 声明 -> wasm 启动校验 -> 消费;留在 Rust 的只有"实现能力 / 硬件能力 / 渲染内部调参"三类非配置值,边界写在"TS 与 Rust 的职责边界"一节 |
| 上传边长上限不再由 Rust 写死:前端传策略值,wasm 与 `device.limits().max_texture_dimension_2d` 取小 | 8192 原本是"wgpu 默认上限"的猜测值,写死在 `render_params.rs` 后与前端那份互为镜像;真源其实是设备能力,而"允许多大"是产品策略 -- 两者取小才是有效上限 |

### 组件拆分:舞台与控制台

首屏要做成"画布铺满视口,导航文字直接压在画面上"(参考 kali.org 那种落地页),
而原来的挂载函数把**舞台**(画布)和**控制台**(设置面板)焊在一次调用里,
面板只能紧跟在画布后面 -- 两者同屏就必然压在画面上.所以按宿主拆成两块:

| 改动 | 为什么 |
| --- | --- |
| `MOUNT_ID` -> `MOUNT_IDS { stage, panel }`;`mountMetroWindow(root)` -> `mountMetroWindow({ stage, panel? })`;`mountMetroWindowAtMountId()` -> `mountMetroWindowAtMountIds()` | 一个页面两个宿主:画布在首屏,设置面板在 SETTING 标签页."面板放哪"从此是站点的决定,组件不再假设两者同屏 |
| `ui/window_content.ts` -> `ui/stage_content.ts`,`createWindowContent()` -> `createStageContent()`;一度新增 `STAGE_COPY_ENABLED` | 这个文件只管舞台;首屏文案后来改由站点页面负责(站名在导航左上角),组件不再生成标题 / 副标题.该开关连同 `WINDOW_TITLE` / `WINDOW_SUBTITLE` / `SUBTITLE_CLASS`,`metro_window.css` 的 `h1`/`.subtitle` 规则与 `--metro-font-size-title` **已整体删除**(开关长期为关,四处都没有消费者) |
| 样式作用域类由挂载函数往**两个**宿主上都补;新增舞台修饰类 `.metro-window--stage` 与隐藏容器 `.metro-panel-sink` | `metro_window.css` 的选择器**全部**以 `.metro-window` 开头:面板换了宿主却没这个类就是"样式静默失效"(看着没坏但全乱);省略面板宿主时退回隐藏容器,面板 / 状态区 / 事件绑定一个都不少 |
| `IntersectionObserver` 明确只观察**舞台** | 面板在别的标签页里,它的可见性不代表画面的可见性,不能拿来当暂停依据 |
| Rust 侧只改了 `startApp` 的签名(多一个 `style` 参数) | 面板只是换了 DOM 宿主;`startApp(canvas, status, style)` 要的 `status` 元素在任何宿主里都成立,`setStyle` / `setParam` / `setRunning` / `reset` 仍作用于同一个单例 |
| 风格按钮行从设置面板里拆出来(`createStyleRow()` + `createSettingsPanel(styleRow)`),新增第三个挂载点 `#metro-styles` | 切风格属于"看",和 LED 时钟一起放在首屏底部最顺手;而"参数"属于"调",留在 SETTING.行仍然**只建一份**,由挂载函数决定放哪(给了 `styles` 宿主就挂首屏,没给就留在控制台里),所以两个地方不会各出现一份 |
| 新增"裸宿主"修饰类 `.metro-window--bare`,`.metro-window--stage` 从此只负责"铺满父层" | 首屏里的舞台与风格按钮宿主都不要车窗面板的内边距与底色;两件事拆成两条规则,比一条规则兼两职好读 |
| 后备缓冲从"固定 1344×756"改成"随宿主算的 16:9 × dpr",并给 Rust 加 `resize()` 导出 | 首屏要铺满整屏,还要 1:1 清晰;比例必须锁死 16:9(场景按 uv 铺满画布),所以算的是"覆盖宿主所需的 16:9"而不是宿主本身的形状 |
| 新增 `data-state="unavailable"` 回退 | WebGPU 不可用时藏掉画布,露出站点背景并留一句短提示;首屏不再出现"什么都不显示的黑框",完整排查步骤仍只进 SETTING |
| 首屏那两个修饰类的选择器改成**把类名写两遍**(`.metro-window.metro-window--stage`) | 它们与基础规则 `.metro-window canvas` 的特异性打平(都是 0,1,1),而基础规则在后面 -- 结果画布被压回 `max-width: 1600px` + `aspect-ratio: 16/9` + 圆角 + 边框,右边与下边露出宿主背景.多写一个类把特异性抬到 0,2,x,顺序就再也影响不到它 |

### 图层贴图上传(新增第四个挂载点)

| 改动 | 为什么 |
| --- | --- |
| 新增第四个挂载点 `#metro-uploads`:独立 `<fieldset class="uploads">`,紧接设置面板下方,不并进去 | 换素材与调参是两件事,合成一块会让"这个滑块管哪一层"和"这张图换的是哪一层"混在一起;组件这边多一块声明式面板(`src/ui/uploads.ts` 的 `createUploadPanel()`) |
| Rust 新增导出 `setLayerImage` / `resetLayerImage`,并新增 `app_params::UPLOADABLE_LAYERS` 白名单 | 材质纹理是 wasm 内部的 wgpu GPU 资源,JS 没有别的途径写进去 -- 所以"只在前端做"做不到,必须有这一对导出;白名单让未登记的层(污渍 / 雾气 / 车厢等程序化贴图)直接报错,而不是静默换错层 |
| `pipelines.rs` 的绑定组构造拆出 `create_render_bind_group` | 换贴图只需要重建**渲染**绑定组(它只持有 uniforms / 材质纹理 / 采样器),不必重建管线或着色器 |
| `App` 新增 `default_material_textures` 字段 | "恢复默认"的来源 -- 重新建视图即可,不重新 fetch,断网也能还原 |
| 解码放前端(`createImageBitmap` + canvas `getImageData`) | 浏览器自带 PNG 解码器,wasm 侧只有 `png` crate,再养一套纯属重复;顺带拿到"文件不出浏览器"这条性质(整条链路**没有后端**) |
| 上传面板与设置面板共用同一套卡片样式(选择器写在一起) | 两块面板分属两个宿主,外观必须一致;复制一份迟早漂移 |

### 水珠拆分(本次)

| 改动 | 为什么 |
| --- | --- |
| 水珠相关 Rust(物理 `cs_main` / 折射 `cs_refraction` / 参数 / 结构 / mip 链生成 / 两个原生示例)整体移到 `water_droplet_demo/rust/` | 车窗整体效果没做成,水珠这部分要单独继续做;两组参数与两套管线原本共用一份 `DropletParams` 与一条计算管线,拆开后两边都能独立演进 |
| 水珠前端的画布生命周期,参数滑块,舞台尺寸计算复制并精简到 `water_droplet_demo/src/`(独立工程,自己的 `package.json` / `vite.config.ts` / `tsconfig.json` / 构建脚本 / 背景图) | demo 要能被整体搬走并独立运行,不能反向依赖站点仓库的构建配置;它自带的一张背景图是原项目城市四层合成的结果(水珠的折射在有高频细节的图上才看得出来) |
| `droplet_params.rs` -> `glass_params.rs`,只留车窗自己的 7 个字段(另加 1 个对齐填充) | 参数结构原先同时服务水珠与车窗;水珠走后剩下的才是"玻璃材质参数" |
| 计算管线 / 水滴 storage buffer / 折射偏移图 / 计算绑定组从 `App` 移除,`resize()` 只重配 surface | 这些资源只被水珠用;绑定组不再持有按画布尺寸建的资源,尺寸变化就只剩 surface 一件事 |
| 车窗贴图改为单级(不再生成 mip 链),`textures.rs` 的 mip 相关函数删除 | mip 链本是给"背景景深"用的,而背景景深是水珠效果的一部分;视差滚动只改采样坐标,单级就够 |
| 前端去掉"水滴与风""背景景深"两组滑块,`LAYERS_NOTE` 改写 | 这些滑块对应的参数已经不在本 crate 里,留着就是"拖了没反应"的静默失效 |
| `examples/` 只剩 `validate_wgsl` | `preview`(水珠离线预览)与 `native_smoke`(水珠管线冒烟)都是水珠的验证工具,已随水珠搬走 |

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
