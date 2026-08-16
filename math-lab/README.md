# math-lab

Math-lab 的当前入口是 `index.html`，它加载 `src/main.ts`，再由
`DslApp` 驱动 `.miko` DSL。

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

## DSL 示例

```text
param a = 2 in [-5, 5, 0.1];
param b = 1 in [-3, 3, 0.1];
param k = 1.5 in [-4, 4, 0.1];

curve c1 = sin(x * a) * cos(k * x) {
    color = "#6dd5ff";
    range = [-8, 8];
    segments = 256;
}

surface s1 = sin(x * k) * cos(y * b) {
    color = "#ff6b8a";
    range = [-6, 6, -6, 6];
    segments = 96;
}

vector_field F = [y, -x, a] {
    range = [-4, 4, -4, 4, -4, 4];
    grid = [8, 8, 8];
    scale = 1.2;
}

point P = [1, 2, 3] {
    color = "#6dd5ff";
};

vector V = [[0, 0, 0], [1, 0, 0]] {
    color = "#ff6b8a";
};

gradient g = grad(s1) at [a, b] {
    show = [point, normal, tangent_plane];
}

divergence d = div(F) at [1, 2, 3];
curl c = curl(F) at [1, 2, 3];

integral I1 = integral(c1) {
    method = riemann;
    range = [-4, 4];
    segments = 32;
};

integral I2 = integral(s1) {
    method = lebesgue;
    range = [-3, 3, -3, 3];
    segments = 32;
    layers = 16;
};
```

## 当前支持范围

- `param`：参数面板与实时刷新
- `curve` / `surface` / `vector_field` / `point` / `vector`：基础几何对象
- `matrix` / `transform`：对象场景变换
- `gradient` / `divergence` / `curl`：点分析
- `gradient` 的 `show = [point, normal, tangent_plane]`：已支持
- `integral`：一维/二维数值积分和黎曼/勒贝格可视化，方法为
  `trapezoid`、`simpson`、`riemann`、`lebesgue`

相机状态不进入 DSL：透视/正交与旋转锁定由右侧 UI 开关控制，
`camera:view` 按钮只负责预设视角。

系数名不限于 `a`、`b`、`c`。只要不是 `sin`、`pi`、`e` 等内置符号，
`k`、`omega`、`theta` 这类标识符都会被识别为自由参数。

## 明确不支持但会报错

- `jacobian`、`laplacian`：解析器接受，编译器会抛出“暂未实现”
- `scalar`、`vector` 张量声明：编译器会抛出“暂未实现”
- 积分源必须引用已存在的 `curve` 或 `surface`

## 构建

项目根目录执行：

```sh
npm run build
```

该命令会依次执行：

1. `npm run build:wasm`：分别重建 `math-lab/src/math/math_rs`、
   `math-lab/src/compiler/compiler_rs`、`math-lab/src/render/render_rs`
   三个 Rust crate，并把产物输出到对应的 `src/wasm/*` 目录
2. `npm run typecheck`：执行 `tsc --noEmit`
3. `vite build`

也可以使用根目录的 `bash ./build.sh`，它现在等同于 `npm run build`。

## 代码布局与 legacy 提示

当前真正从入口可达的核心路径是：

```text
src/main.ts
src/app/DslApp.ts
src/compiler/dsl/DslCompiler.ts
src/compiler/parser/
src/render/visualization/DslIntegralRenderer.ts
src/render/core/Plotter.ts
src/render/core/SceneManager.ts
src/render/core/CameraManager.ts
```

旧交互式 UI 中仍有部分模块暂时保留为 legacy 参考代码，例如
`src/core/Application.ts`、`src/ui/DetailPanel.ts`、`src/ui/detail/`。
这些文件目前不参与运行时入口；后续如果要清理，建议先确认没有外部
文档或旧路由依赖，再整体移入 `legacy/` 或删除。
