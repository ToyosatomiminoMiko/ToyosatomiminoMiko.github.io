# main

`2022.06.11.10:00:00`

&copy; ToyosatomiminoMiko(郝季仁)
本项目基于*DeepSeek*生成的代码(MIT许可)开发

## OLED canvas

在`128*64`的画布上绘图并导出为`uint8_t`数组或PNG.

## Red-Black Tree Lab

读取字符串生成红黑树

## IEEE 754

浮点数位串 / 十进制互转与公式展开.

## 地铁车窗

Rust + WASM + WebGPU 实时渲染的地铁车窗玻璃效果,挂在站点首页 HOME 卡片的
`#metro-window` 空宿主上(挂载见 `src/main.ts`,源码在 `src/metro_window/`).
搬入前它是独立仓库
[metro_window](https://github.com/ToyosatomiminoMiko/metro_window)(上游已归档).

它原来是 **GPL-3.0**,并入本站后整体按本站的 **AGPL-3.0** 走
(作者同一人,子目录不再单独保留一份许可).

源码,架构与迁移记录见 [`src/metro_window/README.md`](src/metro_window/README.md).

## GraphCalc

已拆分为独立仓库:

- 站点: <https://toyosatomiminomiko.github.io/miko_graphcalc/>
- 源码: <https://github.com/ToyosatomiminoMiko/miko_graphcalc>

## 约定

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
| 主站样式 | `public/css/tokens.css` | 站点设计令牌(`:root`):字体栈,调色板,尺寸,圆角,间距,`z-index`,过渡 |
| 主站脚本 | `src/clock.config.ts`,`src/oled.config.ts`,`src/rbt.config.ts`,`src/ieee754.config.ts`,`src/site.config.ts` | LED 时钟字形与配色,OLED 画板尺寸/通道/文案,红黑树布局与配色,IEEE 754 精度格式与掩码,站点级共用值 |
| 4xx 页面样式 | `src/4xx_page/418/418_tokens.css`,`src/4xx_page/451/451_tokens.css`;`404/404.css` 与 `shared/icon.css` 顶部的 `:root` 块 | 各彩蛋页的设计令牌(颜色 / 几何 / 阴影 / 时长 / 字体) |
| 4xx 页面脚本 | `src/4xx_page/418/teapot.config.ts`,`src/4xx_page/451/boot.config.ts`,`src/4xx_page/451/ember/*.config.ts` | 茶壶交互,启动开关,GPU 计时 / 统计 / 资源 / 能力 / 性能面板参数 |
| 地铁车窗前端 | `src/metro_window/web/src/config.ts`,`src/metro_window/web/src/ui/`,`src/metro_window/web/src/tokens.css` | DOM id / class,`data-*` 键名,`setParam` 参数名映射,车窗标记与设置面板的声明式模型(标题/副标题/画布分辨率/滑块分组 / 风格 / 按钮 / 文案);声明式 DOM 组件(`h()` + 车窗标记 + 设置面板);组件设计令牌 |
| 地铁车窗渲染 | `src/metro_window/rust/src/droplet_params.rs`,`app_params.rs`,`render_params.rs`,`random_params.rs`,`texture_params.rs` | 水滴生成 / 物理 / 折射 / 高光,主循环与资源路径,管线与绑定槽位,白噪声哈希,程序化贴图生成参数 |
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
- **DOM id / class / Rust 参数名**是跨语言契约:改动必须两边同时改,
  写错不会报错,只会静默失效,所以它们集中在配置文件里便于对照.
- **设置面板不手写 HTML**:结构与文案由 `src/metro_window/web/src/config.ts` 的
  声明式模型描述,由 `web/src/ui/` 的组件渲染成元素并交回引用;加/改滑块只动配置,
  宿主页(`index.html`)里只有一个空容器 `#metro-window`,不要回去改它.
- 等价性回归网:`cargo test` 与 `vitest` 覆盖参数布局与公式;
  程序化贴图还带 PPM 可视化测试,输出到 `src/metro_window/rust/prompt/`(已 gitignore).

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
不是可选项.wasm 产物(`metro_window/web/pkg/`)与 `metro_window/target/` 不入库,
缺产物时 `npm run dev` 会直接提示跑 `npm run build:wasm`,而不是抛 Vite 的解析错误.
CI 见 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
