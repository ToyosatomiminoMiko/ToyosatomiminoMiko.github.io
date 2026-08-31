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
  `trapezoid`/`simpson`/`riemann`/`lebesgue`
- `sphere` / `box` / `cylinder` / `cone` / `frustum`:透明体积图形;
  `cylinder`/`cone`/`frustum` 统一映射为同一个 `conic` IR 类型

相机状态不进入 DSL:透视/正交与旋转锁定由右侧 UI 开关控制,
`camera:view` 按钮只负责预设视角.

点对象(例如默认源码开头的 `point P = [0, 0, 0]`)的全局样式由
右侧"视图"面板的"点"区域控制:可在"设定大小"与"按比例缩放"
两种模式间切换(二者是同一控制量的不同表达,切换时保持当前实际
大小不变),并可切换为不可见;设置作用于场景中的所有点对象.

XYZ 坐标轴使用 Three.js Line2 绘制,线宽以像素为单位,
可在右侧"视图"面板中调整(最小 1px).

网格与坐标轴刻度同样使用 Line2 系列绘制:大刻度线粗而亮、
小刻度线细而暗;右侧"视图"面板可分别开关网格/刻度,
并调整大/小刻度线宽.

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

1. `npm run build:wasm`:分别重建 `src/math/math_rs`/
   `src/compiler/compiler_rs`/`src/render/render_rs`
   三个 Rust crate,并把产物输出到对应的 `src/wasm/*` 目录
2. `npm run typecheck`:执行 `tsc --noEmit`
3. `vite build`

也可以使用根目录的 `bash ./build.sh`,它现在等同于 `npm run build`.

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
parseMiko()  → Rust pest 解析 → AstProgram
   │
   ▼
DslCompiler.compileScene()
   ├─ getOrBuildStaticScene()   // 缓存:params / matrix / transform / animation / blueprint
   ├─ materializeObject()       // 用当前参数生成 SceneObject
   ├─ compileAnalyses()         // gradient / divergence / curl
   └─ compileIntegralTask()     // integral
   │
   ▼
SceneIR（纯数据,不含 three.js/DOM）
   │
   ├─ Plotter → 各种 Renderer → THREE 场景
   ├─ AnalysisRenderer → 分析可视化
   ├─ DslIntegralRenderer → 积分计算与可视化
   └─ ParamPanel / ObjectList / Diagnostics
```

关键边界文件:

- [compiler/ast/types.ts](src/compiler/ast/types.ts):解析结果 `AstProgram`
- [compiler/ir/types.ts](src/compiler/ir/types.ts):编译结果 `SceneIR`
- [DslCompiler.ts](src/compiler/dsl/DslCompiler.ts):AST 到 SceneIR 的编排入口
- [Plotter.ts](src/render/core/Plotter.ts):对象 id 到渲染器的路由门面
- [MathComputeEngine.ts](src/math/compute/MathComputeEngine.ts):数值计算门面

## 二/一次"运行"的完整过程

`math-lab/index.html` 加载 `src/main.ts`,后者只做:

```ts
new DslApp().start()
```

`DslApp.start()` 会先搭建场景/相机/渲染器/控制器,然后进入每帧渲染循环,最后调用一次 `run()`.

`run()` 做的事情是:

1. 清空诊断信息,增加一个运行序号,防止旧任务回写结果.
2. 异步调用 `parseMiko(editor.value)`,由 Rust pest 解析成 AST.
3. 创建 WASM 矩阵运算后端,配置动画播放器.
4. 保存当前 `currentAst`.
5. 调用 `compileScene(ast, {}, matrixOps)` 生成 SceneIR.
6. 用 SceneIR 更新参数面板/绘图/分析/积分和对象列表.

一次完整运行只解析一次源码.之后拖参数滑块不会重新解析源码,而是复用同一个 `currentAst`.

## 三/参数变化为什么快

滑块变化路径在 [DslApp.ts](src/app/DslApp.ts) 里的 `_scheduleRefresh` / `_refreshObjects`:

```text
滑块 input
   → requestAnimationFrame 合并多个变化
   → compileScene(currentAst, paramPanelController.getValues())
   → _applyScene(scene, changedParams)
   → 只重绘依赖了这些参数的对象
```

这里有个很重要的机制:对象会携带 `coefficients`,说明它引用了哪些参数.`_objectDependsOnParams` 据此判断哪些对象需要真正重采样;不相关的对象只更新引用,不重新生成几何体.

积分和曲面等重计算也遵循这个规则:只有依赖了变化参数的对象,其关联积分才重新算.

## 四/异步计算链路

这是最容易看漏的部分.编译器产出的是表达式字符串和系数,真正的数值采样在 Web Worker + Rust/WASM 里完成.

| 内容 | 渲染/调用入口 | Worker | Rust/WASM | 返回 |
| --- | --- | --- | --- | --- |
| 曲线采样 | `CurveRenderer` | `curveWorker` | `math_rs.sample_curve` | 顶点数组 |
| 曲面采样 | `SurfaceRenderer` → `SurfaceMesh` | `surfaceWorker` | `render_rs.sample_and_process_surface` | 位置/颜色/法线/索引 |
| 向量场采样 | `VectorFieldRenderer` | `vectorFieldWorker` | `math_rs.sample_vector_field` | 向量数组 |
| 数值积分 | `DslIntegralRenderer` → `MathComputeEngine` | `IntegralWorker` | `math_rs.integrate1d/2d` | 积分值/样本 |

这些链路都使用 `LatestRequestExecutor`:同一时间最多一个请求真正在跑,高频拖动滑块时,旧请求会被标记为 `superseded`,只保留最新请求.这是防止 Worker 积压的关键.

## 五/UI 通信的两套风格

这也是造成"架构感不统一"的来源:

- **参数/对象列表/诊断信息**:DslApp 直接传回调给控制器,例如 `ParamPanelController`/`ObjectListController`.
- **相机控制**:通过 `EventBus` 发事件,DslApp 订阅后调用 `CameraManager`.

也就是说,`EventBus` 并不是全局统一通信层.它目前只实际承载相机事件;`coefficient:changed`/`selection:changed` 虽然在类型里声明了,但当前没有 emit,属于半遗留状态.

## 六/为什么你会觉得拿不准

几个当前架构上确实容易让人困惑的点:

1. **DslApp 过胖**  
   它同时负责生命周期/源码状态/可见性状态/动画状态/编译调度/UI 回调,概念很多但都挤在一个类里.

2. **同步和异步交错**  
   `run()` 是异步解析;`compileScene()` 是同步编译;`_applyScene()` 内部又会触发异步 Worker 采样.所以从代码顺序看,场景数据已经准备好了,但几何体其实稍后才回来.

3. **缓存层比较多**  
   至少有 `staticSceneCache`/`rendererMap`/`LatestRequestExecutor`/`taskSequences` 四层缓存/去重.它们分别解决不同问题,但一眼扫过去确实显得复杂.

4. **有少量疑似遗留代码**  
   例如 `DslApp.objectTransforms` 字段被反复赋值,但当前没有地方真正读取;`SurfaceMeshWasm.ts` 目前看起来也没有被运行路径使用;事件类型里也有未接线的 `coefficient:changed` / `selection:changed`.这些会进一步模糊主线.

如果后面还想继续重构,比较自然的下一步是:把 `DslApp` 拆成 `SceneStore`/`CompileController`/`RenderController`,并统一 UI 通信方式,同时清理未使用的 `objectTransforms` 和事件字段.这样主链路会更接近上面的那张图,而不是所有逻辑都堆在一个壳子里.
