/*
2025.12.10.23:20:00
APP: #app_led_clock
LED Clock
LED 时钟
*/

createApp({
    setup() {
        const ledCanvas = ref(null);
        const formattedTime = ref('');
        let animationFrameId = null;

        // 7段码数字定义 (高5px,宽3px)
        // 每个数字由3列组成,每列用5位表示
        const digitSegments = [
            [0b11111, 0b10001, 0b11111], // 0
            [0b01001, 0b11111, 0b00001], // 1
            [0b10111, 0b10101, 0b11101], // 2
            [0b10101, 0b10101, 0b11111], // 3
            [0b11100, 0b00100, 0b11111], // 4
            [0b11101, 0b10101, 0b10111], // 5
            [0b11111, 0b10101, 0b10111], // 6
            [0b10000, 0b10000, 0b11111], // 7
            [0b11111, 0b10101, 0b11111], // 8
            [0b11101, 0b10101, 0b11111]  // 9
        ];

        // 点号定义 (用于日期分隔符)
        const dotSegments = [0b0, 0b0, 0b0, 0b0, 0b1];

        // 冒号定义 (用于时间分隔符)
        const colonSegments = [0b0, 0b1, 0b0, 0b1, 0b0];

        // 绘制LED数字
        function drawDigit(ctx, digit, x) {
            const segments = digitSegments[digit];

            for (let col = 0; col < 3; col++) {
                const columnData = segments[col];

                for (let row = 0; row < 5; row++) {
                    const pixel = (columnData >> (4 - row)) & 1;

                    if (pixel) {
                        // 绘制LED点
                        ctx.fillStyle = '#0f0'; // 亮绿色
                        ctx.fillRect(x + col, row + 1, 1, 1);
                    }
                }
            }
        }

        // 绘制冒号
        function drawColon(ctx, x) {
            for (let row = 0; row < 5; row++) {
                const pixel = colonSegments[row];
                if (pixel) {
                    ctx.fillStyle = '#0f0';
                    ctx.fillRect(x, row + 1, 1, 1);
                }
            }
        }

        // 绘制点号
        function dotColon(ctx, x) {
            for (let row = 0; row < 5; row++) {
                const pixel = dotSegments[row];
                if (pixel) {
                    ctx.fillStyle = '#0f0';
                    ctx.fillRect(x, row + 1, 1, 1);
                }
            }
        }

        // 绘制LED显示屏
        function drawDisplay() {
            if (!ledCanvas.value) return;

            const canvas = ledCanvas.value;
            const ctx = canvas.getContext('2d');

            // 清除画布
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // 设置背景
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // 获取当前时间
            const now = new Date();
            const year = now.getFullYear().toString();
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            const day = now.getDate().toString().padStart(2, '0');
            const hours = now.getHours().toString().padStart(2, '0');
            const minutes = now.getMinutes().toString().padStart(2, '0');
            const seconds = now.getSeconds().toString().padStart(2, '0');

            // 更新时间显示
            formattedTime.value = `${year}.${month}.${day}.${hours}:${minutes}:${seconds}`;

            // 构建显示内容: 年月日时分秒
            const displayString = year + month + day + hours + minutes + seconds;

            let x = 0;

            // 绘制每个数字
            for (let i = 0; i < displayString.length; i++) {
                const digit = parseInt(displayString[i]);
                drawDigit(ctx, digit, x);
                x += 4; // 数字宽度3px + 1px间隔
                // 在适当位置添加分隔符
                // 点号
                if (i === 3 || i === 5 || i === 7) {
                    dotColon(ctx, x);
                    x += 2;
                }
                // 冒号
                if (i === 9 || i === 11) {
                    drawColon(ctx, x);
                    x += 2; // 冒号宽度1px + 1px间隔
                }
            }
        }

        // 动画循环
        function animate() {
            drawDisplay();
            animationFrameId = requestAnimationFrame(animate);
        }

        onMounted(() => {
            animate();
        });

        onUnmounted(() => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
        });

        return {
            ledCanvas,
            formattedTime
        };
    }
}).mount('#app_led_clock');


