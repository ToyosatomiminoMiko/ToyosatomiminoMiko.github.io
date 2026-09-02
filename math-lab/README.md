# math-lab

Math-lab 的当前入口是 `index.html`,它加载 `src/main.ts`,再由
`DslApp` 驱动 `.miko` DSL.

## 数据流

```text
源码 textarea
  -> Rust/WASM 解析器 parse_miko()
  -> AstProgram
  -> DslCompiler.compileScene()
  -> SceneIR
  -> Plotter / CameraManager / DslIntegralRenderer
  -> Three.js 场景
```

## 当前支持范围

- `param`:参数面板与实时刷新
- `curve` / `surface` / `vector_field` / `point` / `vector`:基础几何对象
- `matrix` / `transform`:对象场景变换
- `animation`:单矩阵动画片段,可通过对象 `animation = [...]` 绑定并顺序播放
- `gradient` / `divergence` / `curl`:点分析
- `gradient` 的 `show = [point, normal, tangent_plane]`:已支持
- `integral`:一维/二维数值积分和黎曼/勒贝格可视化,方法为
  `trapezoid`/`simpson`/`lebesgue`,以及黎曼系列 `riemann:left`/
  `riemann:right`/`riemann:mid`;裸写 `riemann` 等价于 `riemann:left`.
  黎曼端点方法只对一维曲线开放,二维曲面黎曼目前只有左端点实现.
- `sphere` / `box` / `cylinder` / `cone` / `frustum`:透明体积图形;
  `cylinder`/`cone`/`frustum` 统一映射为同一个 `conic` IR 类型
- `intersection`:求交.曲线参与的求交得到离散交点,曲面/体积参与的求交得到空间交线;
  支持 曲线∩曲线、曲线∩曲面、曲线∩体积、曲面∩曲面、曲面∩体积、体积∩体积

相机状态不进入 DSL:透视/正交与旋转锁定由右侧 UI 开关控制,
`camera:view` 按钮只负责预设视角.

## 求交

语法:

```text
intersection 名称 = intersection(对象A, 对象B) {
    color = "#ffffff";   // 可选,默认取调色板
    segments = 96;       // 可选,采样分辨率,最大 256
};
```

求交结果自动按组合区分:

- 曲线参与的求交(`intersection(c1, s1)`、`intersection(c1, c2)`、
  `intersection(c1, S)`)渲染为交点;
- 曲面/体积参与的求交(`intersection(s1, s2)`、`intersection(s1, S)`、
  `intersection(S, B)`)渲染为三维交线.

体积对象包括球体、方块和旋转体(圆柱/圆锥/圆台).旋转体的交线包含
侧面与上下底面,和它的数学体积定义一致.求交坐标会计入对象的静态
`transform`,但暂不支持带动画的对象,也不支持 `point` / `vector` /
`vector_field` 参与求交.

示例:

```text
intersection X = intersection(s1, s2) {
    color = "#ffffff";
    segments = 96;
};
```

点对象(例如默认源码开头的 `point P = [0, 0, 0]`)的全局样式由
右侧"视图"面板的"点"区域控制:可在"设定大小"与"按比例缩放"
两种模式间切换(二者是同一控制量的不同表达,切换时保持当前实际
大小不变),并可切换为不可见;设置作用于场景中的所有点对象.

XYZ 坐标轴使用 Three.js Line2 绘制,线宽以像素为单位,
可在右侧"视图"面板中调整(最小 1px).

网格与坐标轴刻度同样使用 Line2 系列绘制:大刻度线粗而亮、
小刻度线细而暗;右侧"视图"面板可分别开关网格/刻度,
并调整大/小刻度线宽.刻度数字与 XYZ 轴标签共用同一字体与
缩放设置,随刻度开关一起显隐;"坐标轴"面板的 X/Y/Z 标签开关
可单独隐藏某条轴的标签,并同时隐藏该轴的刻度数字.网格包含
XZ/XY/YZ 三个坐标平面,各有独立开关,同一行排列.

系数名不限于 `a`/`b`/`c`.只要不是 `sin`/`pi`/`e` 等内置符号,
`k`/`omega`/`theta` 这类标识符都会被识别为自由参数.

角度默认使用弧度,和 `rotate(pi / 4)` 保持一致.需要普通角度时可写
`rotate(deg(180))`;`deg()` 在 Rust 符号归一化阶段展开为 `x * pi / 180`.

## 明确不支持但会报错

- `jacobian`/`laplacian`:解析器接受,编译器会抛出"暂未实现"
- `scalar`/`vector` 张量声明:编译器会抛出"暂未实现"
- 积分源必须引用已存在的 `curve` 或 `surface`

## 构建

项目根目录执行:

```sh
npm run build
```

该命令会依次执行:

1. `npm run clean`:清空旧的 `dist/` 与 `math-lab/src/wasm/`
2. `npm run build:wasm`:分别重建 `src/math/math_rs`/
   `src/compiler/compiler_rs`/`src/render/render_rs`
   三个 Rust crate,并把产物输出到对应的 `src/wasm/*` 目录
3. `npm run typecheck`:执行 `tsc --noEmit`
4. `vite build`

生产/CI 统一入口是根目录的 `bash ./build.sh`:依次执行
`npm ci`、Rust lint、清理旧产物与 WASM 构建、前端/Rust 测试、
前端类型检查与打包,每个阶段都有日志输出;GitHub Actions 只调用这一个
脚本,不再重复编排各步骤.

重新生成wasm

```sh
npm run build:wasm
npm run typecheck
```

## 架构

先说结论:`math-lab` 目前是有架构的,只是它被拆成了四条并行的线——**编译/渲染/异步计算/UI 控制**,最后由一个比较胖的编排器 [DslApp.ts](src/app/DslApp.ts) 缝在一起.你觉得"看不懂",通常是因为同步编译和异步计算/渲染这两条时间线混在一个文件里.

## 一/核心心智模型

源码是唯一真相源.数据从 `textarea` 开始,经过一次编译变成纯数据 `SceneIR`,渲染层只消费这份数据,不反向修改 DSL.

```text
源码 textarea
   │ run()
   ▼
parseMiko()  -> Rust pest 解析 -> AstProgram
   │
   ▼
DslCompiler.compileScene()
   ├─ getOrBuildStaticScene()   // 缓存:params / matrix / transform / animation / blueprint
   ├─ materializeObject()       // 用当前参数生成 SceneObject
   ├─ compileAnalyses()         // gradient / divergence / curl
   ├─ compileIntegralTask()     // integral 任务
   └─ compileIntersections()    // intersection 任务(数值交给 Worker)
   │
   ▼
SceneIR（纯数据,不含 three.js/DOM）
   │
   ├─ Plotter -> 各种 Renderer -> THREE 场景
   ├─ AnalysisRenderer -> 分析可视化
   ├─ DslIntegralRenderer -> 积分计算与可视化
   ├─ IntersectionRenderer -> 求交 Worker 调度与交线渲染
   └─ ParamPanel / ObjectList / Diagnostics
```

关键边界文件:

- [compiler/ast/types.ts](src/compiler/ast/types.ts):解析结果 `AstProgram`
- [compiler/ir/types.ts](src/compiler/ir/types.ts):编译结果 `SceneIR`
- [DslCompiler.ts](src/compiler/dsl/DslCompiler.ts):AST 到 SceneIR 的编排入口
- [SceneStore.ts](src/app/SceneStore.ts):当前会话的 AST/显隐/动画起点等状态
- [CompileController.ts](src/app/CompileController.ts):解析与重新编译的调度
- [RenderController.ts](src/app/RenderController.ts):场景/相机/异步采样编排
- [DslApp.ts](src/app/DslApp.ts):装配层 + rAF 主循环 + 参数刷新入口
- [Plotter.ts](src/render/core/Plotter.ts):对象 id 到渲染器的路由门面
- [MathComputeEngine.ts](src/math/compute/MathComputeEngine.ts):数值计算门面

## 二/一次"运行"的完整过程

`math-lab/index.html` 加载 `src/main.ts`,后者只做:

```ts
new DslApp().start()
```

`DslApp.start()` 会先搭建场景/相机/渲染器/控制器,然后进入每帧渲染循环,最后调用一次 `run()`.

`run()` 做的事情是:

1. DslApp 清空诊断、取消待刷新的参数帧,然后交给 CompileController.
2. CompileController 增加运行序号并异步调用 `parseMiko(editor.value)`
   (Rust pest 解析成 AST);返回后若序号过期或已销毁则直接丢弃.
3. 提交 AST 与 WASM 矩阵后端到 SceneStore.
4. 调用 `compileScene(ast, {}, matrixOps)` 生成 SceneIR.
5. 用 SceneIR 更新参数面板,并交给 RenderController 触发绘制/异步采样.

一次完整运行只解析一次源码.之后拖参数滑块不会重新解析源码,而是复用同一个 `currentAst`.

## 三/参数变化为什么快

滑块变化路径在 [DslApp.ts](src/app/DslApp.ts) 里的 `_scheduleRefresh` / `_refreshObjects`:

```text
滑块 input
   -> requestAnimationFrame 合并多个变化
   -> compileScene(currentAst, paramPanelController.getValues())
   -> renderController.applyScene(scene, changedParams)
   -> 只重绘依赖了这些参数的对象
```

这里有个很重要的机制:对象会携带 `coefficients`,说明它引用了哪些参数.`_objectDependsOnParams` 据此判断哪些对象需要真正重采样;不相关的对象只更新引用,不重新生成几何体.

积分和曲面等重计算也遵循这个规则:只有依赖了变化参数的对象,其关联积分才重新算.

## 四/异步计算链路

这是最容易看漏的部分.编译器产出的是表达式字符串和系数,真正的数值采样在 Web Worker + Rust/WASM 里完成.

| 内容 | 渲染/调用入口 | Worker | Rust/WASM | 返回 |
| --- | --- | --- | --- | --- |
| 曲线采样 | `CurveRenderer` | `curveWorker` | `math_rs.sample_curve` | 顶点数组 |
| 曲面采样 | `SurfaceRenderer` -> `SurfaceMesh` | `surfaceWorker` | `render_rs.sample_and_process_surface` | 位置/颜色/法线/索引 |
| 向量场采样 | `VectorFieldRenderer` | `vectorFieldWorker` | `math_rs.sample_vector_field` | 向量数组 |
| 数值积分 | `DslIntegralRenderer` -> `MathComputeEngine` | `IntegralWorker` | `math_rs.integrate1d/2d` | 积分值/样本 |
| 求交 | `IntersectionRenderer` | `IntersectionWorker` | `math_rs.intersect_pair` | 交点/交线折线 |

这些链路都使用 `LatestRequestExecutor`:同一时间最多一个请求真正在跑,高频拖动滑块时,旧请求会被标记为 `superseded`,只保留最新请求.这是防止 Worker 积压的关键.

求交编译只产出 `IntersectionTask`(引用对象、颜色、segments),数值内核在
`math_rs::intersection_core`;IntersectionRenderer 用任务输入指纹做增量缓存,
参数无关的刷新不重算、只有隐藏求交本身才移除,结果回来后只重建对应任务的
geometry.求交结果按独立求值对象处理:隐藏某个参与面并不会隐藏交线.

## 五/UI 通信:两种方式各有明确边界

- **业务数据(参数/对象列表/诊断/积分结果)**:DslApp 与 RenderController
  直接注入回调,不走 EventBus;调用链在编译/应用代码里就能看清.
- **视图控件(相机/坐标轴/网格/点样式)**:控件 emit `EventBus` 事件,
  RenderController 统一订阅并落到 SceneManager/CameraManager/Plotter.

`service/events.ts` 只保留有真实 emit 点的视图事件键,不再允许
"先声明后接线"的 dead event keys.

另外,曲线/曲面/向量场的 Worker 采样失败现在统一经
`render/core/samplingErrors.ts` 上报,RenderController 转成诊断区错误;
没有"曲线悄悄走主线程兜底、曲面直接消失"的不一致路径.

## 六/为什么你会觉得拿不准

几个当前架构上仍然需要留意的点:

1. **装配层仍然只有一个**  
   DslApp 已经不再持有编译/渲染细节,但页面装配、参数刷新合并、rAF
   主循环仍在它身上;这是有意收敛的编排层,不是领域逻辑.

2. **同步和异步交错**  
   `run()` 是异步解析;`compileScene()` 是同步编译;`applyScene()` 内部
   又会触发异步 Worker 采样.所以从代码顺序看,场景数据已经准备好了,
   但几何体其实稍后才回来.阅读时应把"编译结果"和"采样结果"分成两段时间线.

3. **缓存层比较多**  
   至少有 `staticSceneCache`/`rendererMap`/`LatestRequestExecutor`/
   `taskSequences` 四层缓存/去重,分别解决"声明级建模""GPU 对象复用"
   "高频刷新丢旧任务""过期积分结果丢弃"的问题,均带 `@cache` 注释.

4. **刻意保留的未使用代码都有注释**  
   `SceneStore.objectTransforms` 快照、`IntegralWasm` 的 right/mid 黎曼、
   MATLAB 兼容入口、SceneTransform 高层封装等均为预留能力,文件头或
   声明处注明了保留原因;没有注释的未使用代码按死代码处理.

5. **求交已经走 Rust/Worker**
   数值内核在 `math_rs::intersection_core`(表达式只编译一次、上下文复用),
   编译期只产 `IntersectionTask`,计算由 `IntersectionWorker` 异步执行;
   旧 `IntersectionMath.ts` 已收敛为矩阵求逆与描述符转换的适配层,不再保留
   逐点 WASM FFI 的 TS 演示实现.
