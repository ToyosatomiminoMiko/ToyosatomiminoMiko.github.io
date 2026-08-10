# main

`2022.06.11.10:00:00`

&copy; ToyosatomiminoMiko(郝季仁)
本项目基于*DeepSeek*生成的代码(MIT许可)开发

## OLED canvas

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

读取字符串生成红黑树

## math-lab

根据表达式绘制函数图像
黎曼积分和勒贝格积分的数值计算和可视化
张量场

```mermaid

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

`git clone`后在项目根目录运行构建:

```sh
bash ./build.sh
```

检查TypeScript语法

```sh
npx tsc --noEmit
```

构建后预览

```sh
npx vite preview
```
