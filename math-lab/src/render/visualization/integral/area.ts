// ============================================================
// integral/area.ts - 一维面积(梯形 / 辛普森)的可视化几何
//
// 把被积曲线下的有向面积建成实体棱柱:先按符号把每个区间拆成不跨零的
// 简单多边形(signedAreaPolygons),再挤出合并为单块几何(createPrismAreaGroup).
// Simpson 需要的抛物线细分点由 quadraticPoints(拉格朗日插值)给出.
// wrapSolidGroup 是"实体 mesh + 30° 线框"的公共收尾,grids.ts 也复用它.
// 本文件不触碰场景与缓存,构建结果返回 null 表示无可绘制内容.
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RENDER_CONFIG } from '../../../config/renderConfig';
import {
    createSolidEdgeMaterial,
    createSolidMaterial,
} from '../solidPrimitives';

const { depth2D: DEPTH_2D } = RENDER_CONFIG.integralVisualizer;

/** 一维积分的一个梯形区间(两端点被积值). */
export interface Segment2D {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
}

/**
 * 给一块 BufferGeometry 组装"实体 mesh + 30° 阈值线框"的标准收尾.
 * 梯形柱阵/辛普森曲面/挤出棱柱共用,消除三处重复的材质与挂载样板.
 */
export function wrapSolidGroup(
    geometry: THREE.BufferGeometry,
    color: THREE.Color,
    opacity: number,
    edgeOpacity: number,
): THREE.Group {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, createSolidMaterial(color, opacity)));
    group.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 30),
        createSolidEdgeMaterial(color, edgeOpacity),
    ));
    return group;
}

/** 把单个梯形区间拆成不跨零的简单多边形. */
export function signedAreaPolygons(segment: Segment2D): number[][][] {
    const { x0, x1, y0, y1 } = segment;
    if (!isFinite(y0) || !isFinite(y1)) return [];
    if (Math.abs(y0) < 1e-12 && Math.abs(y1) < 1e-12) return [];

    if (Math.abs(y0) < 1e-12) {
        return [[[x0, 0], [x1, y1], [x1, 0]]];
    }
    if (Math.abs(y1) < 1e-12) {
        return [[[x0, 0], [x0, y0], [x1, 0]]];
    }
    if (y0 * y1 < 0) {
        const xc = x0 - (y0 * (x1 - x0)) / (y1 - y0);
        return [
            [[x0, 0], [x0, y0], [xc, 0]],
            [[xc, 0], [x1, y1], [x1, 0]],
        ];
    }

    return [[[x0, 0], [x0, y0], [x1, y1], [x1, 0]]];
}

/** 通过拉格朗日插值生成 Simpson 抛物线采样点. */
export function quadraticPoints(
    x0: number,
    x1: number,
    x2: number,
    y0: number,
    y1: number,
    y2: number,
    samples: number,
): Array<{ x: number; y: number }> {
    if (!isFinite(y0) || !isFinite(y1) || !isFinite(y2)) return [];

    const l0 = (x: number): number => ((x - x1) * (x - x2)) / ((x0 - x1) * (x0 - x2));
    const l1 = (x: number): number => ((x - x0) * (x - x2)) / ((x1 - x0) * (x1 - x2));
    const l2 = (x: number): number => ((x - x0) * (x - x1)) / ((x2 - x0) * (x2 - x1));
    const points: Array<{ x: number; y: number }> = [];

    for (let i = 0; i <= samples; i += 1) {
        const x = x0 + ((x2 - x0) * i) / samples;
        points.push({ x, y: y0 * l0(x) + y1 * l1(x) + y2 * l2(x) });
    }
    return points;
}

/**
 * 生成一维面积的挤出棱柱组(梯形/辛普森可视化的实体柱).
 * 区间按符号拆成不跨零的多边形再逐个挤出,合并为单块几何.
 * 返回 null 表示没有可绘制面积(调用方不应登记缓存).
 */
export function createPrismAreaGroup(
    segments: Segment2D[],
    color: THREE.Color,
    opacity: number,
): THREE.Group | null {
    const geometries: THREE.BufferGeometry[] = [];

    for (const segment of segments) {
        for (const polygon of signedAreaPolygons(segment)) {
            const shape = new THREE.Shape(polygon.map(([x, y]) => new THREE.Vector2(x, y)));
            const geometry = new THREE.ExtrudeGeometry(shape, {
                depth: DEPTH_2D,
                bevelEnabled: false,
            });
            geometry.translate(0, 0, -DEPTH_2D / 2);
            geometries.push(geometry);
        }
    }

    if (geometries.length === 0) return null;
    const merged = mergeGeometries(geometries);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) return null;

    return wrapSolidGroup(merged, color, opacity, 0.35);
}
