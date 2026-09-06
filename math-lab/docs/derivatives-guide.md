# 求导与偏导(微分分析)使用指南

math-lab 的 DSL 目前**没有独立的"求导/偏导"语句**,求导与偏导功能统一
由三种"微分分析"算子承载,符号引擎在编译期对表达式求导,运行时在
指定点求值.这也正是"求导/偏导与梯度功能耦合"的现状:一元导数 =
`curve` 上的 `gradient` 分析,偏导 = `surface` 上的 `gradient` 分析,
向量场的导数组合 = `divergence` / `curl` 分析.实现层面的讨论见
[derivatives-impl.md](derivatives-impl.md).

## 1. 一元函数求导:curve 上的 gradient

语法:

```text
gradient 名称 = grad(曲线名) at [px, 0] {
    show = [point, normal, tangent];   // 可选,见 §5
};
```

对曲线 `y = f(x)` 求 x = px 处的一阶导数 f′(px):

- **point**:曲面/曲线上的分析点 (px, f(px), 0)(黄色圆点);
- **tangent**:过分析点的切线(绿色直线),方向 = (1, f′, 0),其斜率
  就是 f′(px);
- **normal**:切线法向(红色箭矢),方向 = (−f′, 1, 0) 归一化.这正是
  隐式曲线 `y − f(x) = 0` 的梯度方向:f′ > 0 时斜向左上,f′ < 0 时斜
  向右上,f′ = 0 时竖直向上.

`at` 在语法上至少要两个数;曲线求导只需 x 坐标,惯例写 `[px, 0]`
(第二个数对曲线不参与求值).

示例:`math-lab/example/derivative_curve.scad`
(`f(x) = sin(a*x)`,f′ = a·cos(a·x));求导法则对照(积/商/幂/对数/
三角复合)见 `math-lab/example/derivative_rules.scad`.

## 2. 二元函数偏导:surface 上的 gradient

语法:

```text
gradient 名称 = grad(曲面名) at [px, py] {
    show = [point, normal, tangent_plane];  // 可选
};
```

对曲面 `z = f(x, y)` 求 (px, py) 处的两个一阶偏导:

```text
fx = ∂f/∂x ,  fy = ∂f/∂y
```

- **point**:曲面上的点 (px, py, f(px, py));
- **normal**:曲面法向(红色箭矢),方向 = (−fx, −fy, 1) 归一化;
- **tangent_plane**:过分析点的切平面(半透明蓝色四边形),法向即上面的
  曲面法向.当 fx = fy = 0(如鞍面/极值点处)时法向竖直向上,切平面水平.

示例:`math-lab/example/partial_derivative_surface.scad`(正弦波面 +
鞍面,并演示 fx=fy=0 时切平面水平的直观情形).

## 3. 向量场的散度与旋度:div / curl

语法(`vector_field F = [P, Q, R]`,变量为 x/y/z):

```text
divergence 名称 = div(F) at [px, py, pz];
curl      名称 = curl(F) at [px, py, pz];
```

- **散度**(标量,结果面板打印数字):
  `div F = ∂P/∂x + ∂Q/∂y + ∂R/∂z`;
- **旋度**(向量,结果面板打印向量;为零时只保留测量点,不画箭矢):
  `curl F = (∂R/∂y − ∂Q/∂z, ∂P/∂z − ∂R/∂x, ∂Q/∂x − ∂P/∂y)`.

示例:`math-lab/example/divergence_vector_field.scad`(有源场与无源
旋转场对照),`math-lab/example/curl_vector_field.scad`(有旋旋转场
与无旋梯度场对照).注意"无旋"与"无散"是彼此独立的两个性质:线性
源/汇场 `[a*x, b*y, c*z]` 无旋但有散.

## 4. 算子 × 对象可用矩阵与校验

| 算子 | 对象 | 结果 | `at` 至少 |
| --- | --- | --- | --- |
| `gradient grad(...)` | `curve`(一元求导) | 点/切线/法向 | 1 个数(语法上写 2 个,如 `[px, 0]`) |
| `gradient grad(...)` | `surface`(偏导) | 点/法向/切平面 | 2 个数 |
| `divergence div(...)` | `vector_field` | 标量 | 3 个数 |
| `curl curl(...)` | `vector_field` | 向量 | 3 个数 |

编译期会做全套声明级校验并给出语句级错误(定位到行/列):

- 引用的对象必须存在;算子不能用于 `point`/`vector`/体积/`region` 等;
- 等号右侧函数名必须与算子匹配(`gradient g = curl(s1)` 会报错,
  不会静默当作 gradient 处理);
- `at` 坐标必须可求值(参数/数字/四则运算);
- `jacobian` / `laplacian` 语法可解析,但编译期抛出"暂未实现";
- 除 `show` 外不接受其他选项;`show` 拼写错误直接报错.

## 5. show 元素与默认值

四种可画元素:`point`,`normal`,`tangent`(仅 curve 求导),
`tangent_plane`(仅 surface 偏导).默认值按源对象分派:

| 分析 | 缺省 show |
| --- | --- |
| curve 的 gradient(一元求导) | `[point, normal, tangent]` |
| surface 的 gradient(偏导) | `[point, normal]` |
| divergence / curl | `[point, normal]` |

其中 `point` 测量点(黄色圆点)与场景 `point` 对象**共用同一个点的
定义**(`PointRenderer`):半径/全局可见跟随右侧"点"面板
("设定大小 / 按比例缩放 / 全局可见"),默认半径 0.2,不另设独立尺寸.

显式写 `show` 即精确指定(例如 `show = [point, tangent]` 省略法向).
切线方向存于 IR 的 `tangent = (1, f′, 0)`(未归一化,Δx 半长由
`renderConfig.analysis.tangentHalfLength` 控制),曲面分析该项为 null.

## 6. 符号求导支持范围

curve/surface/向量场的表达式在编译期由 Rust 符号引擎求导,支持:

- 运算法则:和/差,**积法则**,**商法则**,**幂法则**与一般底数
  `f^g`(含链式法则自动展开);
- 内置函数(sin cos tan asin acos atan sinh cosh tanh exp ln log10
  log2 sqrt cbrt abs sign)及别名(sec csc cot pow log 等);
- 只对"自由变量"求导(x / y / z),`param` 声明的系数当作常数;
  常量 `pi`/`e` 与纯数字照常折叠.
- abs/sign:符号结果用 sign 语义;在 0 处导数不存在,数值求值返回 NaN.

未支持:`jacobian`/`laplacian`(报"暂未实现");数组/向量表达式直接
求导(报错);高阶/混合偏导(f″,fxy)暂无 DSL 入口;求导结果目前只
用于在一点处的点分析,不提供"导数函数曲线"这类可视化.

## 7. 参数联动

曲线/曲面/向量场表达式里出现 `param`,求导在编译期完成一次,求值随
滑块刷新,因此拖动 `a`/`px`/`py` 等参数时,切线/法向/切平面以及
div/curl 数值都会实时更新(相关示例文件头都注明了每个滑块的作用).
