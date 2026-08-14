// ============================================================
// 应用配置(纯数据,不包含类定义)
// ============================================================

export const APP_CONFIG = {
    colorPalette: [
        '#6dd5ff', '#ff6b8a', '#ffd93d', '#6bffb8',
        '#c084fc', '#fb923c', '#60a5fa', '#f472b6',
        '#34d399', '#a78bfa', '#fbbf24', '#f87171',
        '#2dd4bf', '#e879f9', '#facc15', '#4ade80',
    ] as readonly string[],

    camera: {
        defaultMode: 'perspective' as const,
        frustumSize: 14,
        initViewTarget: [0, 0, 0] as readonly number[],
    },

    plotter: {
        defaultSegments: 64,
        maxDepth: 4,
    },
} as const;