/**
 * 求交结果渲染器.
 *
 * 交点用 Points 绘制(可缩放、不随对象显隐联动),交线用 Line 折线绘制.
 * 每个求交结果独立成组,方便整体显隐与颜色区分.
 */
import * as THREE from 'three';
import type { IntersectionResult } from '../../../compiler/ir/types';
import { RENDER_CONFIG } from '../../../config/renderConfig';

export class IntersectionRenderer {
    readonly group = new THREE.Group();

    render(results: IntersectionResult[]): void {
        this.clear();

        for (const result of results) {
            if (result.points.length > 0) {
                this.group.add(this._buildPoints(result.points, result.color));
            }
            for (const curve of result.curves) {
                this.group.add(this._buildCurve(curve, result.color));
            }
        }
    }

    clear(): void {
        for (const child of [...this.group.children]) {
            this.group.remove(child);
            child.traverse((node) => {
                if (node instanceof THREE.Points || node instanceof THREE.Line) {
                    node.geometry?.dispose();
                    const material = node.material;
                    if (Array.isArray(material)) {
                        material.forEach((entry) => entry.dispose());
                    } else {
                        material?.dispose();
                    }
                }
            });
        }
    }

    dispose(): void {
        this.clear();
    }

    private _buildPoints(points: IntersectionResult['points'], color: string): THREE.Points {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(points.length * 3);
        points.forEach((point, index) => {
            positions[index * 3] = point.x;
            positions[index * 3 + 1] = point.y;
            positions[index * 3 + 2] = point.z;
        });
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color,
            size: RENDER_CONFIG.intersection.pointSize,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
        });
        return new THREE.Points(geometry, material);
    }

    private _buildCurve(
        curve: readonly { x: number; y: number; z: number }[],
        color: string,
    ): THREE.Line {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(curve.length * 3);
        curve.forEach((point, index) => {
            positions[index * 3] = point.x;
            positions[index * 3 + 1] = point.y;
            positions[index * 3 + 2] = point.z;
        });
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
            color,
            linewidth: RENDER_CONFIG.intersection.lineWidth,
            transparent: true,
            opacity: 0.95,
        });
        return new THREE.Line(geometry, material);
    }
}
