# main

`2022.06.11.10:00:00`

&copy; ToyosatomiminoMiko(郝季仁)

## OLED canvas

本项目基于*DeepSeek*生成的代码(MIT许可)开发

在`128*64`的画布上绘图并导出为`uint8_t`数组或PNG.

- imageData (ImageData 对象)
├─ 存在内存中,是"真相之源"
├─ 所有绘图操作(setPixel,drawLine)都修改它
└─ 通过 ctx.putImageData(imageData, 0, 0) 显示
- previewImageData (ImageData 对象)
├─ 在 mousedown 时保存的"快照"
├─ 记录的是"按下鼠标那一刻"的 canvas 像素状态
└─ 用于恢复:ctx.putImageData(previewImageData)
- ctx (CanvasRenderingContext2D)
├─ 主画布的"画笔"
├─ ctx.putImageData() →-> 直接覆盖画布像素
└─ ctx.drawImage() -> 叠加绘制(受 globalAlpha 影响)

```text
┌────────────────────────────────────────────────────────────────────────┐
│  imageData (ImageData object)                                          │
│  ├─ Exists in memory, the "source of truth"                            │
│  ├─ All drawing operations (setPixel, drawLine) modify it              │
│  └─ Displayed via ctx.putImageData(imageData, 0, 0)                    │
├────────────────────────────────────────────────────────────────────────┤
│  previewImageData (ImageData object)                                   │
│  ├─ "Snapshot" saved at mousedown                                      │
│  ├─ Records the canvas pixel state [at the moment the mouse is pressed]│
│  └─ Used for restoration: ctx.putImageData(previewImageData)           │
├────────────────────────────────────────────────────────────────────────┤
│  ctx (CanvasRenderingContext2D)                                        │
│  ├─ The "brush" of the main canvas                                     │
│  ├─ ctx.putImageData() -> directly overwrites canvas pixels            │
│  └─ ctx.drawImage() -> composite drawing (affected by globalAlpha)     │
└────────────────────────────────────────────────────────────────────────┘
```

## Red-Black Tree Lab

本项目基于*DeepSeek*生成的代码(MIT许可)开发

读取字符串生成红黑树

## math-lab

本项目基于*DeepSeek*生成的代码(MIT许可)开发

根据表达式绘制函数图像
黎曼积分和勒贝格积分的数值计算和可视化
张量场

```mermaid
graph TD
    %% ===== 最上层：UI Layer =====
    subgraph UI["🧩 UI Layer (用户界面)"]
        ExprInput["ExprInputController<br/>表达式输入"]
        ExprList["ExprListRenderer<br/>对象列表渲染"]
        ModeCtrl["ModeController<br/>2D/3D 模式切换"]
        CamToggle["CameraToggle<br/>透视/正交切换"]
        DetailPanel["DetailPanel<br/>详情面板(导数/积分/梯度/编辑)"]
        SelectionMgr["SelectionManager<br/>选中管理"]
    end

    %% ===== 中间：Service Layer =====
    subgraph Service["🔁 Service Layer (通信层)"]
        EventBus["EventBus<br/>泛型事件总线"]
    end

    %% ===== 核心：Core Layer =====
    subgraph Core["⚙️ Core Layer (核心逻辑)"]
        SceneMgr["SceneManager<br/>场景/渲染器管理"]
        CameraMgr["CameraManager<br/>相机管理"]
        Plotter["Plotter<br/>增量式绘图器"]
    end

    %% ===== 数据：Math Objects =====
    subgraph Model["📦 Math Objects (数据模型)"]
        MathObjMgr["MathObjectManager<br/>对象生命周期管理"]
        ColorMgr["ColorManager<br/>调色板"]
        Curve["Curve (2D 曲线)"]
        Surface["Surface (3D 曲面)"]
        Point3D["Point (空间点)"]
        Vector3D["Vector (空间向量)"]
        Types["types.ts<br/>类型定义 (discriminated union)"]
    end

    %% ===== 可视化：Visualization =====
    subgraph Viz["🎨 Visualization (可视化层)"]
        IntegralVis["IntegralVisualizer<br/>积分区域可视化"]
        GradientVis["GradientVisualizer<br/>梯度场可视化"]
        SurfaceMesh["SurfaceMesh<br/>参数曲面网格"]
        ArrowMesh["ArrowMesh<br/>箭头(向量)网格"]
    end

    %% ===== 计算：Computation =====
    subgraph Compute["🧮 Computation (计算层)"]
        IntegralWorker["IntegralWorker<br/>Web Worker 并行积分"]
        IntegralWasm["IntegralWasm<br/>WASM 积分接口"]
        GradientCore["GradientCore<br/>梯度计算"]
        ml_wasm["ml_wasm (Rust → WASM)<br/>高性能数值积分"]
    end

    %% ===== 配置与外部 =====
    subgraph Config["🛠️ 配置与外部依赖"]
        AppConfig["appConfig.ts<br/>全局配置"]
        Three["Three.js<br/>3D 引擎"]
        MathJS["math.js<br/>表达式解析/编译"]
        Orbit["OrbitControls<br/>轨道控制器"]
    end

    %% ========== 依赖关系 ==========
    %% UI → EventBus
    ExprInput --> EventBus
    ExprList --> EventBus
    ModeCtrl --> EventBus
    CamToggle --> EventBus
    DetailPanel --> EventBus
    SelectionMgr --> EventBus

    %% EventBus → Core
    EventBus -->|"mode:changed"| CameraMgr
    EventBus -->|"mathobj:added|removed|updated|toggled"| Plotter
    EventBus -->|"coefficient:changed"| Plotter
    EventBus -->|"camera:changed"| CameraMgr
    EventBus -->|"selection:changed"| DetailPanel

    %% Core → Math Objects
    Plotter --> MathObjMgr
    Plotter --> Curve
    Plotter --> Surface
    Plotter --> Point3D
    Plotter --> Vector3D
    Plotter --> Types

    %% Math Objects 内部
    MathObjMgr --> Curve
    MathObjMgr --> Surface
    MathObjMgr --> Point3D
    MathObjMgr --> Vector3D
    MathObjMgr --> ColorMgr
    MathObjMgr --> Types

    %% Plotter → Visualization
    Plotter --> SurfaceMesh
    Plotter --> ArrowMesh
    Plotter --> IntegralVis
    Plotter --> GradientVis

    %% Visualization → Computation
    IntegralVis --> IntegralWorker
    IntegralVis --> IntegralWasm
    IntegralWasm --> ml_wasm
    GradientVis --> GradientCore

    %% 外部依赖
    SceneMgr --> Three
    Plotter --> Three
    IntegralVis --> Three
    GradientVis --> Three
    SurfaceMesh --> Three
    ArrowMesh --> Three
    MathObjMgr --> MathJS
    CameraMgr --> Orbit
```

- 2D

```js
pow(x,2)
```

- 3D

```js
sin(x)*cos(y)+0.1*x*y
exp(-(x * x + y * y) / a) * b
sqrt(x*x+y*y,2) // 圆锥
x ^ 2 * a + y ^ 2 * b + c // 马鞍面
sqrt(4 - x*x - y*y,2) // 半球
-sqrt(4 - x*x - y*y,2)
log(x * y * a) * b
x*x*x - 3*x*y*y // 猴子鞍面
sin(pow(x*x+y*y,0.5))/pow(x*x+y*y,0.5)+1 // 指数衰减波纹
pow((1-x),2)+100*pow(y-x*x,2) // 罗森布鲁克香蕉谷
pow(e,-0.1*(x*x+y*y))*(sin(x)+cos(2*y)) // ??? 皱褶的床单/翻涌的海浪
```

## 本地运行

`git clone`后在项目根目录运行:

```sh
python -m http.server 8080
```

试运行

```sh
npm run dev
```

检查

```sh
npx tsc --noEmit
```

构建

```sh
npx vite build
```

构建后预览

```sh
npx vite preview
```
