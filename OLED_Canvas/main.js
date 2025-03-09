// 更新画布位置信息(窗口变化时调用)
function updateCanvasRect() {
    canvasRect = canvas.getBoundingClientRect();
}

/**
 * 将鼠标坐标转换为画布像素坐标
 * @param {MouseEvent} event - 鼠标事件对象
 * @returns {Object} 包含x,y的像素坐标对象
 */
function getPixelPosition(event) {
    return {
        x: Math.min(
            canvas.width - 1,
            Math.max(
                0,
                Math.floor(
                    ((event.clientX - canvasRect.left) / canvasRect.width) * canvas.width
                )
            )
        ),
        y: Math.min(
            canvas.height - 1,
            Math.max(
                0,
                Math.floor(
                    ((event.clientY - canvasRect.top) / canvasRect.height) * canvas.height
                )
            )
        ),
    };
}

// 更新指示器位置
function updateIndicator(pos) {
    const pixelWidth = canvasRect.width / canvas.width;
    const pixelHeight = canvasRect.height / canvas.height;

    // 添加边界检查
    pos.x = Math.max(0, Math.min(canvas.width - 1, pos.x));
    pos.y = Math.max(0, Math.min(canvas.height - 1, pos.y));

    // 精确对齐像素边界
    indicator.style.left = `${canvasRect.left + pos.x * pixelWidth}px`;
    indicator.style.top = `${canvasRect.top + pos.y * pixelHeight}px`;

    // 动态调整指示器尺寸
    indicator.style.width = `${Math.ceil(pixelWidth)}px`;
    indicator.style.height = `${Math.ceil(pixelHeight)}px`;

    // 保持可见性
    indicator.style.display = "block";
    coordsDisplay.style.display = "block";
}
// ======================
// coordsDisplay
// ======================
/**
 * 更新坐标显示 实时显示鼠标坐标
 * @param {Object} pos - 包含x,y的坐标对象
 */
function updateCoordsDisplay(pos) {
    coordsDisplay.textContent = `coordinate:(X:${pos.x},Y:${pos.y})`;
}

// ======================
// 绘图核心逻辑
// ======================
/**
 * 设置单个像素颜色
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 */
function setPixel(x, y) {
    const index = (y * canvas.width + x) * 4;
    imageData.data[index] = pixiv_color ? 0 : 255; // R
    imageData.data[index + 1] = pixiv_color ? 0 : 255; // G
    imageData.data[index + 2] = pixiv_color ? 0 : 255; // B
    // 注意:保留Alpha通道不变
}

/**
 * Bresenham 直线算法
 * @param {number} x1 - 起点X
 * @param {number} y1 - 起点Y
 * @param {number} x2 - 终点X
 * @param {number} y2 - 终点Y
 */
function drawLine(x1, y1, x2, y2) {
    const dx = Math.abs(x2 - x1);
    const dy = -Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx + dy;

    while (true) {
        setPixel(x1, y1);
        if (x1 === x2 && y1 === y2) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x1 += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y1 += sy;
        }
    }
}

/**
 * 实时预览直线(不修改实际图像数据)
 * @param {number} endX - 终点X坐标
 * @param {number} endY - 终点Y坐标
 * @param {boolean} isBlack - 线段颜色
 */
function previewLine(endX, endY) {
    ctx.putImageData(previewImageData, 0, 0);

    // 创建临时canvas实现预览效果
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.imageSmoothingEnabled = false;

    // 使用混合模式保持二值化核心
    tempCtx.globalCompositeOperation = "source-over";
    tempCtx.fillStyle = PREVIEW_COLOR; // 直线必须fillStyle
    tempCtx.globalAlpha = PREVIEW_OPACITY;

    // Bresenham算法绘制预览线
    let x1 = startPos.x,
        y1 = startPos.y;
    let x2 = endX,
        y2 = endY;

    const dx = Math.abs(x2 - x1);
    const dy = -Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx + dy;

    while (true) {
        // 绘制半透明红色方块
        tempCtx.fillRect(x1, y1, 1, 1);
        if (x1 === x2 && y1 === y2) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x1 += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y1 += sy;
        }
    }

    // 叠加到主画布
    ctx.drawImage(tempCanvas, 0, 0);
}
// 矩形绘制逻辑
function drawRectangle(x1, y1, x2, y2) {
    // 计算矩形边界
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    // 绘制顶部和底部边框
    for (let x = left; x <= right; x++) {
        setPixel(x, top);
        setPixel(x, bottom);
    }
    // 绘制左右边框 排除角点避免重复
    for (let y = top + 1; y < bottom; y++) {
        setPixel(left, y);
        setPixel(right, y);
    }
}

function previewRectangle(endX, endY) {
    ctx.putImageData(previewImageData, 0, 0);

    // 创建临时副本进行操作
    const tempImageData = new ImageData(
        new Uint8ClampedArray(imageData.data),
        canvas.width,
        canvas.height
    );

    // 使用临时上下文绘制预览
    const tempCtx = canvas.getContext('2d');
    tempCtx.putImageData(tempImageData, 0, 0);

    // 绘制预览边框 红色半透明
    tempCtx.strokeStyle = PREVIEW_COLOR; // 矩形必须strokeStyle
    tempCtx.globalAlpha = PREVIEW_OPACITY;
    tempCtx.lineWidth = 1;
    tempCtx.strokeRect(
        Math.min(startPos.x, endX) + 0.5,
        Math.min(startPos.y, endY) + 0.5,
        Math.abs(endX - startPos.x),
        Math.abs(endY - startPos.y)
    );
}
// ======================
// 数据生成模块
// ======================
function generateEmbeddedData() {
    const buffer = new Uint8Array(128 * 8); // 128列 x 8页
    // 遍历每个页(8页，每页8行)
    for (let page = 0; page < 8; page++) {
        // 遍历每列(128列)
        for (let x = 0; x < 128; x++) {
            let byte = 0;
            // 组合8个垂直像素为一个字节
            for (let bit = 0; bit < 8; bit++) {
                const y = page * 8 + bit;
                const idx = (y * 128 + x) * 4;
                // 判断像素颜色(黑色为1)
                const isBlack =
                    imageData.data[idx] === 0 &&
                    imageData.data[idx + 1] === 0 &&
                    imageData.data[idx + 2] === 0;
                // 要求最高位bit7对应页顶部的像素
                byte |= (isBlack ? 1 : 0) << bit;
            }
            buffer[page * 128 + x] = byte;
        }
    }
    return buffer; // {Uint8Array} 1024字节的显示数据
}
// ======================
// 工具控制区
// ======================
// 清除画板
function clearCanvas() {
    for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = pixiv_color ? 0 : 255;
        imageData.data[i + 1] = pixiv_color ? 0 : 255;
        imageData.data[i + 2] = pixiv_color ? 0 : 255;
    }
    ctx.putImageData(imageData, 0, 0);
}
// 工具切换
function changeTool(tool) {
    currentTool = tool;
    startPos = null;
    previewImageData = null;
    ctx.putImageData(imageData, 0, 0); // 清除任何预览
}
// 数据导出
function exportEmbedded() {
    const data = generateEmbeddedData();
    const outputTextarea = document.getElementById("exportOutput");
    let output = "";
    output = `const uint8_t bitmap[1024] = {\n  `;
    data.forEach((byte, i) => {
        output += `0x${byte.toString(16).padStart(2, "0")}`;
        output += i !== data.length - 1 ? ", " : "";
        if ((i + 1) % 16 === 0) output += "\n  ";
    });
    output += "};";
    // 更新常驻文本域
    outputTextarea.value = output;
}
// 数据导入
function importEmbeddedData() {
    const input = document.getElementById("importData").value;
    try {
        // 提取十六进制数据
        const hexValues = input.match(/0x[0-9a-fA-F]{2}/g);
        if (!hexValues || hexValues.length !== 1024) {
            throw new Error("❌数据格式错误,需要包含1024个十六进制值");
        }
        // 转换到Uint8Array
        const buffer = new Uint8Array(hexValues.map((v) => parseInt(v, 16)));
        // 更新画布数据
        updateCanvasFromBuffer(buffer);
        alert("✅数据导入成功!");
    } catch (e) {
        alert(`❌导入失败:${e.message}`);
    }
}
// ======================
// 缓冲数据转画布图像
// ======================
function updateCanvasFromBuffer(buffer) {
    // 重置画布为白色
    for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = 255;
        imageData.data[i + 1] = 255;
        imageData.data[i + 2] = 255;
    }
    // 解析缓冲数据
    for (let page = 0; page < 8; page++) {
        for (let x = 0; x < 128; x++) {
            const byte = buffer[page * 128 + x];
            for (let bit = 0; bit < 8; bit++) {
                const y = page * 8 + bit;
                const isBlack = (byte & (1 << bit)) !== 0; // 注意位顺序
                const index = (y * 128 + x) * 4;
                imageData.data[index] = isBlack ? 0 : 255;
                imageData.data[index + 1] = isBlack ? 0 : 255;
                imageData.data[index + 2] = isBlack ? 0 : 255;
            }
        }
    }
    // 更新画布显示
    ctx.putImageData(imageData, 0, 0);
}
// 导出文本域:新复制函数
async function copyExportedData() {
    const textarea = document.getElementById("exportOutput");
    try {
        // 使用现代 Clipboard API
        await navigator.clipboard.writeText(textarea.value);
        // 添加视觉反馈
        const btn = document.querySelector("#output-button");
        btn.textContent = "✅已复制!";
        setTimeout(() => {
            btn.textContent = "复制到剪贴板";
        }, 4000);
    } catch (err) {
        console.error("❌复制失败:", err);
        alert("❌复制失败,请手动选择文本后按 Ctrl+C");
    }
}

function changeColor() {
    const btn = document.getElementById('change-color');
    pixiv_color = !pixiv_color;
    if (pixiv_color) {
        btn.textContent = "🔄️黑色";
        btn.style.color = "#ffffff";
        btn.style.backgroundColor = "#000000";
    } else {
        btn.textContent = "🔄️白色";
        btn.style.color = "#000000";
        btn.style.backgroundColor = "#ffffff";
    }
}

