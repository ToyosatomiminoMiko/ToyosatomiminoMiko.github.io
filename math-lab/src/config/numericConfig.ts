/**
 * 数值计算与 DSL 编译默认值.
 *
 * 这里只放“默认策略”,不应包含类、DOM 或渲染逻辑.
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
    volume: {
        defaultSphereRadius: 1,
        defaultBoxSize: [1, 1, 1] as [number, number, number],
        defaultConicBase: 1,
        defaultConicHeight: 1,
        defaultRadialSegments: 48,
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
    limits: {
        // 曲线只有一维采样，20k 顶点仍是可控的线性缓冲；
        // 真正的风险在曲面、向量场与二维积分，不在曲线。
        curve: {
            maxSegments: 20_000,
        },
        surface: {
            // 512 段时：(512+1)^2 个顶点。
            // 若继续放到 1024，主线程索引与 WASM 结果双缓冲会同时膨胀，
            // 因此这里先压回一个更可预测的峰值。
            maxSegments: 512,
        },
        vectorField: {
            // 向量场每个箭头在主线程生成两套实例矩阵，
            // 单轴和总点数必须同时限制；100k 点比 200 万点更接近 Web 现实。
            maxAxisGrid: 128,
            maxTotalGridPoints: 100_000,
        },
        volume: {
            // 球体/旋转体只按圆周分段，128 段已经足够平滑；
            // 继续增大会让单个几何体变得沉重，但不会像二维积分一样 O(n^2) 爆炸。
            maxRadialSegments: 128,
        },
        integral: {
            // 数值计算与可视化预算分开。
            // 一维积分可以允许更高分段，二维积分是 O(n^2) 采样，必须单独压低。
            maxSegments1D: 8_192,
            maxSegments2D: 256,
            maxLayers: 128,
            // 以下三个值只约束“可视化”，不改变数值积分结果。
            // 数值结果仍按 task.segments 在 Worker 中计算，只是绘制时降采样。
            maxVisualizationSegments1D: 512,
            maxVisualizationSegments2D: 128,
            maxLebesgueVisualizationSamples1D: 4_096,
            maxLebesgueVisualizationResolution2D: 192,
            maxVisualizationLayers: 32,
            maxVisualizationBars: 100_000,
        },
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
