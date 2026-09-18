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

`/metro_window/` -- Rust + WASM + WebGPU 实时渲染的地铁车窗玻璃效果,
从独立仓库 [metro_window](https://github.com/ToyosatomiminoMiko/metro_window)
搬入(上游已归档),计划用作站点欢迎页(落地形态待定,见其 README).

它原来是 **GPL-3.0**,并入本站后整体按本站的 **AGPL-3.0** 走
(作者同一人,子目录不再单独保留一份许可).

源码,架构与迁移记录见 [`metro_window/README.md`](metro_window/README.md).

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
