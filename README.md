# main

第一次部署时间`2022.06.11.10:00:00`

$there$ $is$ $nothing$ $to$ $do.$

&copy; ToyosatomiminoMiko(郝季仁)
本项目基于*DeepSeek*生成的代码(MIT许可)开发

## OLED canvas

在`128*64`的画布上绘图并导出为`uint8_t`数组或PNG.

## Red-Black Tree Lab

读取字符串生成红黑树

## IEEE 754

浮点数位串 / 十进制互转与公式展开.

## 地铁车窗

Rust + WASM + WebGPU 实时渲染的地铁车窗玻璃效果,拆成"舞台"与"控制台"两块,
站点给四个空宿主:画布挂 `#metro-window`(HOME 首屏,铺满整屏),三颗风格按钮挂
`#metro-styles`(首屏底部,与 LED 时钟同排),其余设置面板挂 `#metro-params`
(SETTING 标签页),图层贴图上传面板挂它正下方的 `#metro-uploads`.
四个挂载点 id 见 `src/metro_window/src/config.ts` 的
`MOUNT_IDS`;挂载见 `src/main.ts`,源码在 `src/metro_window/`.
搬入前它是独立仓库
[metro_window](https://github.com/ToyosatomiminoMiko/metro_window)(上游已归档).

SETTING 里可以逐层上传替换城市背景那四张 PNG(画师按层分开交付的原素材在
`public/metro_window/resource/`).这条链路**没有后端**:文件不上传服务器,
由浏览器解码成像素后交给 wasm 换掉对应的 GPU 纹理,刷新页面即还原;
机制与约束见 [`src/metro_window/README.md`](src/metro_window/README.md)
的"图层贴图上传"一节.

它原来是 **GPL-3.0**,并入本站后整体按本站的 **AGPL-3.0** 走
(作者同一人,子目录不再单独保留一份许可).

源码,架构与迁移记录见 [`src/metro_window/README.md`](src/metro_window/README.md).

## 首屏与导航条

HOME 标签页的最上面是一块**首屏**(`index.html` 的 `.hero`):视口在页面顶部时,
地铁车窗的画布铺满整个屏幕.它是**首屏**,不是**背景** -- 全站背景仍然是
`body` 上的 `--bg-image-active`(SETTING 里那两张 GIF),首屏只是盖在它上面的区块.

由此带来两条固定结构,改首页时别绕开:

- **导航条脱离文档流**(`header.site-header` 是 `position: fixed`).它要是还占位,
  首屏就只能从它下沿开始,顶部那一条盖不住.代价是它会压在内容上,所以除首屏外
  每个标签页自己用 `padding-top` 让开(见 `public/css/index.css` 的 `.tab-pane`).
- **导航条在首屏上是"隐形"的**:没有底色,没有边框,没有磨砂,只有站名与导航
  文字压在画面上.可读性靠两样东西 -- 首屏自己顶部那条渐变压暗(`.hero__scrim`,
  属于画面,不属于导航条),以及文字投影.滚过首屏或切到别的标签页时它变实底,
  切换逻辑在 `src/common/header_state.ts`(用 `IntersectionObserver` 而不是
  `scroll` 事件;`rootMargin` 从 CSS 令牌 `--nav-height` 读,不在 JS 里再写一遍).
- **首屏满宽是"逃逸"出来的**:`main` 只有 90% 宽,`.hero` 用
  `margin-left/right: calc(50% - 50vw)` 外扩到视口两侧,所以 `body` 上有
  `overflow-x: hidden`(`100vw` 含滚动条宽度,必然溢出一点).
- 画布怎么"覆盖"整屏由组件负责:挂载函数给舞台宿主加
  `.metro-window--bare`(去掉面板的内边距与底色)与 `.metro-window--stage`
  (absolute 铺满父层),画布再用 `object-fit: cover` 缩放进这个盒子.
  注意这两条修饰类的选择器都把类名写了两遍(`.metro-window.metro-window--stage`):
  要压过后面那条 `.metro-window canvas` 的基础规则,靠的就是多出来的那点特异性.
- **后备缓冲跟着视口走,但比例恒为 16:9**:城市层是按 uv 直接铺满画布的,
  画布比例一变整幅场景就被拉伸,所以尺寸取"覆盖宿主所需的 16:9"(见
  `src/metro_window/src/stage_size.ts`,有单测)再乘 dpr -- 覆盖多出来的部分
  由 CSS 裁掉,显示上仍是 1:1 物理像素.尺寸变化由 `ResizeObserver` 观察宿主
  (防抖 150ms),dpr 变化单独用 `matchMedia` 盯(换显示器时宿主尺寸不变).
  Rust 侧的 `resize()` 只重建 surface 配置,折射偏移图与两个绑定组,
  **不重建管线**(重建管线会连带重新编译着色器,拖窗口会卡).
- **WebGPU 不可用时不留黑框**:组件给舞台加 `data-state="unavailable"`,
  样式藏掉画布,首屏露出的就是本站背景(GIF),并留一句短提示;
  完整排查步骤仍然只进 SETTING 的状态区.

## GraphCalc

已拆分为独立仓库:

- 站点: <https://toyosatomiminomiko.github.io/miko_graphcalc/>
- 源码: <https://github.com/ToyosatomiminoMiko/miko_graphcalc>

## 约定

- **`src/` 下按域分目录,不散放在根上**:每个控件/子项目一个目录
  (`clock/`,`oled/`,`rbt/`,`ieee754/`,`4xx_page/`,`metro_window/`),
  跨域复用的公共函数与站点级常量放 `src/common/`;根上只留
  `main.ts`(入口)与 `vite_env.d.ts`(Vite 全局模块声明).
  每个目录里 `index.ts` 是薄入口,可调常量在 `config.ts`(或 `*_tokens.css`),
  类型在 `types.ts`,实现细节收进 `ui/` 之类的子目录.
- **跨目录导入一律用源码根别名 `@/`**:`@/common/utils`,`@/clock/config`,
  `@/4xx_page/shared/icon`;只有同目录的兄弟模块才写 `./x`.
  别名一处定义,两处生效:`vite.config.ts` 的 `resolve.alias` 与
  `tsconfig.json` 的 `paths`(改一处必须同步另一处).
  HTML 里的 `<link>`/`<script>` 不用别名,写相对站点根的 `/src/4xx_page/...`.
- **文件名不用 `-`,一律 `_`**.唯一不能改的是工具写死的两个:
  `package-lock.json`(npm)和 `.githooks/pre-commit`(git 钩子名).
  第三方包路径里的连字符(如 `@fontsource/inter/latin-400.css`)不在此列.
- **HTML 里不写 CSS**:不放内联样式块,也不用 `style=` 属性;
  样式一律进 `.css` 文件,由 `<link>` 或 TS `import` 引入.
- **静态资源只有 `public/` 一处**:不参与打包,按原 URL 直接访问的文件
  (图片 / 图标 / 样式表 / 地铁车窗运行时贴图)全部放在这棵树下,
  路径即线上 URL(站点 Vite 只有一个 `publicDir`);不要再给子项目另建 `public/`,
  那需要额外插件在 dev 重写,在 build 手动 emit.参与打包的资源走 TS `import`.

## 配置(常量)在哪 / 怎么维护

所有"可调常量"都已从代码里抽出,按作用域集中到**配置文件 / 令牌文件**;
业务代码只引用具名常量,不再出现魔法数字与裸色值.调参时只改下面对应的文件.

| 作用域 | 配置文件 | 放什么 |
| --- | --- | --- |
| 主站样式 | `public/css/tokens.css` | 站点设计令牌(`:root`):字体栈,调色板,尺寸,圆角,间距,`z-index`,过渡;首屏(`--hero-*`)与固定导航条(`--chrome-*`) |
| 主站脚本 | `src/clock/config.ts`,`src/oled/config.ts`,`src/rbt/config.ts`,`src/ieee754/config.ts`,`src/common/site.config.ts` | LED 时钟字形与配色,OLED 画板尺寸/通道/文案,红黑树布局与配色,IEEE 754 精度格式与掩码,站点级共用值(含首屏 id / 导航条选择器与 `is-over-hero` 类名 / `--nav-height` 令牌名) |
| 4xx 页面样式 | `src/4xx_page/418/418_tokens.css`,`src/4xx_page/451/451_tokens.css`;`404/404.css` 与 `shared/icon.css` 顶部的 `:root` 块 | 各彩蛋页的设计令牌(颜色 / 几何 / 阴影 / 时长 / 字体) |
| 4xx 页面脚本 | `src/4xx_page/418/teapot/config.ts`,`src/4xx_page/451/boot.config.ts`,`src/4xx_page/451/ember/*.config.ts` | 茶壶交互,启动开关,GPU 计时 / 统计 / 资源 / 能力 / 性能面板参数 |
| 地铁车窗前端 | `src/metro_window/src/config.ts`,`src/metro_window/src/stage_size.ts`,`src/metro_window/src/ui/`,`src/metro_window/src/tokens.css` | DOM id / class / `data-*` 键名,`setParam` 参数名映射,车窗标记 / 设置面板 / 上传图层的声明式模型(画布分辨率 / 滑块分组 / 风格 / 按钮 / 可上传贴图清单 / 文案),后备缓冲尺寸与防抖 / dpr 上限;声明式 DOM 组件(`h()` + 舞台标记 + 风格按钮行 + 设置面板 + 上传面板 + PNG 解码);组件设计令牌 |
| 地铁车窗渲染 | `src/metro_window/rust/src/droplet_params.rs`,`app_params.rs`,`render_params.rs`,`random_params.rs`,`texture_params.rs` | 水滴生成 / 物理 / 折射 / 高光,主循环与资源路径 / 可上传材质槽位白名单,管线与绑定槽位 / 上传纹理尺寸上限,白噪声哈希,程序化贴图生成参数 |
| 构建 | `vite.config.ts` | 多页入口,4xx 产物路径回移前缀 |

维护要点:

- **CSS** 一律用自定义属性引用(`var(--x)`);令牌命名 `--<域>-<类别>-<名>`,
  定义只允许出现在令牌文件里,选择器里不得再写死色值 / 尺寸.
  另外 `@media` 条件里不能写 `var()`,断点只能留字面量(已在注释中说明).
- **TS** 用 `export const`(对象 / 数组加 `as const`),每个常量都带中文注释
  (含义 + 单位).配置模块只放声明式数据,不放可变模块状态.
- **Rust** 按域拆成 `*_params.rs`.凡是 Rust 与 WGSL 共用的字段,绑定槽位与入口点,
  都由单测校验两边文本一致(只改一边会让 `cargo test` 失败);
  水滴参数更进一步:WGSL 里的 `struct DropletParams` 由 Rust 的
  `DropletParams::WGSL_DECL` 生成后注入,不存在两边各写一份.
- **水滴形状必须按画布宽高比换算**:uv 是 [0,1]²,直接量 `length(Δuv)` 会把
  正圆拉成 W/H 倍的椭圆.判定统一走 `shaders.wgsl` 的 `toIsotropic`,
  比值由 `uniforms.rs` 的 `Uniforms.aspect` 每帧传入(半径语义/验证方法见
  `src/metro_window/README.md` 的"水滴为什么是正圆").
- **折射偏移不在低分辨率图上存"最终向量"**:低分辨率图只存圆心 / 归一化距离 /
  偏移大小这三个可无损重建的量,偏移由 `fs_main` 逐像素解析算出,否则水珠轮廓会
  被压成 1/8 分辨率一级的方块(见 `src/metro_window/README.md` 的
  "水珠边缘为什么不受低分辨率偏移图影响").
- **DOM id / class / Rust 参数名**是跨语言契约:改动必须两边同时改,
  写错不会报错,只会静默失效,所以它们集中在配置文件里便于对照.
- **设置面板不手写 HTML**:结构与文案由 `src/metro_window/src/config.ts` 的
  声明式模型描述,由 `src/metro_window/src/ui/` 的组件渲染成元素并交回引用;
  加/改滑块只动配置,
  宿主页(`index.html`)里只有四个空容器(`#metro-window` 舞台 /
  `#metro-styles` 风格按钮 / `#metro-params` 控制台 / `#metro-uploads` 上传面板),
  不要回去改它们.
  面板放在哪个标签页由挂载点决定,样式作用域类由挂载函数往每个宿主上补,
  组件本身不关心位置.
- 等价性回归网:`cargo test` 与 `vitest` 覆盖参数布局与公式;
  程序化贴图还带 PPM 可视化测试,输出到 `src/metro_window/rust/test_output/`(已 gitignore).

## 构建

```bash
./build.sh          # 完整构建:检查工具链 -> npm ci -> 跑流水线
npm run build:all   # 跳过依赖安装,只跑流水线
npm run dev         # 开发服务器 http://127.0.0.1:5173
npm run preview     # 预览 dist/
```

步骤序列定义在 `package.json` 的 `build:all`(单一事实源):

```text
lint:rs -> clean -> build:wasm -> test(vitest) -> test:rs(cargo) -> build:app
```

`build:app` = `check:wasm` + `tsc --noEmit` + `vite build`.

工具链:`node` / `npm`,以及 **`cargo` / `rustc` + `wasm32-unknown-unknown`** --
地铁车窗是 Rust->wasm 的,前端入口静态 import 它的产物,所以 Rust 是构建期硬依赖,
不是可选项.仓库根有一份 `Cargo.toml`,它是**整个仓库的 cargo workspace**
(成员目前只有地铁车窗的 crate,以后新增 Rust 直接往 `members` 里加):`Cargo.lock`
与构建缓存 `target/` 都在仓库根,所有 crate 共用,`cargo test` / `cargo clippy`
等命令在仓库根直接跑 `--workspace` 即可,不必 cd 进子目录.
wasm 产物(`src/metro_window/pkg/`)与 `target/` 不入库,
缺产物时 `npm run dev` 会直接提示跑 `npm run build:wasm`,而不是抛 Vite 的解析错误.
CI 见 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
