/**
 * 分析结果渲染器.
 * 从 DslApp 拆出,负责把 gradient/divergence/curl 的点/法向和切平面
 * 渲染到独立 THREE.Group.
 */
import * as THREE from 'three';
import type { AnalysisResult } from '../../../compiler/ir/types';
import { RENDER_CONFIG } from '../../../config/renderConfig';

export class AnalysisRenderer {
    readonly group = new THREE.Group();

    render(analyses: AnalysisResult[]): void {
        this.clear();

        for (const analysis of analyses) {
            const point = new THREE.Vector3(...analysis.point);
            const vector = new THREE.Vector3(...analysis.vector);

            if (analysis.show.includes('point')) {
                const dot = new THREE.Mesh(
                    new THREE.SphereGeometry(RENDER_CONFIG.analysis.pointRadius, 16, 16),
                    new THREE.MeshPhongMaterial({ color: 0xffdd44 }),
                );
                dot.position.copy(point);
                this.group.add(dot);
            }

            if (
                analysis.show.includes('normal')
                && vector.lengthSq() > RENDER_CONFIG.analysis.tolerance
            ) {
                const direction = vector.clone().normalize();
                const arrow = new THREE.ArrowHelper(
                    direction,
                    point,
                    RENDER_CONFIG.analysis.arrowLength,
                    0xff6b8a,
                    RENDER_CONFIG.analysis.arrowHeadLength,
                    RENDER_CONFIG.analysis.arrowHeadWidth,
                );
                this.group.add(arrow);
            }

            if (analysis.show.includes('tangent_plane') && analysis.op === 'gradient') {
                const normal = vector.lengthSq() > RENDER_CONFIG.analysis.tolerance
                    ? vector.clone().normalize()
                    : new THREE.Vector3(0, 0, 1);
                const plane = new THREE.Mesh(
                    new THREE.PlaneGeometry(
                        RENDER_CONFIG.analysis.tangentPlaneSize,
                        RENDER_CONFIG.analysis.tangentPlaneSize,
                    ),
                    new THREE.MeshPhongMaterial({
                        color: 0x44aaff,
                        side: THREE.DoubleSide,
                        transparent: true,
                        opacity: RENDER_CONFIG.analysis.tangentPlaneOpacity,
                        depthWrite: false,
                    }),
                );
                plane.position.copy(point);
                plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
                this.group.add(plane);
            }
        }
    }

    clear(): void {
        for (const child of [...this.group.children]) {
            this.group.remove(child);
            child.traverse((node) => {
                if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
                    node.geometry?.dispose();
                    if (Array.isArray(node.material)) {
                        node.material.forEach((material) => material.dispose());
                    } else {
                        node.material?.dispose();
                    }
                }
            });
        }
    }

    dispose(): void {
        this.clear();
    }
}
