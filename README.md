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

Rust + WASM + WebGPU 实时渲染的地铁车窗玻璃效果(窗外城市多层视差 + 玻璃污渍 +
冷凝雾气 + 车厢灯光与倒影,外加三套风格调色),拆成"舞台"与"控制台"两块,
站点给四个空宿主:画布挂 `#metro-window`(HOME 首屏,铺满整屏),三颗风格按钮挂
`#metro-styles`(首屏底部,与 LED 时钟同排),其余设置面板挂 `#metro-params`
(SETTING 标签页),图层贴图上传面板挂它正下方的 `#metro-uploads`.
四个挂载点 id 见 `src/metro_window/src/config.ts` 的
`MOUNT_IDS`;挂载见 `src/main.ts`,源码在 `src/metro_window/`.
搬入前它是独立仓库
[metro_window](https://github.com/ToyosatomiminoMiko/metro_window)(上游已归档).

车窗里的**水珠(雨滴)效果已经拆出去**成一个自包含的可运行 demo,目录名是
`water_droplet_demo/`,但**它已经整体移出本仓库单独维护**(不再随本站一起构建):
单张背景图 + 水珠物理 / 折射 / 高光 / 背景景深,带自己的 Rust crate,
前端工程与构建脚本,放在任意位置都能独立构建运行.两边的代码互不引用.

SETTING 里可以逐层上传替换城市背景那四张 PNG(画师按层分开交付的原素材在
`public/metro_window/resource/`,文件名 `level_0.png` ~ `level_3.png`,
编号由近到远:`level_0` 最近,`level_3` 是最远的背景).这条链路**没有后端**:
文件不上传服务器,由浏览器解码成像素后交给 wasm 换掉对应的 GPU 纹理,
刷新页面即还原;机制与约束见
[`src/metro_window/README.md`](src/metro_window/README.md)
的"图层贴图上传"一节.

它原来是 **GPL-3.0**,并入本站后整体按本站的 **AGPL-3.0** 走
(作者同一人,子目录不再单独保留一份许可).

源码,架构与迁移记录见 [`src/metro_window/README.md`](src/metro_window/README.md).

## 首屏与导航条

HOME 标签页的最上面是一块**首屏**(`.hero`,由 `src/common/ui/site_shell.ts` 生成):
视口在页面顶部时,地铁车窗的画布铺满整个屏幕.它是**首屏**,不是**背景** -- 全站背景仍然是
`body` 上的 `--bg-image-active`(SETTING 里那两张 GIF),首屏只是盖在它上面的区块.

由此带来两条固定结构,改首页时别绕开:

- **导航条脱离文档流**(`header.site-header` 是 `position: fixed`).它要是还占位,
  首屏就只能从它下沿开始,顶部那一条盖不住.代价是它会压在内容上,所以除首屏外
  每个标签页自己用 `padding-top` 让开(见 `public/css/index.css` 的 `.tab-pane`).
- **导航条在"底下没有内容"时是"隐形"的**:没有底色,没有边框,没有磨砂,只有
  站名与导航文字.两种情形算"底下没有内容" -- 首屏还压在它下面(HOME,可读性靠
  首屏自己顶部那条渐变压暗 `.hero__scrim`,属于画面,不属于导航条,以及文字投影),
  以及**任何标签页停在页面顶端时**(窗格顶部用 `padding-top` 让开了导航条,内容
  还在导航条下沿以下,底下只有全站背景图).内容一滑到导航条下面(滚过首屏,
  或者在别的标签页滚动)它立刻变实底.切换逻辑在 `src/common/header_state.ts`:
  首屏那条用 `IntersectionObserver` 而不是 `scroll` 事件(`rootMargin` 从 CSS 令牌
  `--nav-height` 读,不在 JS 里再写一遍),"页面在不在顶端"那条直接读 `scrollY`
  (读它不触发重排,滚动事件本身已按帧合并).
- **首屏满宽是"逃逸"出来的**:`main` 只有 90% 宽,`.hero` 用
  `margin-left/right: calc(50% - 50vw)` 外扩到视口两侧,所以 `body` 上有
  `overflow-x: hidden`(`100vw` 含滚动条宽度,必然溢出一点).
- **头像挂在 `header` 上,不在标签栏 `ul.nav-tabs` 里**:那个 `ul` 为了窄窗口
  横向滑动是 `overflow-x: auto` 的滚动容器,而滚动容器的 padding box 就是裁剪区 --
  头像排在里面,hover 辉光会被裁成方块(位置靠 `.head-link` 的负 margin 找回来).
  同理辉光只能用 `box-shadow`,不能用 `filter: drop-shadow()`:`head.png` 是不带
  透明通道的方形位图,`drop-shadow` 取的是位图自己的 alpha 通道,画出来是方影子;
  `box-shadow` 跟着 `border-radius` 画,才是圆的.两条都在 `public/css/index.css`
  (`.head` / `.head-link`),结构那半有回归断言
  (`src/common/ui/site_shell.test.ts`).
- **首屏的结构与每个模块的宿主都在 `src/common/site.config.ts` 里声明**
  (`HERO_ID` / `HERO_*_CLASS` / `SITE_HOST_IDS`),由 `src/common/ui/site_shell.ts`
  生成并把元素引用交回 `src/main.ts`.要动首屏布局就改这两处 -- `index.html` 里
  只有骨架宿主,没有第二处标记可改(见[「UI 在哪里」](#ui-在哪里)).
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

## UI 在哪里

首页的整套 UI(导航条 / 首屏 / 五个标签页 / 各模块面板)**没有一行写在
`index.html` 里**:HTML 只有骨架宿主 `<div id="site-root"></div>`.
这条约定是从地铁车窗控制台推广开来的,现在全站统一:

```text
config.ts        声明式模型:文案 / 类名 / DOM 契约 id / 几何 / 清单(纯数据,无副作用)
ui/*.ts          纯函数组件:模型 -> 元素,并交回行为代码要用的元素引用
<模块>.ts         挂载函数 mount<模块>(host):插进宿主 + 绑事件,不回头查 DOM
site_shell.ts    先生成整页骨架(导航条 / 首屏 / 五个窗格 / 所有空宿主),把引用交回
main.ts          按顺序调用:骨架 -> 各模块 -> 行为
```

| 想改什么 | 去哪 |
| --- | --- |
| 站名 / 标签栏 / 头像 / 首屏结构 / 标签页清单 | `src/common/site.config.ts`(`NAV_ITEMS` / `SITE_BRAND_TEXT` / `AVATAR_*` / `HERO_*`),骨架代码在 `src/common/ui/site_shell.ts` |
| 背景缩略图(加一张图 / 换名字) | `src/common/site.config.ts` 的 `BACKGROUND_PRESETS`,标记在 `src/common/ui/background_section.ts`(两颗按钮在一行 flex 里并排,每颗都是库的按钮,缩略图在按钮里面) |
| SETTING 页的面板 / 标题 | `src/common/site.config.ts` 的 `SETTING_PANEL_TITLE`(标题"设置");框体由 miko_ui 的 `createPanel` 建(`section.ui-panel`),结构与外观都在库(`styles/widgets.css`),面板结构在 `src/common/ui/site_shell.ts` |
| LED 时钟的画布尺寸 / 时间戳格式 | `src/clock/config.ts`;标记在 `src/clock/ui/clock_display.ts`;绘制在 `src/clock/clock.ts` |
| OLED 画板的按钮 / 文案 / 提示 | `src/oled/config.ts`,面板标记在 `src/oled/ui/oled_panel.ts` |
| 红黑树的提示文案 / 画布尺寸 / 占位符 | `src/rbt/config.ts`,面板标记在 `src/rbt/ui/rbt_panel.ts` |
| IEEE 754 的标签 / 精度菜单项 / 初值 | `src/ieee754/config.ts`,面板标记在 `src/ieee754/ui/ieee754_panel.ts` |
| 地铁车窗的滑块 / 风格按钮 / 上传图层 | `src/metro_window/src/config.ts`,面板在 `src/metro_window/src/ui/`(见它自己的 README) |
| 导航条"隐形 / 实底"(首屏,各标签页),背景切换 | `src/common/header_state.ts` / `src/common/background.ts`(行为),令牌与类名在 `src/common/site.config.ts` |
| 样式 | `public/css/*.css`;选择器按**类名与 id** 命中(config.ts 里的 id 契约),不依赖结构位置 |

几条硬约束:

- **标记一律用库的 `create_element`**(`miko_ui`):站点不再养自己的 DOM 原语,
  模块里也不要写 `document.createElement` / `setAttribute` / `append` -- 例外只有
  "必须拿原生 API"的场合(离屏 canvas 做像素操作,KaTeX 渲染结果),这类都会在
  代码里注明.属性值必须是 string(数字要 `String(...)`),`null` / `undefined` /
  `false` 子节点会被跳过.
- **宿主只提供空位**:每个模块的宿主都是空容器,标记全部由组件生成.
  宿主页不出现任何面板标记,所以"改了 HTML 但忘了改组件"这种失配不存在.
  挂载函数对**自己独占**的宿主用 `replaceChildren` 整体接管(重复挂载不会插两份,
  OLED / RBT / IEEE754 / 时钟都是这样);地铁车窗例外 -- 它的一个宿主可以同时
  接收设置面板与上传面板(省略上传宿主时),所以那边是 `append`.
- **不按 id 回头查 DOM**:骨架与组件都把元素引用直接交回来.唯一的 id 查找是
  骨架找自己的宿主 `#site-root`,拿到了就往下传,后面再没有任何 `getElementById`.
- **id 仍然重要**:它是 CSS 与调试定位的锚点,集中写在 `config.ts` 里;
  改 id 要同步 `public/css/*.css`(写错不会报错,只会静默失效).
- **组件不写页面级选择器**:`body { margin: 0 }` 这类规则属于站点的
  `public/css/index.css`,组件样式只作用在自己的作用域类下(地铁车窗是
  `.metro-window`,其余模块用库的面板框体 `.ui-panel` + 自己的类名).
- **修饰类由挂载函数补**:组件的样式作用域类不写在 HTML 里(骨架不替组件记约定),
  宿主换了位置照样能命中.

**这套结构的回归网分两层**(都在 `*.test.ts` 那一层能抓到的,就不放到浏览器里):

| 层 | 跑什么 | 在哪 |
| --- | --- | --- |
| 标记契约 + 行为(进程内) | 生成的标签 / 类名 / id / 文案与 CSS 是否对得上;标签页的点击 / 方向键 / 显隐状态迁移对不对 | `src/**/*.test.ts`,文件头 `@vitest-environment happy-dom`,进 `npm test`(不需要 build,CI 里也跑) |
| 真浏览器验收 | canvas 真的画出来了吗,五个窗格真的只有一个可见吗,布局与 CSS 级联对不对,导航条隐形/实底的翻转对不对,宿主与车窗组件接上了吗 | `npm run smoke:home`(要 `dist/` 与 chromium,见[「构建」](#构建)) |

加/改 UI 之后:`npm test` 跑第一层;涉及渲染/交互/样式的改动再跑一次 `smoke:home`.

## GraphCalc

已拆分为独立仓库:

- 站点: <https://toyosatomiminomiko.github.io/miko_graphcalc/>
- 源码: <https://github.com/ToyosatomiminoMiko/miko_graphcalc>

## 约定

- **`src/` 下按域分目录,不散放在根上**:每个控件/子项目一个目录
  (`clock/`,`oled/`,`rbt/`,`ieee754/`,`4xx_page/`,`metro_window/`),
  跨域复用的公共函数与站点级常量放 `src/common/`;根上只留
  `main.ts`(入口)与 `vite_env.d.ts`(Vite 全局模块声明).
  每个目录里 `config.ts` 是**声明式模型 + 可调常量**(或 `*_tokens.css`),
  纯标记组件收进 `ui/`,类型在 `types.ts`,实现细节与行为留在目录根的那个模块文件里.
- **首页的 UI 全部"声明式编排"**(与地铁车窗控制台同一套做法):宿主页
  `index.html` 只有一个空位 `#site-root`,骨架由 `src/common/ui/site_shell.ts` 按
  `src/common/site.config.ts` 的模型生成;每个模块的挂载函数签名统一是
  `mount<模块>(host: HTMLElement)` -- 往宿主里长标记,再拿组件交回的**元素引用**
  绑行为,**不按 id 回头查 DOM**.标记只由库的 `create_element`(`miko_ui`)构造,
  站点没有自己的 DOM 原语.详见[「UI 在哪里」](#ui-在哪里).
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
| 主站脚本 | `src/clock/config.ts`,`src/oled/config.ts`,`src/rbt/config.ts`,`src/ieee754/config.ts`,`src/common/site.config.ts` | LED 时钟字形与配色,OLED 画板尺寸/通道/文案,红黑树布局与配色,IEEE 754 精度格式与掩码,站点级声明式模型(导航项 / 首屏结构 / SETTING 整页面板的类名与标题 / 背景缩略图行 / 各模块宿主 id / `is-over-hero` 类名 / `--nav-height` 令牌名) |
| 首页骨架 | `src/common/ui/site_shell.ts`,`src/common/ui/background_section.ts` | 骨架(含 SETTING 那面站点面板)与背景缩略图两块声明式组件(标记用库的 `create_element`;每块缩略图 tile 整块是库的 `createButton`) |
| 主站行为 | `src/main.ts`,`src/common/header_state.ts`,`src/common/background.ts` | 挂载顺序(骨架 -> 各模块 -> 行为),导航条"隐形 / 实底"状态(首屏还压在它下面时,以及任何标签页停在页面顶端时),背景切换令牌写入 |
| 4xx 页面样式 | `src/4xx_page/418/418_tokens.css`,`src/4xx_page/451/451_tokens.css`;`404/404.css` 与 `shared/icon.css` 顶部的 `:root` 块 | 各彩蛋页的设计令牌(颜色 / 几何 / 阴影 / 时长 / 字体) |
| 4xx 页面脚本 | `src/4xx_page/418/teapot/config.ts`,`src/4xx_page/451/boot.config.ts`,`src/4xx_page/451/ember/*.config.ts` | 茶壶交互,启动开关,GPU 计时 / 统计 / 资源 / 能力 / 性能面板参数 |
| 地铁车窗前端 | `src/metro_window/src/config.ts`,`src/metro_window/src/stage_size.ts`,`src/metro_window/src/ui/`,`src/metro_window/src/tokens.css` | DOM id / class / `data-*` 键名,`setParam` 参数名映射,车窗标记 / 设置面板 / 上传图层的声明式模型(画布分辨率 / 滑块分组 / 风格 / 按钮 / 可上传贴图清单 / 文案),后备缓冲尺寸与防抖 / dpr 上限;声明式 DOM 组件(库的 `create_element` + 舞台标记 + 风格按钮行 + 设置面板 + 上传面板 + PNG 解码);组件设计令牌.**单个滑块(名称 + 滑杆 + 数值框 + 重置按钮)不在这里**:它是 UI 库 `miko_ui` 的 `createSlider`,本站只把声明翻译成它的选项(见下一行) |
| UI 库 | npm 包 `miko_ui`(声明在 `package.json`);配色与宽度在 `src/metro_window/src/metro_window.css` | 通用控件(滑块 / 按钮 / 开关 / 分段 / 数值框 / **折叠菜单** ...)与它们的样式.**全站标记的唯一原语**也是库的 `create_element`(站点没有自己的 DOM 原语);站内**所有按钮**都由库的 `createButton` 生成(基线类 `.ui-button`),本站不再写按钮外观;IEEE754 的精度选择是库的 `createMenu`(触发按钮 + `.menu-popover` 浮层,本站只给数据与一个 `.menu-anchor` 锚点);OLED 数据区那颗输入框也整颗是库的 `createCodeEditor`(`.code-editor`:行号槽 + 真 textarea + 高亮层,导出与导入共用这一颗),本站只注入 id / 槽宽下限 / 高亮函数;库的默认主题由 `src/main.ts` 引 `miko_ui/styles/tokens.css` 接进来.四块面板的框体是库的 `createPanel`(`section.ui-panel` + 标题栏 + 正文容器,与桌面窗口同源).**面板框体是本轮新加进库的**:`package.json` / `package-lock.json` 仍钉在 npm 上那一版,所以**库发版并把依赖 bump 到含 `createPanel` 的版本之前,CI / Pages 会缺这个导出**(本地走 `dev_ui_link` 的符号链接不受影响).本地联调与依赖契约见 [`scripts/dev_ui_link.py`](scripts/dev_ui_link.py) 顶部 |
| 地铁车窗渲染 | `src/metro_window/rust/src/droplet_params.rs`,`app_params.rs`,`render_params.rs`,`random_params.rs`,`texture_params.rs` | 水滴生成 / 物理 / 折射 / 高光,主循环与资源路径 / 可上传材质槽位白名单,管线与绑定槽位 / 上传纹理尺寸上限,白噪声哈希,程序化贴图生成参数 |
| 构建 | `vite.config.ts` | 多页入口,4xx 产物路径回移前缀,`miko_ui` 的运行期依赖(`katex` / `@preact/signals-core`)去重(`resolve.dedupe`) |
| 依赖来源 | `package.json`(`"miko_ui": "^0.1.6"`),`scripts/dev_ui_link.py` | 前端第三方 UI 库从 npm registry 装;改库时本地联调用 `bash scripts/dev_ui_link.sh` 把 `node_modules/miko_ui` 换成指向工作副本的符号链接(只动 `node_modules/`) |

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
- **UI 标记不手写 HTML**:首页的每一个模块都是"config 里的声明式模型 ->
  `ui/` 里的纯函数组件 -> 挂载函数往宿主里插 + 绑事件"三段式.
  加一个背景缩略图只往 `BACKGROUND_PRESETS` 加一条,换 OLED 的一句提示只改
  `src/oled/config.ts`;`index.html` 里没有第二处标记要同步.
  完整约定(含目录地图与"加东西改哪里")见[「UI 在哪里」](#ui-在哪里).
- **按钮只在库那边写**:站内(OLED / IEEE754 / 地铁车窗)的每一颗按钮都由
  `miko_ui` 的 `createButton` 生成,基线类 `.ui-button` 与全部外观(描边
  `1px solid var(--color-border-strong)` / 底色 / 文字 / 悬停 / 焦点 / 禁用)都在库的
  `styles/widgets.css`;本站的组件只补 id / `data-*` / 激活态类,样式表里不再出现
  按钮的描边 / 底色 / 文字规则.原先是 bootstrap 的 `.btn.btn-primary`,已撤掉.
  要改按钮长相就改库,不在下游给它的节点补类名.

  **库的按钮基线用 `:where(.ui-button)` 写(特异性 0),所以在 bootstrap 还在时
  一直被 reboot 的 `button { font-size: inherit; line-height: inherit }` 压着** --
  按钮实际上吃的是 body 的 16px / 1.5,而不是库给的 12px / 1.2.移除 bootstrap 之后
  库的默认值才真正生效(按钮变小,`appearance: none` 生效),这是预期内的观感变化:
  库拥有按钮外观,现在没有第三方规则插在中间了.

  **一组选项也不自己拼**:OLED 的三个绘图工具由库的 `createSegmented` 生成
  (`div.segmented` + 组内按钮,单选),不再是 `input[name="tools"]` 那组 radio;
  本站只把 `OLED_PANEL_TOOL_OPTIONS` 原样喂进去,并用句柄的 `onChange` 接选中.

  **输入框也整颗交出去**:OLED 数据区那颗输入框由库的 `createCodeEditor`
  生成(`div.code-editor`:行号槽 + 真 textarea + 背后高亮层),本站不再自己写
  `textarea` 的宽度 / 底色 / 边框 / 等宽字体,也不碰行号对齐与滚动同步
  (原先那条 `.textarea-data` 只留下定高 `150px` 与可纵向拖动).**导出与导入共用
  这一颗**:导出的源码本身就是 `0x??` 形式,导入正则原样能解析回来,所以
  "导出 -> 改 / 粘 -> 导入"一个缓冲就够(复制 / 导入两颗按钮也随之从数据区
  上移到 `.tools`,与"导出数据"相邻).三个本站侧的决定:
  库要求消费者注入"源码 -> 高亮 HTML"的函数,本站不做词法分析,只转义
  `&` / `<` / `>`(见 `src/oled/ui/oled_panel.ts` 的 `highlightSource`),要高亮
  C 源码只换这一个函数;行号槽宽度钉成常量(库按字体量的内联值被 `!important`
  压住,见 `src/oled/config.ts` 的 `OLED_PANEL_EDITOR_GUTTER_WIDTH`),免得
  1 位行号(刚粘贴)与 2 位行号(导出的 67 行)之间忽宽忽窄;
  唯一会滚的 textarea 挂库的 `.ui-scrollbar`,滚动条走
  `miko_ui/styles/scrollbar.css`.程序化写值(导出数据)之后要调句柄的
  `refresh()`,否则行号栏与高亮层不知道 `.value` 变了.**折叠 / 展开**也归本站:
  折叠态高度 = `--oled-editor-height`(150px,同时也是外框的 `min-height`,手动
  拖动拖不到更矮),展开态 = `--oled-editor-expanded-height`(1366px = 70 行,
  算式在 `public/css/tokens.css`),`.tools` 里那颗"展开 / 折叠编辑器"按钮只切
  外框上的 `is-expanded` 类并同步按钮文案与 `aria-expanded`.

  **唯一的两处例外**都不是"另造一套":地铁车窗风格按钮的"当前项"
  (`.metro-window button.active`)与 `<input type="file">` 的原生
  `::file-selector-button`(伪元素拿不到库的类),两者的描边 / 文字都**只引库的
  令牌**(`--color-border-strong` / `--color-accent-border` / `--color-text-muted`
  / `--radius-*`),不引 `--metro-color-*`;圆角也全部走库主题(库默认 0px),
  本站不再自己存圆角尺寸,也不再用 bootstrap 的圆角工具类(背景缩略图原来的
  `.rounded` 已撤,圆角写在 `.bgimg` 里引 `--radius-sm`).
- **面板框体归 miko_ui**:OLED / RBT / IEEE754 三块面板与 SETTING 整页都用库的
  `createPanel`(`section.ui-panel > header.ui-panel-header > span.ui-panel-title`
  + `div.ui-panel-body`),外观在库的 `styles/widgets.css`;桌面窗口复用同一组
  `.ui-panel*` 基类(`window = panel + 几何/拖动`),两边不会各写一份框体.
  本站只给标题文案与作用域类(如 `.oled-card` 定宽),不再有面板类名常量.
  这一层原先走过两站:bootstrap 的 `.card` 三件套(靠 `body .card` 覆盖
  `--bs-card-*` 变量染暗)-> 站点自研的 `.panel` 三件套 -> 现在收进库.
- **IEEE754 顶部那一行 + 头像圆形也是站点自研**:那一行从 bootstrap 的
  `.row.g-3` 栅格与 `.form-control` / `.input-group` 换成站点的 `.ieee-controls*` /
  `.ieee-input-group` / `.ieee-input`(观感引库令牌);头像的圆形从 `.rounded-circle`
  收回 `.head` 的 `border-radius`.
- **RBT 唯一一处结构变化**:提示区原先夹在标题栏与正文之间,框体归库之后正文只有
  一个入口,提示区移进了 `.ui-panel-body` 最前(其余面板结构不变).
- **bootstrap 已整包移除**.原先最后一处 bootstrap 用法是标签页
  (`.nav-tabs` / `.nav-item` / `.nav-link` / `.tab-pane` 与 `data-bs-toggle="tab"`
  的 data-api),现在由 `src/common/tabs.ts` 自己实现:点击 /
  方向键与 Home / End / roving tabindex / ARIA 角色,以及"先 `.active` 上屏,
  下一帧再补 `.show`"的淡入时序.`package.json` 与 `package-lock.json` 里不再有它,
  标记里也不再有任何 `data-bs-*` 属性.`nav-tabs` / `nav-link` / `tab-pane` /
  `fade` 这套类名是当年抄 bootstrap 的名字,现在由本站样式与 `tabs.ts` 独家使用.

  随之而来的是**一整套文档基线改由本站负责** -- 它们原先由 bootstrap 的 reboot
  提供,而 reboot 是元素级规则(特异性高过站点的 `*` 重置),所以一直在生效.
  现在写在 `public/css/index.css` 的"文档基线"一节里:
  `box-sizing: border-box`,`html { color-scheme: dark }`,`body` 的底色 / 正文色 /
  行距 / **绝对字号**,链接的默认外观,`img` / `svg` 的 `vertical-align`,
  `sub` / `sup` 的取值,`fieldset { min-width: 0 }`,`legend` 的块级排版,
  `code` 的字体与字号;再加上标签栏的 `display: flex` + `list-style: none` 与
  窗格的 `display: none / block` + 淡入(原先是 bootstrap 的 `.nav` / `.tab-content`
  规则给的).

  这些规则**必须留着**,而且少一条都是**静默**的版式崩坏(五个窗格同时堆叠,
  导航栏塌成竖排带项目符号的列表,全站盒模型反转,整页露出白底),不会有任何报错.
  两条踩过的坑记在这里:
  `body` 的字号必须写成**绝对长度**(`1rem`)-- 否则 Chrome 会对通用等宽族
  (站内的 `--font-mono` 正是 generic `monospace`)取自己的等宽默认字号 13px,
  而不是 16px,坐标读数与行高会一起变小;
  `fieldset { min-width: 0 }` 是地铁车窗控制台那两个 fieldset 作为 flex 子项
  肯不肯收缩的前提.
- 等价性回归网:`cargo test` 与 `vitest` 覆盖参数布局与公式;
  首页**生成的标记**由 `src/**/ui/*.test.ts` 在 happy-dom 里逐条断言(进 `npm test`);
  真浏览器那层只剩"必须真渲染"的部分(`npm run smoke:home`);
  程序化贴图还带 PPM 可视化测试,输出到 `src/metro_window/rust/test_output/`(已 gitignore).

## 构建

```bash
./build.sh             # 完整构建:检查工具链 -> npm ci -> 跑流水线(本机默认用本地 miko_ui 工作副本)
./build.sh --ui npm    # 同上,但用 npm 上发布的那一版 miko_ui(CI / 发布走这条)
npm run build:all      # 跳过依赖安装,只跑流水线
npm run dev            # 开发服务器 http://127.0.0.1:5173
npm run preview        # 预览 dist/
npm run smoke:home     # 真浏览器结构验收(需要先 build,见下)
npm run perf:451       # 451 页的性能测试台
```

步骤序列定义在 `package.json` 的 `build:all`(单一事实源):

```text
lint:rs -> clean -> build:wasm -> test(vitest) -> test:rs(cargo) -> build:app
```

`build:app` = `check:wasm` + `tsc --noEmit` + `vite build`.

`bash ./build.sh` 只是个壳(逻辑在 `scripts/build.py`,参数与环境变量语义见
`bash ./build.sh --help`):它做三件事 -- 装锁定依赖,决定这次用哪份 `miko_ui`,
调用 `npm run build:all`.**预览与生产产物都从这个入口出**:CI 与发布走的也是
`bash ./build.sh`(deploy.yml 里显式带 `--ui npm`);`npm run build`(= `build:all`)
只是"跳过装依赖,也不重新选 UI 源"的流水线快捷方式,不是发布入口.
和 miko_graphcalc 同一套口径:

- 本机不带参数时默认用**本地工作副本**(`../__projects_web/miko_ui`,用
  `MIKO_UI_DIR` 覆盖):先用库自己的 `npm run build:dist` 重建它的 `dist/`,再把
  `node_modules/miko_ui` 换成指向副本的符号链接,所以构建完直接跑 `npx vite`
  看到的就是本地库.链接只存在于 `node_modules/`(gitignore),
  `package.json` / `package-lock.json` 一个字节都不动.
- CI / 发布带 `--ui npm`:按 lock 装,并把 `miko_ui` 对齐到 npm 的 `latest`
  (`MIKO_UI_SYNC=auto`,想要"落后就失败"用 `check`,想严格按 lock 用 `off`).
  CI 里显式要 `local` 会被直接拒绝,不会把未发布的副本构建出去.
- 只想链接 / 还原 / 看当前解析到哪一份(不必跑整条流水线)时用
  `bash scripts/dev_ui_link.sh link|unlink|status`;`npm ci` 或
  `bash ./build.sh --ui npm` 也能还原成 npm 版.

**`npm run smoke:home` 不在流水线里**:它要 `dist/` 与一个 `chromium-browser`,
做法是起静态服务器 + headless Chromium,只验那些**进程内 DOM 做不到**的事
(canvas 真的点出像素 / 树真的画出红节点 / 点标签页真的切窗格 / 时钟真的每秒
重绘 / 精度菜单真的能开合 / `getComputedStyle` 下的布局 / 骨架交回的宿主真的
被地铁车窗组件接上).
类名,id,`data-*`,文案这些**结构契约**已经搬进 `npm test` 的 happy-dom 单测,
所以这条命令只需在动到渲染,交互,样式时跑.第一次跑它就抓到过 `data-*` 属性
写法不合规范,导致整个骨架挂不上这类问题.用法与边界见脚本头部注释.
`scripts/smoke_home.mjs` 与 `scripts/perf/451.mjs` 是脚本目录里仅有的两个 Node
脚本:它们靠 Node 自带的全局 `WebSocket` 直连 CDP,换语言得自己维护一个 WebSocket
客户端,不划算;其余脚本(build / link / wasm / 标点修正)都是 Python.

工具链:`node` / `npm`,`python3`(构建脚本与 git 钩子),以及
**`cargo` / `rustc` + `wasm32-unknown-unknown`** --
地铁车窗是 Rust->wasm 的,前端入口静态 import 它的产物,所以 Rust 是构建期硬依赖,
不是可选项.仓库根有一份 `Cargo.toml`,它是**整个仓库的 cargo workspace**
(成员目前只有地铁车窗的 crate,以后新增 Rust 直接往 `members` 里加):`Cargo.lock`
与构建缓存 `target/` 都在仓库根,所有 crate 共用,`cargo test` / `cargo clippy`
等命令在仓库根直接跑 `--workspace` 即可,不必 cd 进子目录.
wasm 产物(`src/metro_window/wasm/`)与 `target/` 不入库,
缺产物时 `npm run dev` 会直接提示跑 `npm run build:wasm`,而不是抛 Vite 的解析错误.
`build:wasm` / `check:wasm` 分别由 `scripts/build_wasm.py` / `scripts/check_wasm.py`
实现,wasm-bindgen CLI 的版本从 `Cargo.lock` 解析,不符时装到
`src/metro_window/.cargo-tools/`,不污染全局.

前端那条**第三方 UI 库**依赖是通用控件(地铁车窗的参数滑块就是库的 `createSlider`:
名称 + 滑杆 + 数值框 + **重置按钮**),来自 npm 上的 `miko_ui` 包
(<https://github.com/ToyosatomiminoMiko/miko_ui>):

- `package.json` 里一条 `"miko_ui": "^0.1.6"`,`npm ci` 直接从 registry 装好,
  **没有** submodule / 本地 `file:` 依赖 / 需要预先下载的资产,所以 CI 不需要
  任何额外凭据或步骤.库的发布流程(CI 检查,打 tag,npm 发版)在库自己的仓库里.
- 样式走库的 exports 子路径:站点引 `import 'miko_ui/styles/tokens.css'`(库的默认
  主题,控件读的 `--color-*` / `--radius-*` 都在这一层),
  `import 'miko_ui/styles/widgets.css'`(控件结构)与
  `import 'miko_ui/styles/editor.css'`(OLED 数据区那颗 `createCodeEditor`(导出与导入共用)的
  外框 / 行号槽 / 高亮叠层)与 `import 'miko_ui/styles/scrollbar.css'`(编辑器里
  唯一会滚的 textarea 挂了库的 `.ui-scrollbar`);库的运行时依赖
  `@preact/signals-core` 与可选 peer `katex` 由本站根 `package.json` **自己声明**
  (本站也直接用它们),`vite.config.ts` 的 `resolve.dedupe` 是第二道保险,保证
  全程只有一份实例.
- **改库的时候**不要在这里塞补丁:去库的工作副本改,用
  `bash scripts/dev_ui_link.sh link` 本地联调(`node_modules/miko_ui` 变成符号链接,
  库的 `styles/` 改完零构建立即生效,`src/` 要先进库的 `dist/`);改完发版,这里
  再 `npm install miko_ui@latest` 跟上.链接状态一律不进版本库.

CI 见 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
