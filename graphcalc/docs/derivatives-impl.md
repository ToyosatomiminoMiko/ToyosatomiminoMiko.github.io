# 求导与偏导:实现梳理与检查记录

本文记录对 GraphCalc 求导/偏导功能的实现检查(2026-09),供维护者参考.
用户视角的 DSL 用法见 [derivatives-guide.md](derivatives-guide.md).

## 1. 现状结论

- **`derivative` 语句把符号求导结果做成新对象**,画出整条导数函数曲线/曲面
  (curve -> curve 求 x 导,surface -> surface 求 x/y 偏导).对象与手写
  curve/surface 完全同构,复用同一 blueprint/物化/渲染管线;语法见
  [derivatives-guide.md](derivatives-guide.md) §1.
- **"微分分析"算子**在指定点做点分析(与"梯度"功能耦合):
  - 一元导数 = `curve` 上的 `gradient`(等价的数学说法:对隐式曲线
    `y − f(x) = 0` 求梯度 ∇ = (−f′, 1, 0),切线方向即 (1, f′, 0));
  - 偏导 = `surface` 上的 `gradient`(fx = ∂f/∂x,fy = ∂f/∂y,法向
    (−fx, −fy, 1),切平面);
  - div/curl = `vector_field` 上的六个一阶偏导组合.
- **求导本身在编译期完成(符号求导),数值求值在 WASM 内完成**,对象与
  分析结果都是"纯数据",拖动参数只重新求值,不重新求导(表达式级缓存).
- **`derivative` 语句输出"导数函数对象",分析算子输出"点值"**:前者是
  整条 f′ 曲线(f′ 表达式作为新对象表达式),后者是在某一点求 f′(px),
  fx/fy(px,py),div/curl(px,py,pz).
- **jacobian / laplacian 未实现**:pest 语法与 AST 类型已接受,编译期
  (`analyses.ts`)抛"分析算子 ... 暂未实现".

## 2. 主要代码路径

```text
DSL:  gradient g = grad(c) at [px, 0];
        │ parse_miko()(compiler_rs/miko.pest: analysis_stmt / analysis_op)
        ▼
AST AnalysisStatement { op, call, source, at[], options[] }
        │ compileAnalyses()   compiler/dsl/analyses.ts
        ▼
· 校验:算子×kind 矩阵 / at 数量与可求值性 / call 与算子匹配 / show 白名单
· 曲线/曲面(梯度):对 object.expr 生成 fx_expr / fy_expr
      cachedDerivativeExpression(expr, 'x' | 'y')   compiler/dsl/expression.ts
        │ wasm symbolic_derivative(expr, variable)   math_rs/src/lib.rs
        │   └─ symbolic/derivative.rs + builtins.rs(法则/函数表)
        ▼
JSON payload -> evaluate_gradient_point / evaluate_divergence_point /
              evaluate_curl_point(lib.rs) -> field_core.rs 数值求值
        ▼
IR AnalysisResult { point, vector, tangent, scalar, show, enabled }
        │
        ├─ AnalysisRenderer.ts     渲染 point/normal/tangent/tangent_plane
        └─ ObjectListController.ts "结果"列表:∇f / ∇·F / ∇×F 与 f(P)
```

- 曲线 gradient 的 payload:`fy_expr = '0'`(第二 at 坐标不参与);
- 曲面 gradient 的向量 = normalize(−fx, −fy, 1);曲线 = normalize(−f′, 1, 0);
- curve 求导的切线方向 `tangent = (1, f′, 0)` 未归一化,Δx 半长由
  `renderConfig.analysis.tangentHalfLength`(默认 2)控制;
- 符号引擎:`math_rs/src/symbolic/derivative.rs` 按节点分派(常数/变量/
  一元负/二元运算/函数调用),乘积,商,幂 `f^g`,链式法则展开后交给
  `simplify`;`builtins.rs` 的 `derivative_unary` 表登记每个内置函数的
  导数;别名 `log/pow/sec/csc/cot/deg` 在 `rewrite_aliases` 阶段展开.
  - `printing.rs` 的文本打印器必须给幂的**底数**补括号:`(x^2)^3` 少写
    括号会重读成 `x^(2^3)`(x^6 变 x^8);`7/x^4` 的导数曾因此从
    `-28/x^5` 静默变成 `-28/x^13`.LaTeX 打印器只做展示,不弥补 Text 的语义;
  - `simplify.rs` 会把商/幂法则留下的分数收成人能读的一行:数字系数并进
    分子,同底数幂相乘/相除合并,负号提到运算符上,例如
    `d/dx (x^3 + 7/x^4 - 2/x) = 3x^2 - 28/x^5 + 2/x^2`(仍然不做同类项
    合并/通分/因式分解,边界见 `simplify.rs` 顶部契约).

## 3. 与 gradient 的耦合(设计取舍)

"求导/偏导"目前只是 gradient/divergence/curl 分析在对象上的语义:

- 同一算子 `gradient` 同时承担"一元导数(curve)"与"二元偏导
  (surface)"两种语义,靠对象 kind 区分(analyses.ts 里
  `defaultShow`/`fy_expr`/`tangent` 都按 isCurve 分叉);
- IR `AnalysisResult` 只有一套结构,`tangent` 字段对曲面/向量场为
  null,`tangent_plane` 仅曲面 gradient 使用,`normal` 在 curve 上是
  "切线的法向"而非曲面法向;
- UI"结果"列表对 gradient 一律打印 `f(P)` 与 `∇f`(法向),不区分一元/
  多元;散度只打标量,旋度只打向量.

取舍是合理的:求导在编译期完成一次,渲染/UI 共用点分析管线,示例与
文档都按"微分分析"这一组功能叙述.若未来要加独立的一阶导数语句或
f′ 曲线可视化,应在 DSL/IR 层增加显式语义(参考 §5 的未实现清单),
而不是继续塞进 gradient 的 show.

## 4. 未提交的工作区改动(2026-09 快照)

`git status` 显示以下改动**尚未提交**,它们正是"一元求导可视化"最近
的一批工作,示例与文档已按包含这些改动的代码状态编写:

| 文件 | 改动 |
| --- | --- |
| `src/compiler/dsl/analyses.ts` | gradient 结果新增 `tangent`;curve 求导缺省 show 改为 `[point, normal, tangent]` |
| `src/compiler/ir/types.ts` | `AnalysisShow` 新增 `tangent`;`AnalysisResult.tangent` 字段 |
| `src/compiler/dsl/options.ts` | show 白名单加 `tangent`,解析带缺省项 |
| `src/render/core/renderers/AnalysisRenderer.ts` | 渲染切线(绿色直线) |
| `src/config/renderConfig.ts` | `analysis.tangentHalfLength` |
| `src/compiler/dsl/DslCompiler.test.ts` | curve 切线默认/显式 show 的行为测试 |
| `graphcalc/README.md` | 说明文字(见仓库根 README 的引用更新) |

同时本仓库对 `graphcalc/example/` 与 `graphcalc/docs/` 的忽略已放开
(见根 `.gitignore`),示例集与本文档可随代码一起提交.

## 5. 已知边界与未实现

- `jacobian` / `laplacian`:AST 类型 `AnalysisOpKind` 与 pest
  `analysis_op` 已收,但 analyses.ts 编译期直接抛"暂未实现";加算子时
  需同步 `compiler_rs/src/miko.pest` 与 `ast/types.ts`.
- 高阶/混合偏导没有独立语句,但可用 `derivative` 链式求导得到:每步把
  上一步的导数对象当源对象即可(如 `derivative(d = derivative(s, x))` 得
  ∂²f/∂x²,`derivative(dy = derivative(d, y))` 得 ∂²f/∂y∂x).
- 对数组/向量表达式求导:未支持(`derivative` 源只能是 curve/surface).
- 点分析只输出测量点的值;`at` 坐标个数不足时编译报错(curve 最少
  1 个,surface 2 个,vector_field 3 个;语法上 `at` 至少两个数).
- 隐藏语义:被隐藏的分析先完整校验再置 `enabled: false` 占位,不执行
  WASM 求值(与求交/积分统一,见 analyses.ts 文件头).
- 数值侧对不可导点(abs/sign 在 0 处等)返回 NaN;符号侧 abs 用 sign
  语义,不会产生 0/0.

## 6. 测试现状

- TS:`src/compiler/dsl/DslCompiler.test.ts` 覆盖 curve/surface
  gradient 的 payload,归一化法向,tangent 默认与显式 show,div/curl
  数值编排,kind×算子非法组合与 call 不匹配等;
- Rust:`src/math/math_rs/src/symbolic/mod.rs` 单元测试覆盖符号求导
  法则与化简(`sin(x*a)`,`abs` 的 sign 语义,常数折叠等).
