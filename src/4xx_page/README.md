# HTTP 状态页 · 418 / 451 / 404

三个状态码彩蛋页,源码放在 `src/4xx_page/`(与主页的 `src/*.ts` 分开),
构建产物仍然挂在站点的 `/4xx_page/` 下:

- `418.html` -- 我是茶壶(HTCPCP/1.0),茶壶表情 + 拒绝咖啡交互
- `451.html` -- 纸的燃点 / 法律原因不可用,背景是上升的余烬粒子
- `404.html` -- 纯 SVG 的 404

## 跑起来

这三个页面现在是 Vite 的多页入口(`vite.config.ts` 里的 `rollupOptions.input`),
所以**没有独立的服务器脚本**了,用仓库根目录的常用命令即可:

```bash
npm run dev        # 开发服务器, 访问 /4xx_page/451.html 或 /4xx_page/418.html
npm run build      # 完整流水线: clean -> vitest -> tsc -> vite build
npm run preview    # 预览 dist/ 里的产物
```

开发服务器上 `/4xx_page/*.html` 是能直接访问的 -- `vite.config.ts` 里的
`fourXXPage()` 插件会把该前缀重写到 `src/4xx_page/*.html`,让开发地址和
线上地址保持一致.

> 构建时同一个插件负责把 `dist/src/4xx_page/*.html` 挪回 `dist/4xx_page/*.html`
> (Vite 的 HTML 产物路径 = 源文件相对 root 的路径,所以不挪的话会多出一层 `src/`).
> 这样做安全,是因为 `base` 是 `/`,HTML 里的资源引用本来就是绝对路径.

## 依赖策略: 页面本身零 CDN

改造前每个页面都要向两个第三方 CDN 发请求;现在构建产物里没有任何外部请求:

| 原来是 | 现在 |
| --- | --- |
| Google Fonts CSS(4 个字体族 12 个字重) | `@fontsource/*` npm 包自托管,`@import` 进页面 CSS,由 Vite 打包并加 hash |
| Font Awesome 6 CDN(约 100KB CSS + 一整套 webfont) | 页面内联的 SVG sprite(`<symbol>` + `<use href="#i-xxx">`),依赖被彻底去掉 |
| 浏览器全局的 WebGPU 类型 | TypeScript 7 的 `lib.dom` 已经带了全部 WebGPU 接口,只差 5 个常量对象,见 `webgpu_constants.d.ts`;因此不需要 `@webgpu/types` |

字重与原来 `<link>` 里请求的完全一致,没有增删:

- 418:Comic Neue 400/700 + Quicksand 400/600/700
- 451:Inter 300/400/600/800/900 + Space Mono 400/700

只取了 `latin` 子集 -- 这几款字体都没有 CJK 字形,页面里的中文本来就落回系统字体.

> 图标 sprite 的图形取自 Font Awesome Free 7.3.1(Icons: CC BY 4.0,
> <https://fontawesome.com/license/free>),只保留了页面实际用到的 17 个.
> 顺带修掉一个老问题:原来的 `fa-mug-tea` 在页面加载的 Font Awesome 6.0.0-beta3
> 里并不存在,一直是渲染空白,现在统一用 `mug-saucer`.

## 451 的粒子: 已从 CPU 搬到 WebGPU

原来的实现是每帧在 `<canvas>` 上用 Canvas2D 画 180 颗粒子,每颗都要
`createRadialGradient()` + 两次 `arc()` + 一次全屏 `fillRect()`,再叠一层
`globalCompositeOperation='lighter'` 的烟雾循环 -- 帧率越高越烫 CPU,在
高 DPI 屏上尤其明显.

现在全部交给 GPU,主线程每帧只写 32 字节 uniform:

| 原来是 CPU 做的 | 现在 |
| --- | --- |
| 180 × `createRadialGradient()` | 片元着色器里的径向衰减 |
| 180 × `arc()` + `fill()` | 一次 instanced draw(1 粒子 = 1 实例 = 6 顶点) |
| 每帧全屏 `fillRect('rgba(5,2,1,0.2)')` 做拖尾 | 片元着色器里按 `dt` 指数衰减,alpha 通道同步衰减 |
| 每帧全屏 `lighter` 烟雾循环 | 大颗粒在同一个片元里多叠一圈柔光 |
| JS 里 `Math.random()` 更新每个粒子 | compute shader 更新,粒子状态常驻显存 |

实测(Chromium + 软件光栅,1920×1080):
**10 秒窗口内主线程 ScriptDuration 约 18ms**(约 1.8ms/秒),
仿真推进约 3.9s,180 颗粒子全部在动.也就是说主线程基本不再参与粒子工作,
CPU 占用与"屏幕上多少粒子"彻底解耦了.

> 但这个数字**回答不了"机箱为什么烫"**.粒子和合成都跑在 GPU 上,主线程本来就该是空的;
> 真正烧机器的是 **合成 / 光栅**, 而它不出现在 ScriptDuration 里.带着这个教训往下看
> "性能打点"和"实测: 风扇是怎么停下来的"两节 -- 当时页面 8fps,主线程只占 1.4%,
> 整棵 Chromium 进程树却吃满了 12 个核.

### 性能打点

`451/ember/` 里有一套常驻的轻量打点, 刻意把"主线程"和"GPU/合成器"两侧分开记:

| 打点项 | 来源 | 怎么用 |
| --- | --- | --- |
| `interval` / `fps` | rAF 时间戳 | 帧间隔被拉长 ⇒ 瓶颈在 GPU/合成器 |
| `cpu` | 每帧录制前后夹 `performance.now()` | 写 uniform + 录制 + 提交的主线程耗时 |
| `cpuShare` | 两者之比 | **最关键**: 接近 0 就说明再优化 JS 也没用 |
| `steps` | 定步长时钟 | 补步(> 1)说明在掉帧 |
| GPU 三条 pass 耗时 | `timestamp-query` | compute / particle / composite 各花多少 |

怎么看:

```text
451.html?perf=1              左上角出现 HUD, 同时每秒往控制台打一条摘要
window.__emberStats()        结构化快照(可直接 console.table)
window.__emberReport()       一行摘要字符串
<html data-ember-fps="...">    供自动化脚本直接读
```

GPU 计时依赖适配器的 `timestamp-query` 特性: 有就自动开, 没有就自动关, 不会影响绘制.
少数软件适配器(swiftshader / lavapipe)会一直交回全 0 的时间戳, 这时显示"不可测",
而不是伪装成 `0.00ms`.

### 实测: 风扇是怎么停下来的

环境: Chromium 152 headless + 软件光栅(swiftshader/lavapipe), 800×600, 每档 6 秒窗口,
指标是"整棵 Chromium 进程树的 CPU 秒 / 产出帧数"(每帧工作量, 与帧率高低无关).

改造前, 逐条关掉再看:

| 场景 | fps | CPU 秒/帧 | 说明 |
| --- | --- | --- | --- |
| 原样 | 8.0 | 1.65 | 主线程只占 1.4%, 进程树吃满 ~12 核 |
| 只停粒子画布 | 8.4 | 1.56 | 粒子只占 ~5% |
| 只关 `backdrop-filter` | 9.1 | 1.35 | ~18% |
| 只关全部 CSS 动画 | 12.2 | 1.05 | ~36% |
| **只关卡片的边框呼吸** | **60** | **0.13** | **一条动画 = 85%** |
| 全关(近静态页) | 34.1 | 0.34 | |

也就是说: **主线程几乎空转, 粒子只占 5%, 真正烧掉 12 个核的是 CSS.**

罪魁是 `.card` 上那条 `cardGlow` 关键帧 -- 它在改 `border-color`, 而边框一变,
整张卡片都要重画一遍, 包括那条 `0 30px 50px` 的模糊投影.关掉它一条, 页面就从
8fps 直接跑满 60fps.其余几条动画(改 `filter: blur()` 的 `borderBurn`,0.15s 一次的
`textFlicker`,带 `drop-shadow` 的 `flickerFlame`)是同一类问题, 只是量级小些.

于是这一轮改了三件事:

1. **拿掉压在动态 canvas 上的全部 `backdrop-filter`** (`.hero` 整屏 2px + `.card` 12px
   - badge/tagline/description), 用略厚的半透明底色补回通透感.
2. **把所有无限动画改成"合成器友好"的形式**: `cardGlow` 取消(呼吸交给底光的 opacity),
   `borderBurn`/`textFlicker`/`flickerFlame` 只动 `opacity`/`transform`, 模糊与投影都改静态;
   渐变流动(`fireGradient`)保留, 但用 `will-change: transform` 单独给它一层,
   否则它的 `background-position` 重绘会连带整张卡片一起重栅格化(实测 0.74s -> 0.13s).
3. **引擎侧**: 主循环加 `MAX_FPS` 上限(高刷屏上不必为装饰性粒子跑满刷新率),
   `prefers-reduced-motion` 时降到 30fps, 并且不再逐帧读 `clientWidth`(那是强制布局),
   改成 `ResizeObserver` 事件驱动.

改造后同一个测试台:

| 场景 | fps | CPU 秒/帧 |
| --- | --- | --- |
| 原样 | **60** | **0.13** |
| 只关全部 CSS 动画 | 60 | 0.09 |
| 全关(近静态页) | 60 | 0.04 |
| `about:blank`(地板) | 60 | 0.00 |

每帧工作量降到原来的 **1/12.7**, 帧率从 8 涨到 60(该环境 rAF 上限就是 60Hz),
而且剩下的开销里已经没有明显的"单点大头": 动画全关只再省 0.04.

> 说清楚两件事: 一是这套数字来自**软件光栅**, 绝对值比真实 GPU 高得多,
> 但归因(谁占大头)是可信的 -- 另一个方向的证据是主线程始终只占 1~7%.
> 二是 `MAX_FPS` 上限在这里**测不出收益**: headless 的 rAF 本身就是 60Hz
> (`about:blank` 也正好 60fps), 它只是为 120/144/240Hz 屏准备的保险.

这套测试台就在仓库里, 可以随时复现:

```bash
npm run build
npm run perf:451                                  # 跑全部场景
npm run perf:451 -- baseline no-anim no-backdrop  # 只跑关心的几档
WIN=420,300 npm run perf:451                      # 换窗口尺寸
```

脚本在 `scripts/perf/451.mjs`, 起 headless Chromium(软件 Vulkan)+ CDP 采样.
它刻意不拿主线程 `ScriptDuration` 当结论 -- 那正是当初看漏病根的原因.

### 改 451 的 CSS 前: 三条硬约束

1. **不要在动态 canvas 上盖 `backdrop-filter`.** 它每帧都要重算模糊, hero 铺满视口时
   就是"每帧模糊整屏".实测占每帧 18%, 而且视觉上几乎看不出来.
2. **不要给大元素做"绘制属性"动画.** `border-color` / `background-position` /
   `box-shadow` / `filter` / `text-shadow` 都会让元素按帧重栅格化, 而且会把它周围
   (卡片 + 几十像素的模糊投影)一起拖下水.优先 `opacity` / `transform`;
   确实要动绘制属性时, 用 `will-change` 把它隔离成独立合成层.
3. **装饰性无限动画要按"永远不停机"来算成本.** 页面上同时挂着 4 条 `infinite` 动画时,
   浏览器永远不会进入静止状态 -- CPU/GPU 也就永远不会降下来.

### WebGPU 起不来就不画

这是刻意的:没有降级到 Canvas2D / WebGL.

`451/boot.ts` 里 `ember.init()` 返回 `false` 时,直接 `canvas.remove()`,
页面上不会留一块空画布,`.ash-overlay` 的静态暖色渐变仍然保留,
卡片本身的 CSS 发光动画也不受影响.会走到这一步的情况:

- 浏览器不支持 WebGPU(`navigator.gpu` 不存在)
- `requestAdapter()` 返回 `null`(Linux 上常见,Chromium 需要
  `--enable-unsafe-webgpu` / `--enable-features=Vulkan`,Firefox 需要
  `dom.webgpu.enabled`;不少发行版默认关着)
- `requestDevice()` 失败,着色器编译失败,渲染管线校验失败
- 设备中途丢失(`device.lost`)
- 初始化超过 8 秒没返回(个别驱动会卡住)

结果会写到 `<html data-ember="...">` 上,便于排查:

| `data-ember` | 含义 |
| --- | --- |
| `running` | 正常,GPU 粒子在跑(`data-ember-detail` 是离屏纹理格式) |
| `unavailable` | 放弃绘制,画布已移除(`data-ember-detail` 是原因) |
| `disabled` | 被开关主动关掉 |

控制台会有 `[451/ember] ...` 的说明日志;`window.__ember` 是引擎实例
(`window.__ember.dispose()` 可手动停掉).

### 调试 / 降载开关

在 `451/index.ts` 之前插入一段普通 `script` 即可(或者用地址栏参数):

```html
<script>window.__emberDisabled = true;</script>          <!-- 完全不画 -->
<script>window.__emberOptions = { particleCount: 64 };</script>
<script>window.__emberOptions = { initTimeoutMs: 20000 };</script>
```

- `451.html?nogpu=1` -- 临时关掉粒子
- `451.html?perf=1` -- 打开性能 HUD + 控制台摘要
- `451/ember/config.ts` 里的 `MAX_DPR`(默认 1.5),`MAX_PIXELS`(默认 260 万),
  `MAX_FPS`(默认 60)用来压高 DPI 屏的填充率与刷新率;性能吃紧时先调这三个

## 文件结构

```text
404.html                    404 页(纯 SVG, 无脚本)
418.html                    418 页的标记 + 内联图标 sprite
451.html                    451 页的标记 + 内联图标 sprite

shared/                     418 / 451 共用
  icon.css                    .icon 基础规则 + .icon-sprite(sprite 宿主)
  icon.ts                     icon() -> <use href="#i-..."> 片段(JS 动态拼 HTML 时用)

404/                        404 页
  404.css                     纯 SVG 的居中/发光/底色

418/                        茶壶页
  index.ts                    入口: 挂载交互
  teapot.ts                   茶壶交互(只导出 mountTeapot)
  418.css

451/                        451 页
  index.ts                    入口(薄): 起引擎
  boot.ts                     启动 / 超时 / 降级 / data-ember 上报 / window.* 开关
  window.d.ts                 window.__ember* 的类型
  451.css
  ember/                      粒子引擎(对外只暴露 index.ts)
    index.ts                    EmberWebGPU 门面: 生命周期 + 每帧录制命令 + 帧率上限
    config.ts                   调参常量(FIXED_DT / MAX_DPR / MAX_PIXELS / MAX_FPS ...)
    frame_clock.ts              固定步长时钟(纯逻辑, 有单测)
    viewport.ts                 逻辑/物理像素尺寸计算(纯函数, 有单测)
    pointer_wind.ts             指针风场状态机(纯逻辑, 有单测)
    stats.ts                    帧统计(帧间隔/主线程耗时/GPU 耗时 的环形缓冲, 有单测)
    gpu_timing.ts               timestamp-query 打点(可选, 拿不到就自动关)
    perf_overlay.ts             ?perf=1 时的屏幕 HUD
    capabilities.ts             申请适配器/设备 + 挑离屏纹理格式
    pipelines.ts                着色器模块 / 三条管线 / bind group layout / 采样器
    resources.ts                粒子缓冲(含 CPU 播种) + 两张乒乓历史纹理
    resources.test.ts           Particle 结构布局守卫(TS 下标 vs WGSL 对齐, 有单测)
    shader_sources.ts           `?raw` 导入 4 个 .wgsl(打包器耦合只在这里)
    log.ts                      统一日志前缀
    webgpu_constants.d.ts       补 lib.dom 缺的 WebGPU 常量与 writeTimestamp
    shaders/*.wgsl              公共 / 仿真 / 绘制 / 合成 四段 WGSL
```

几条约定:

- **引擎只从 `ember/index.ts` 进出**.`config` / `pipelines` / `resources` 这些都是
  实现细节,`boot.ts` 只认 `EmberWebGPU` 这一个名字.
- **纯逻辑单独成文件**:定步长(`frame_clock`),尺寸换算(`viewport`),指针风
  (`pointer_wind`)都不碰 DOM,因此有单测;`viewport` 只要求对象上有
  `clientWidth/clientHeight`,不需要真的传一个 canvas.
- **入口文件保持薄**:`418/index.ts` 只调 `mountTeapot()`,`451/index.ts` 只调
  `startEmber()`;逻辑都在被调用的模块里,import 本身不产生副作用.
- **`?raw` 只出现在 `shader_sources.ts`**:换个打包器只需要改这一个文件.

着色器是**真正的 `.wgsl` 文件**,由 `shader_sources.ts` 用 Vite 的
`import source from './x.wgsl?raw'` 按文本导入.之前的 `*.wgsl.js`
(把 WGSL 塞进 JS 模板字符串)就是为了绕开浏览器对模块脚本的严格 MIME 校验,
有了打包器之后这层包装可以整块删掉;改着色器直接改 `.wgsl` 即可.

> `418.html` / `451.html` / `404.html` 之所以留在 `src/4xx_page/` 这一层而不是收进
> 各自的子目录,是因为它们的公开地址是 `/4xx_page/451.html`,而 Vite 的 HTML 产物
> 路径 = 源文件相对 root 的路径;留在这一层才能让 `./451/451.css` 这类相对引用在
> dev 和 build 下含义一致.详见 `vite.config.ts` 里 `fourXXPage()` 的注释.

### 改完 451 的着色器后

开发服务器会热更新;如果看的是 `dist/` 里的产物,记得重新 `npm run build`.

## 实现要点

- **粒子的活动范围(按屏高给,不是写死秒数)**:每颗粒子重生时先摇出一个
  60~140 px/s 的"巡航上升速度",再按 `寿命 = 目标行程 / 巡航速度` 反推寿命,
  而目标行程取 1.0~1.6 个屏高.下限取 1.0 是关键 -- 连最慢的火星也能升到
  画面顶部,稳态下整屏都有粒子;上限大于 1 让一部分能飘出顶部再消失.
  纵向阻力也从 2.6/s 降到 0.8/s(原来几百毫秒就把初速拖光, 稳态只剩 ~23px/s).

  > 这里踩过两个坑, 都是"看着像参数太小, 其实是 bug":
  > ① `PARTICLE_STRIDE` 曾写成 48, 而 WGSL 里 `color` 是 `vec3<f32>`(对齐 16),
  > 真实结构是 64 字节 -- 缓冲开小了 1/4, `arrayLength` 只有 135, 声明的 180
  > 颗里有 45 颗根本没跑, 而且 CPU 播种数据整片错位. 现在有布局单测兜底
  > (`ember/resources.test.ts`).
  > ② `init()` 里那句 `resize()` 会连带走一次 `reseedParticleStore()`, 把
  > `createParticleStore()` 精心铺满整屏的初始状态全部丢到屏幕下方 --
  > 于是刚打开页面时画面是空的, 要等好几秒才慢慢升满. 首次定尺寸现在跳过 reseed.
- **固定步长仿真**:`dt` 恒为 1/60,掉帧最多补 2 步,120Hz 屏和 60Hz 屏
  看到的余烬速度一致,不会因为高刷屏跑得飞快.
- **拖尾(注意: 当前实现是坏的)**:设计上,粒子 pass 每帧 `loadOp: 'clear'` 清成透明黑,
  片元着色器把上一帧按 `pow(0.868, dt*60)` 衰减后加回,alpha 一起衰减,于是得到指数拖尾.
  但 `loadOp: 'clear'` 恰好把"上一帧"清掉了 -- 混合的目标 dst 全是 0,
  那句 `fade * keep` 其实什么都没加;而 `composite` 绑定的又是**另一张**纹理
  (`readIndex`),屏幕上看到的只是上一帧的粒子.净效果是:两张乒乓纹理 + 一次全屏 clear
  - 一次全屏合成, 目前只起到了"延迟一帧显示"的作用, 拖尾并不存在.

  > 这一轮只做性能改造, 没有动这段逻辑, 但把坑标出来.要修的话二选一:
  > ① 粒子 pass 里显式采样 `historyViews[readIndex]`, 把衰减算进颜色,
  > 同时让 composite 读 `writeIndex`;② 去掉离屏与合成 pass, 直接画到 canvas
  > (放弃拖尾, 但省掉两次全屏操作).
- **指针风场**:鼠标/触摸位置作为推力,越近推得越开,停手 140ms 后自然衰减回 0.
- **坐标单位**:仿真用逻辑像素 + 秒,着色器里乘 `dpr` 换算物理像素,
  所以窗口缩放后粒子位置不会错位.
- **尺寸变化**:窗口变化超过 2px 才重建离屏纹理(移动端地址栏收放不会狂建),
  重建时粒子重置到底部重生带;首次定尺寸除外(见上,不能把初始铺满的状态冲掉).
