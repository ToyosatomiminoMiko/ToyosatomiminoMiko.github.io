# main

`2022.06.11.10:00:00`

&copy; ToyosatomiminoMiko(郝季仁)

## OLED canvas

本项目基于*DeepSeek*生成的代码(MIT许可)开发

在`128*64`的画布上绘图并导出为`uint8_t`数组或PNG.

## Red-Black Tree Lab

本项目基于*DeepSeek*生成的代码(MIT许可)开发

读取字符串生成红黑树

## math-lab

本项目基于*DeepSeek*生成的代码(MIT许可)开发

根据表达式绘制函数图像
黎曼积分和勒贝格积分的数值计算和可视化
张量场

- 2D

```js
Math.pow(x,2)
```

- 3D

```js
Math.sin(x)*Math.cos(y)+0.1*x*y
Math.sqrt(x*x+y*y,2) // 圆锥
Math.sqrt(16 -x*x + y*y,2) // 马鞍面
Math.sqrt(4 - x*x - y*y,2) // 半球
-Math.sqrt(4 - x*x - y*y,2)
Math.log(x*y)
x*x*x - 3*x*y*y // 猴子鞍面
Math.sin(Math.pow(x*x+y*y,0.5))/Math.pow(x*x+y*y,0.5)+1 // 指数衰减波纹
Math.pow((1-x),2)+100*Math.pow(y-x*x,2) // 罗森布鲁克香蕉谷
Math.pow(Math.e,-0.1*(x*x+y*y))*(Math.sin(x)+Math.cos(2*y)) // ??? 皱褶的床单/翻涌的海浪
```

## 本地运行

`git clone`后在项目根目录运行:

```sh
python -m http.server 8080
```
