/*
2025.12.10.23:20:00
APP: #app_led_clock
LED Clock
*/
import { createApp, ref, onMounted, onUnmounted } from 'vue';
import { fmt_time } from './utils'; // 假设 fmt_time 接受 Date 返回 string

// 定义数字段类型:每个数字由3列组成,每列为5位二进制数
type DigitSegments = Uint8Array; // 原三元组类型注释保留,实际使用 Uint8Array

const pixel_color = '#0ff'; // 像素颜色

// 7段码数字定义 (高5px,宽3px)
const digitSegments: DigitSegments = new Uint8Array([
    0b11111, 0b10001, 0b11111, // 0
    0b01001, 0b11111, 0b00001, // 1
    0b10111, 0b10101, 0b11101, // 2
    0b10101, 0b10101, 0b11111, // 3
    0b11100, 0b00100, 0b11111, // 4
    0b11101, 0b10101, 0b10111, // 5
    0b11111, 0b10101, 0b10111, // 6
    0b10000, 0b10000, 0b11111, // 7
    0b11111, 0b10101, 0b11111, // 8
    0b11101, 0b10101, 0b11111  // 9
]);

// 点号定义 (用于日期分隔符)
const dotSegments: Uint8Array = new Uint8Array([0b0, 0b0, 0b0, 0b0, 0b1]);

// 冒号定义 (用于时间分隔符)
const colonSegments: Uint8Array = new Uint8Array([0b0, 0b1, 0b0, 0b1, 0b0]);

// 绘制LED数字
function drawDigit(ctx: CanvasRenderingContext2D, digit: number, x: number): void {
    const base = digit * 3; // 每个数字占3个字节
    for (let col = 0; col < 3; col++) {
        const columnData = digitSegments[base + col];
        for (let row = 0; row < 5; row++) {
            const pixel = (columnData >> (4 - row)) & 1;
            if (pixel) {
                ctx.fillStyle = pixel_color;
                ctx.fillRect(x + col, row + 1, 1, 1);
            }
        }
    }
}

// 绘制冒号
function drawColon(ctx: CanvasRenderingContext2D, x: number): void {
    for (let row = 0; row < 5; row++) {
        const pixel = colonSegments[row];
        if (pixel) {
            ctx.fillStyle = pixel_color;
            ctx.fillRect(x, row + 1, 1, 1);
        }
    }
}

// 绘制点号
function drawDot(ctx: CanvasRenderingContext2D, x: number): void {
    for (let row = 0; row < 5; row++) {
        const pixel = dotSegments[row];
        if (pixel) {
            ctx.fillStyle = pixel_color;
            ctx.fillRect(x, row + 1, 1, 1);
        }
    }
}

export function mountClock(): void {
    const app = createApp({
        setup() {
            const ledCanvas = ref<HTMLCanvasElement | null>(null);
            const formattedTime = ref<string>('');
            let timerId: number | null = null;

            function drawDisplay(): void {
                if (!ledCanvas.value) return;
                const canvas = ledCanvas.value;
                const ctx = canvas.getContext('2d');
                if (!ctx) return; // 安全处理

                // 清除画布
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                // 设置背景
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // 获取当前时间
                const now = new Date();
                formattedTime.value = fmt_time(now);

                // 绘制
                let x = 0;
                for (const ch of formattedTime.value) {
                    if (ch === '.') {
                        drawDot(ctx, x);
                        x += 2;
                    } else if (ch === ':') {
                        drawColon(ctx, x);
                        x += 2;
                    } else {
                        // 数字
                        const digit = parseInt(ch, 10);
                        if (!isNaN(digit)) {
                            drawDigit(ctx, digit, x);
                        }
                        x += 4;
                    }
                }
            }

            onMounted(() => {
                // 立即绘制一次,避免空白
                drawDisplay();
                // 每秒更新一次
                timerId = window.setInterval(() => {
                    drawDisplay();
                }, 1000);
            });

            onUnmounted(() => {
                // 清理定时器,防止内存泄漏
                if (timerId !== null) {
                    clearInterval(timerId);
                    timerId = null;
                }
            });

            return {
                ledCanvas,
                formattedTime
            };
        }
    });
    app.mount('#app_led_clock');
}