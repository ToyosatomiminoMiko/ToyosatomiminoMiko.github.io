export const APP_CONFIG = {
    colorPalette: [
        '#6dd5ff', '#ff6b8a', '#ffd93d', '#6bffb8',
        '#c084fc', '#fb923c', '#60a5fa', '#f472b6',
        '#34d399', '#a78bfa', '#fbbf24', '#f87171',
        '#2dd4bf', '#e879f9', '#facc15', '#4ade80',
    ],

    defaultExpressions: {
        '2d': [
            { fn: 'sin(x)', color: '#6dd5ff' },
            { fn: 'cos(x)', color: '#ff6b8a' },
        ],
        '3d': [
            { fn: 'sin(x) * cos(y)', color: '#ffd93d' },
            { fn: 'exp(-(x*x + y*y) / a) * b', color: '#6bffb8' },
            { fn: 'sin(x)*cos(y)+0.1*x*y', color: '#a78bfa' },
        ],
    },

    camera: {
        defaultMode: 'perspective',
        defaultView: '3d',
        frustumSize: { '2d': 12, '3d': 14 },
        initViewPositions: { '2d': [0, 0, 20], '3d': [12, 8, 12] },
        initViewTarget: [0, 0, 0]
    },

    plotter: {
        defaultSegments: 64,
        maxDepth: 4,
        xRange: [-8, 8],
    },
};

/**
 * ColorManager — 管理颜色分配的实例对象
 */
export class ColorManager {
    constructor(palette) {
        this.palette = palette;
        this.index = 0;
    }

    next() {
        const c = this.palette[this.index % this.palette.length];
        this.index++;
        return c;
    }

    reset() {
        this.index = 0;
    }
}