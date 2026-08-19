/**
 * 渲染与可视化常量.
 *
 * 这里只放静态默认值,不包含几何体实例或 Three.js 对象.
 */
export const RENDER_CONFIG = {
    integralVisualizer: {
        barGap: 0.05,
        depth2D: 0.3,
        opacityRiemann: 0.5,
        opacityLebesgue: 0.5,
        edgeOpacityRiemann: 0.4,
    },
    volume: {
        defaultOpacity: 0.55,
        defaultEdgeOpacity: 0.3,
    },
    vectorFieldMesh: {
        threshold: 1e-8,
        shaftRadius: 0.05,
        headRadius: 0.15,
        headLengthRatio: 0.2,
        radialSegments: 8,
        roughness: 0.6,
        metalness: 0.2,
    },
    arrowMesh: {
        shaftRadius: 0.08,
        headRadius: 0.2,
        headLength: 0.4,
        zeroLengthThreshold: 1e-6,
        radialSegments: 8,
    },
    analysis: {
        pointRadius: 0.08,
        arrowLength: 1.5,
        arrowHeadLength: 0.2,
        arrowHeadWidth: 0.1,
        tangentPlaneSize: 1.6,
        tangentPlaneOpacity: 0.55,
        tolerance: 1e-12,
    },
    surfaceMesh: {
        defaultSegments: 128,
        materialOpacity: 0.85,
        shininess: 30,
        specular: 0x222244,
        wireframeColor: 0x88aaff,
        wireframeOpacity: 0.15,
    },
    scene: {
        background: 0x111122,
        axesLength: 8,
        axisLabelLength: 8.5,
        gridSize: 20,
        gridDivisions: 20,
        centerSphereRadius: 0.2,
        labelCanvasSize: 64,
        labelFont: 'Bold 36px Arial',
        labelScale: 0.8,
        axisColors: {
            x: '#ff4444',
            y: '#44ff44',
            z: '#4488ff',
        },
    },
};
