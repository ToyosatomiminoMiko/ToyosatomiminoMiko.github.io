/**
 * 数值计算与 DSL 编译默认值。
 *
 * 这里只放“默认策略”，不应包含类、DOM 或渲染逻辑。
 */
export const NUMERIC_CONFIG = {
    param: {
        defaultValue: 1,
        defaultMin: -10,
        defaultMax: 10,
        defaultStep: 0.1,
    },
    curve: {
        defaultRange: [-8, 8] as [number, number],
        defaultSegments: 320,
    },
    surface: {
        defaultRange: [-6, 6, -6, 6] as [number, number, number, number],
        defaultSegments: 64,
    },
    vectorField: {
        defaultRange: [-4, 4, -4, 4, -4, 4] as [
            number,
            number,
            number,
            number,
            number,
            number,
        ],
        defaultGrid: [8, 8, 8] as [number, number, number],
        defaultGlyphScale: 1.2,
    },
    integral: {
        defaultMethod: 'riemann' as const,
        defaultRange1D: [-4, 4] as [number, number],
        defaultRange2D: [-3, 3, -3, 3] as [number, number, number, number],
        defaultSegments: 32,
        defaultLayersCap: 32,
        lebesgueOversample1D: 20,
        lebesgueOversample2D: 4,
        showDefault: true,
    },
    tolerance: {
        zero: 1e-12,
    },
    colorPalette: [
        '#6dd5ff',
        '#ff6b8a',
        '#ffd93d',
        '#6bffb8',
        '#c084fc',
        '#fb923c',
    ],
};
