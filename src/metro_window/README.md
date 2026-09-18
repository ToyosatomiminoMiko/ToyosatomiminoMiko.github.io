# 地铁车窗 · Rust + WASM + WebGPU

> **本子项目已并入站点仓库** `ToyosatomiminoMiko.github.io`,不再是独立项目,
> 源码整体位于 `src/metro_window/`(Rust crate 在 `rust/`,前端源码在 `src/`,
> wasm 生成物在 `pkg/`;`Cargo.lock` 与 `target/` 在仓库根,因为是 workspace 级).
> 上游仓库 `ToyosatomiminoMiko/metro_window` 已归档(只读),本地 clone 已删除 --
> 本目录现在是唯一的可写副本;迁移范围,改了什么,为什么这么改,
> 见文末[「迁移与归档」](#迁移与归档).

用 Rust 编写/编译为 WebAssembly,再通过 wgpu(浏览器原生 WebGPU 后端)实现的
地铁车窗玻璃效果.原有 JavaScript 实现已由 Rust 重写,所有绘制/水滴物理和
纹理生成都运行在 Rust + WGSL 中.

## 在站点里的位置

| | |
| --- | --- |
| 站点位置 | 站点首页 `index.html` 的**三个**空宿主:舞台(画布)`#metro-window` 与风格按钮 `#metro-styles` 在 HOME 标签页的**首屏**(前者在 `.hero__stage` 里铺满整屏,后者在 `.hero__bottom` 里与 LED 时钟同排),其余设置面板 `#metro-params` 在 SETTING 标签页;挂载见 `src/main.ts`(已没有独立入口页) |
| Rust 源码 | `src/metro_window/rust/`(crate `metro-window`,编译为 wasm32-unknown-unknown) |
| 前端源码 | `src/metro_window/src/` |
| 组件行为 | `src/metro_window/src/metro_window.ts`,导出 `mountMetroWindow(points: MetroMountPoints)` / `mountMetroWindowAtMountIds()` |
| 运行时贴图 | 源码 `public/metro_window/resource/*.png`(站点 public),公开地址 `/metro_window/resource/*.png` |

### 组件形态

前端做成了"挂载函数"而不是页面入口:**宿主只提供空容器**,标记由组件生成;
组件拆成**舞台**(画布),**风格按钮行**与**控制台**(其余设置面板)三块,各挂各的宿主:

```ts
import { mountMetroWindowAtMountIds } from '@/metro_window/src/metro_window';

mountMetroWindowAtMountIds();   // 找约定的三个挂载点(见 MOUNT_IDS),缺一个就报错
```

```ts
// 或者自己给宿主:舞台必填,风格按钮与控制台都可省略
import { mountMetroWindow } from '@/metro_window/src/metro_window';

// styles 不给 => 风格按钮留在控制台里;panel 不给 => 面板与状态区仍在,只是不显示
mountMetroWindow({ stage, styles, panel });
```

- **宿主只提供空容器**:站点里只有三个 `<div id="metro-window">` /
  `<div id="metro-styles">` / `<div id="metro-params">`;画布(以及可选的标题 / 副标题,见
  `src/config.ts` 的 `STAGE_COPY_ENABLED`)由 `src/ui/stage_content.ts` 按
  `src/config.ts` 的分辨率生成,风格按钮行与设置面板(播放控制 / 滑块 / 状态区)由
  `src/ui/settings.ts` 按同一份模型生成,分别插进各自的宿主 --
  风格按钮行**只建一份**(给 `styles` 宿主就挂首屏,不给就留在控制台里,
  两个地方不会各出现一份).宿主页不出现任何
  车窗标记,加一个滑块只需要往 `SLIDER_GROUPS` 里加一条,改文案只动 `config.ts`.
- **拆分的两条硬约束**:
  - 样式作用域类 `.metro-window` 由挂载函数往**每个**宿主上都补 --
    `metro_window.css` 的每条选择器都以它开头,面板换了宿主却没这个类,
    样式会**静默失效**(看着"没坏"但全乱);
  - 渲染可见性只看**舞台**:`IntersectionObserver` 观察的是画布所在容器,
    面板在别的标签页里可见与否不代表画面可见与否,不能拿来当暂停依据.
- **声明式组件**:`src/ui/dom.ts` 的 `h()` 是唯一的 DOM 构造原语(描述 -> 元素),
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

  为什么是 `object-fit` 而不是自己算尺寸:后备缓冲仍是 **16:9**(1344×756,
  Rust 侧的 `aspect` 也跟着它走),`cover` 让合成器把这张位图按"覆盖"缩放进
  宿主盒子,超出的部分裁掉 -- 比例不变,所以**水珠仍然是正圆**,而且
  **首屏铺满这件事还不需要 Rust 的 resize 路径**(那条路是后面为了 1:1 清晰度
  才要加的:固定分辨率放大到 4K 宽会糊).
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
计算着色器负载,如果不管,切走标签页以后 GPU 会一直空转.所以组件把
**「用户想不想跑」(▶/⏸)和「现在能不能看见」分开记**,实际渲染 = 两者相与:

- `IntersectionObserver` 盯容器(标签页切走时交集为空);
- `visibilitychange` 盯整个文档(浏览器最小化/切到后台标签);
- 两者都只影响"能不能跑",不会覆盖用户自己按下的暂停.

## 后备缓冲尺寸(随首屏变化)

首屏要铺满整个视口,而后备缓冲**比例恒为 16:9** -- 城市四层 / 污渍 / 雾气都是拿
uv 直接铺满画布的(见 `shaders.wgsl` 的 `uvBG` / `fogUv` 等),画布比例一变整幅场景
就被横向拉伸(21:9 上建筑变胖,竖屏上被压扁);水滴的 `aspect` 也依赖它.
所以尺寸取"**覆盖宿主所需的 16:9**"再乘 dpr(见 `src/stage_size.ts`,纯函数,有单测):

```text
w = max(宿主宽, 宿主高 × 16/9) × dpr      ← 两边都至少铺满
h = w / (16/9)
```

覆盖多出来的那一部分由 CSS 的 `object-fit: cover` 裁掉(见"组件形态"),
所以**显示上仍是 1:1 物理像素**:`dpr` 不乘的话,高分屏等于让浏览器把位图放大
dpr 倍,`shaders.wgsl` 里"边缘恒为约 2 个缓冲像素"的设计就白做了.

触发与代价:

- `ResizeObserver` 观察**舞台宿主**(它 absolute 铺满首屏),**防抖 150ms** --
  拖动窗口会连续触发,而每次重建都要重新分配画布后备缓冲与折射偏移图;
- dpr 变化单独用 `matchMedia('(resolution: Xdppx)')` 盯:换显示器时宿主尺寸不变,
  `ResizeObserver` 不会触发;
- **宿主不可见时(切走的标签页,量出来 0×0)直接跳过**:否则后备缓冲会被算成 1×1;
- 顺序是"先改 `<canvas>` 的 `width`/`height`,再调 wasm 的 `resize`",
  两件事在同一个任务里做完,中间没有帧被提交,不会出现 surface 配置与画布尺寸
  对不上的那一帧.首次尺寸必须在 `startApp` **之前**算好 --
  `startApp` 直接读画布当前尺寸建资源,于是不需要"建完再立刻重建一遍".

Rust 侧的 `resize()`(见 `app.rs`)只重建两样 + 一样:

| 重建 | 为什么 |
| --- | --- |
| `SurfaceConfiguration` 的宽高 | 必须等于画布的 `width`/`height` 属性,否则 `get_current_texture` 拿到的尺寸对不上 |
| 折射偏移图(画布 1/8 分辨率) | 它直接由画布尺寸算出来 |
| 两个绑定组 | 它们都持有折射偏移图的视图 |

**刻意不重建管线**:管线与尺寸无关,走 `create_metro_pipelines` 会把着色器再编译
一遍(几十毫秒),拖动窗口时一顿一顿的.为此 `pipelines.rs` 把绑定组的构造拆成了
独立的 `create_bind_groups`,并把两个 `BindGroupLayout` 留在 `MetroPipelines` 里;
`App` 也因此必须留着与尺寸无关的那 7 个材质纹理视图(重新绑定要用).

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
│   └── test_output/     生成:cargo test 的可视化 ppm 产物(gitignore)
├── src/                 前端源码:配置 / 组件 / 行为 / 样式
│   ├── config.ts        全部常量 + 标记与设置面板的声明式模型(文案/分辨率/滑块/风格/按钮)
│   ├── config.test.ts   配置的单测(与 config.ts 同目录)
│   ├── stage_size.ts    后备缓冲尺寸计算(纯函数:覆盖宿主的 16:9 × dpr)
│   ├── stage_size.test.ts 上者的单测
│   ├── metro_window.ts  挂载函数:长出标记/组装面板/交互/WebGPU 适配器检查/生命周期
│   ├── ui/
│   │   ├── dom.ts             h():声明式 DOM 构造原语(描述 -> 元素)
│   │   ├── stage_content.ts   舞台标记组件(画布,以及可选的标题/副标题)
│   │   └── settings.ts        设置面板组件(按 config.ts 的模型生成并交回元素引用)
│   ├── tokens.css       设计令牌(全部可调数值)
│   └── metro_window.css 组件样式(全部以 .metro-window 作用域)
├── pkg/                 生成:wasm-bindgen 输出(gitignore)
└── .cargo-tools/        生成:按 Cargo.lock 对齐版本的 wasm-bindgen CLI(gitignore)

仓库根(cargo workspace,不属于本子项目但由它引入):
├── Cargo.toml           workspace 定义:members 收录本 crate;release 编译参数也在这里
├── Cargo.lock           全仓库唯一的依赖锁定(workspace 级,所有 crate 共用)
└── target/              生成:cargo 构建缓存(workspace 级,gitignore)
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

生成物(`target/` / `pkg/` / `.cargo-tools/` / `rust/test_output/`)均已在仓库根
`.gitignore` 排除(其中 `target/` 在仓库根,因为是 workspace 级的);前端源码
(`src/`)与生成产物(`pkg/`)严格分离,不手工维护生成文件.

> 说明:更早的架构用 `tsc` 直接编译出 `web/main.js`,再用 Python 静态服务器
> 托管整个目录;后来改为 Vite:TypeScript/CSS/HTML 由 Vite 统一处理,
> `pkg/` 中的 wasm-bindgen 产物也由 Vite 打包并重写 wasm 资源地址.

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
| 2 | `npm run clean` | 删除 `dist/` 与 `src/metro_window/pkg/`,避免改名后残留旧产物 |
| 3 | `npm run build:wasm` | `cargo build --release --target wasm32-unknown-unknown --package metro-window`,再用与 `Cargo.lock` 同版本的 wasm-bindgen 生成 `pkg/` |
| 4 | `npm test` | `vitest run`(站点 + 前端单测) |
| 5 | `npm run test:rs` | `cargo test --workspace`(原生单元测试,wgpu 那部分不需要 GPU) |
| 6 | `npm run build:app` | `check:wasm` + `tsc -p tsconfig.json --noEmit` + `vite build` 输出 `dist/` |

工具链要求:`node` / `npm` / `cargo` / `rustc`,以及 `wasm32-unknown-unknown`
target(缺了构建脚本会 `rustup target add` 补装).`wasm-bindgen` CLI **不需要**
预先安装:版本与 `Cargo.lock` 不一致时,脚本会装到 `src/metro_window/.cargo-tools/`.

CI 侧(`.github/workflows/deploy.yml`)只多两步:`dtolnay/rust-toolchain@stable`
装 Rust + wasm32 target + rustfmt/clippy,`Swatinem/rust-cache` 缓存仓库根的
`target`(workspace 级)与 `src/metro_window/.cargo-tools`;wasm 产物
(`pkg/`)同样不入库.

## 运行

```bash
npm run dev        # 仓库根的 Vite 开发服务器:舞台在首页 http://127.0.0.1:5173/ 的 HOME 标签页,控制台在 SETTING 标签页
npm run preview    # 预览 dist/ 里的构建产物
```

缺 wasm 产物时 `npm run dev` 会先报错提示先跑 `npm run build:wasm`
(`scripts/check_wasm.mjs`),而不是让 Vite 抛一句 "Failed to resolve import".

> 开发时改动 `src/metro_window/src/` 下的 TypeScript/CSS 会自动热更新;改动
> Rust/WGSL 需要重新运行 `npm run build:wasm`(会重新生成 `pkg/`,Vite 会自动
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
- 水滴形状与边缘:形状按画布宽高比换算到各向同性空间后再判定,屏幕上始终是
  正圆;折射偏移由片段着色器逐像素解析重建,轮廓清晰度不受低分辨率偏移图限制
  (原因/改法/验证见下面两节)

### 水滴为什么是正圆(坐标空间契约)

uv 是 [0,1]² 的归一化坐标:x 方向 1 个单位跨画布宽 W 像素,y 方向跨画布高
H 像素,两根轴的"单位长度"并不相等.若直接判定 `length(Δuv) < r`,屏幕上的
边界是

```text
(ΔX / (r·W))² + (ΔY / (r·H))² = 1
```

也就是一个横竖比 = W/H 的椭圆:16:9 的画布(运行时 1344×756)上水珠横向被
拉长 1.778 倍,看着是扁的.真实水珠接近正圆,水滴形状与折射偏移都必须先把
坐标换成各向同性空间(见 `rust/src/shaders.wgsl` 的 `toIsotropic`/`toUvOffset`)

```text
toIsotropic(uv) = (uv.x * aspect, uv.y)     aspect = 画布宽 / 画布高
toUvOffset(o)   = (o.x / aspect, o.y)       折射偏移要加回 uv 上采样背景
```

- `dropletOffset`/`dropletCoverage`/`cs_refraction` 的 AABB 剔除都用等比空间
  量距离,折射偏移算完再除回 aspect 变回 uv 偏移
- `aspect` 由 `rust/src/app.rs` 初始化时从 `canvas.width / canvas.height` 算出,
  每帧写进 `Uniforms.aspect`;该字段同时把 16 字节的 uniform 结构填满
  (原来是占位的 `_padding`),字段名写错会被 `cargo test` 拦住而不是静默读 0
- 半径随之定义在"画布高度"尺度上:半径 r 的水珠直径 = 2r·H 像素.所以修正
  前后**纵向直径不变,横向从 2r·W 收到 2r·H**:radius 0.006..0.024 在
  1344×756 上由 16.1×9.1 .. 64.5×36.3 px 变成 9.1×9.1 .. 36.3×36.3 px,
  横竖比 1.778 -> 1.000.嫌小就抬 `radius_min`/`radius_span` 或用"水滴大小"滑块
- 画布分辨率是 HTML 上的固定属性(`src/config.ts` 的 CANVAS_WIDTH/HEIGHT),
  没有 resize 路径,所以 aspect 只算一次;以后若要支持 resize/DPR,必须让
  表面配置与 aspect 同步更新

验证方式(软件 Vulkan 实渲):固定随机种子让同一颗水珠跑两次,只把 aspect 切成
1.0(复现旧椭圆)与 W/H(修正后),两次渲染的差异像素应只剩水珠左右两侧的竖直
月牙,即旧椭圆横向多出来的部分(实测 7×23 / 7×28 / 7×25 px,宽高比约 0.3),
纵向一个像素都不变

### 水珠边缘为什么不受低分辨率偏移图影响

折射偏移场可以因式分解成

```text
offset = dir2 * lateralProfile(s) * 半径强度      (见 shaders.wgsl)
```

圆心 `dir2` 在一颗水珠内是常数,`s = dist / radius` 沿半径线性变化,两者都能从
低分辨率图里无损重建;而"最终偏移向量"是随位置快速变化的量,按 1/8 分辨率存进
纹理再双线性放大,会把水珠轮廓上原本圆滑的弧线压成 8 像素一级的方块(实测:
同一颗水珠,旧实现把建物边缘的圆弧挤成矩形,全分辨率参考是圆滑弧线)

所以 `cs_refraction` 只存三个可无损重建的量(通道语义),偏移本身交给
`fs_main` 逐像素解析算:

| 通道 | 含义 |
| --- | --- |
| `r` `g` | 胜出水珠的圆心(uv) |
| `b` | 归一化距离 `s = dist / radius` |
| `a` | 偏移整体大小 `半径 × (1 + 强度 × refraction_strength_per)` |

`fs_main` 用屏幕空间导数 `fwidth(s)` 把轮廓收敛成 1~2 像素的清晰边缘
(`EDGE_AA_SCALE` / `EDGE_AA_MIN`,定义在 shaders.wgsl 顶部),再用
`lateralProfile(s)` 和重建出的圆心方向算出偏移. 结果是

- 边缘清晰度与 `REFRACTION_DOWNSCALE` 解耦:调大只影响"多颗水珠重叠处归谁管"
  的精度,不会再把轮廓压成方块,可以放心用来省 GPU;
- 计算着色器反而更省:低分辨率像素上只做距离比较,斯涅尔数学搬到了片段着色器;
- 片段着色器仍然只采样一次偏移图,没有 64 次循环

实测(软件 Vulkan,同一颗水珠同帧,与全分辨率偏移图的参考渲染比较):
旧实现 1/8 分辨率有 239 个像素偏差(其中 134 个 >60),解析重建后降到 168 个
(71 个 >60);1/4 分辨率时 53 个(13 个 >60)

## 技术栈

- Rust(`wgpu`/`wasm-bindgen`/`png`/`bytemuck`)
- TypeScript(交互层)+ Vite(开发服务器/HMR/构建)
- WGSL 计算着色器 + 渲染管线
- wasm32-unknown-unknown / WebGPU

## 本地验证

```bash
cargo run --package metro-window --example validate_wgsl  # WGSL 语法/校验
cargo run --package metro-window --example native_smoke   # 用软件 Vulkan 实际跑一遍计算+渲染管线
cargo run --package metro-window --example preview        # 用真实城市纹理渲染一帧,输出 preview.png
```

> `cargo test` 的 cwd 是 crate 根,所以可视化 ppm 落在
> `src/metro_window/rust/test_output/`(已 gitignore);`preview` 写出的 `preview.png`
> 落在**调用目录**(`cargo run` 不改 cwd,从仓库根调就落在仓库根,已 gitignore).
> `preview` 读城市贴图用的是编译期注入的绝对路径(`CARGO_MANIFEST_DIR` 向上三级),
> 指向站点静态资源根 `public/metro_window/resource/*.png`,不受 cwd 影响.
> 上面三条都在仓库根执行:workspace 在根(见下),用 `--package metro-window` 指定成员,
> 不需要 `--manifest-path`.

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
| 后来撤掉 `/metro_window/` 独立入口页(`index.html` / `page.ts` / `metro_index.css`),并入站点首页 | 车窗只在首页挂一次;页面级标记(画布,以及可选的标题/副标题)改由 `src/ui/stage_content.ts` 生成(当时叫 `window_content.ts`),宿主只留空容器 `#metro-window` |
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

### 组件拆分:舞台与控制台

首屏要做成"画布铺满视口,导航文字直接压在画面上"(参考 kali.org 那种落地页),
而原来的挂载函数把**舞台**(画布)和**控制台**(设置面板)焊在一次调用里,
面板只能紧跟在画布后面 -- 两者同屏就必然压在画面上.所以按宿主拆成两块:

| 改动 | 为什么 |
| --- | --- |
| `MOUNT_ID` -> `MOUNT_IDS { stage, panel }`;`mountMetroWindow(root)` -> `mountMetroWindow({ stage, panel? })`;`mountMetroWindowAtMountId()` -> `mountMetroWindowAtMountIds()` | 一个页面两个宿主:画布在首屏,设置面板在 SETTING 标签页."面板放哪"从此是站点的决定,组件不再假设两者同屏 |
| `ui/window_content.ts` -> `ui/stage_content.ts`,`createWindowContent()` -> `createStageContent()`;新增 `STAGE_COPY_ENABLED` | 这个文件只管舞台;首屏文案(标题 / 副标题)当前不由组件生成(站名在导航左上角,中央文案待定),但两个字符串仍留在 `config.ts` 里,开关一开就回来 |
| 样式作用域类由挂载函数往**两个**宿主上都补;新增舞台修饰类 `.metro-window--stage` 与隐藏容器 `.metro-panel-sink` | `metro_window.css` 的选择器**全部**以 `.metro-window` 开头:面板换了宿主却没这个类就是"样式静默失效"(看着没坏但全乱);省略面板宿主时退回隐藏容器,面板 / 状态区 / 事件绑定一个都不少 |
| `IntersectionObserver` 明确只观察**舞台** | 面板在别的标签页里,它的可见性不代表画面的可见性,不能拿来当暂停依据 |
| Rust 侧一行未改 | 面板只是换了 DOM 宿主;`startApp(canvas, status)` 要的 `status` 元素在任何宿主里都成立,`setStyle` / `setParam` / `setRunning` / `reset` 仍作用于同一个单例 |
| 风格按钮行从设置面板里拆出来(`createStyleRow()` + `createSettingsPanel(styleRow)`),新增第三个挂载点 `#metro-styles` | 切风格属于"看",和 LED 时钟一起放在首屏底部最顺手;而"参数"属于"调",留在 SETTING.行仍然**只建一份**,由挂载函数决定放哪(给了 `styles` 宿主就挂首屏,没给就留在控制台里),所以两个地方不会各出现一份 |
| 新增"裸宿主"修饰类 `.metro-window--bare`,`.metro-window--stage` 从此只负责"铺满父层" | 首屏里的舞台与风格按钮宿主都不要车窗面板的内边距与底色;两件事拆成两条规则,比一条规则兼两职好读 |
| 后备缓冲从"固定 1344×756"改成"随宿主算的 16:9 × dpr",并给 Rust 加 `resize()` 导出 | 首屏要铺满整屏,还要 1:1 清晰;比例必须锁死 16:9(场景按 uv 铺满画布),所以算的是"覆盖宿主所需的 16:9"而不是宿主本身的形状.`pipelines.rs` 为此把绑定组构造拆成 `create_bind_groups`,`app.rs` 的 `resize` 只重建 surface 配置 / 折射偏移图 / 绑定组,**不重建管线**(重建会重新编译着色器) |
| 新增 `data-state="unavailable"` 回退 | WebGPU 不可用时藏掉画布,露出站点背景并留一句短提示;首屏不再出现"什么都不显示的黑框",完整排查步骤仍只进 SETTING |
| 首屏那两个修饰类的选择器改成**把类名写两遍**(`.metro-window.metro-window--stage`) | 它们与基础规则 `.metro-window canvas` 的特异性打平(都是 0,1,1),而基础规则在后面 -- 结果画布被压回 `max-width: 1600px` + `aspect-ratio: 16/9` + 圆角 + 边框,右边与下边露出宿主背景.多写一个类把特异性抬到 0,2,x,顺序就再也影响不到它 |

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
