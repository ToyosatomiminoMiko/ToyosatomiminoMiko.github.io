// ============================================================
// 应用配置
// ============================================================

export const APP_CONFIG = {
    colorPalette: [
        '#6dd5ff', '#ff6b8a', '#ffd93d', '#6bffb8',
        '#c084fc', '#fb923c', '#60a5fa', '#f472b6',
        '#34d399', '#a78bfa', '#fbbf24', '#f87171',
        '#2dd4bf', '#e879f9', '#facc15', '#4ade80',
    ] as readonly string[],

    defaultExpressions: {
        '2d': [
            { fn: 'sin(x)', color: '#6dd5ff' },
            { fn: 'cos(x)', color: '#ff6b8a' },
        ],
        '3d': [
            { fn: 'sin(x) * cos(y)', color: '#ffd93d' },
            { fn: 'exp(-(x*x + y*y) / a) * b', color: '#6bffb8' },
            { fn: 'x ^ 2 * a + y ^ 2 * b + c', color: '#a78bfa' },
        ],
    },

    camera: {
        defaultMode: 'perspective' as const,
        defaultView: '3d' as const,
        frustumSize: { '2d': 12, '3d': 14 },
        initViewPositions: {
            '2d': [0, 0, 20] as readonly number[],
            '3d': [12, 8, 12] as readonly number[],
        },
        initViewTarget: [0, 0, 0] as readonly number[],
    },

    plotter: {
        defaultSegments: 64,
        maxDepth: 4,
    },
} as const;

// ============================================================
// ColorManager — 管理颜色分配的实例对象
// ============================================================
export class ColorManager {
    palette: string[];
    index: number;

    constructor(palette: readonly string[]) {
        this.palette = [...palette]; // 复制一份避免外部修改影响
        this.index = 0;
    }

    next(): string {
        const c = this.palette[this.index % this.palette.length];
        this.index++;
        return c;
    }

    reset(): void {
        this.index = 0;
    }
}