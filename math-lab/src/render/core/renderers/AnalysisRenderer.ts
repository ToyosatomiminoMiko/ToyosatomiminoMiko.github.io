/**
 * 分析结果渲染器。
 * 从 DslApp 拆出，负责把 gradient/divergence/curl 的点、法向和切平面
 * 渲染到独立 THREE.Group。
 */
import * as THREE from 'three';
import type { AnalysisResult } from '../../../compiler/ir/types';

export class AnalysisRenderer {
    readonly group = new THREE.Group();

    render(analyses: AnalysisResult[]): void {
        this.clear();

        for (const analysis of analyses) {
            const point = new THREE.Vector3(...analysis.point);
            const vector = new THREE.Vector3(...analysis.vector);

            if (analysis.show.includes('point')) {
                const dot = new THREE.Mesh(
                    new THREE.SphereGeometry(0.08, 16, 16),
                    new THREE.MeshPhongMaterial({ color: 0xffdd44 }),
                );
                dot.position.copy(point);
                this.group.add(dot);
            }

            if (analysis.show.includes('normal') && vector.lengthSq() > 1e-12) {
                const direction = vector.clone().normalize();
                const arrow = new THREE.ArrowHelper(direction, point, 1.5, 0xff6b8a, 0.2, 0.1);
                this.group.add(arrow);
            }

            if (analysis.show.includes('tangent_plane') && analysis.op === 'gradient') {
                const normal = vector.lengthSq() > 1e-12
                    ? vector.clone().normalize()
                    : new THREE.Vector3(0, 0, 1);
                const plane = new THREE.Mesh(
                    new THREE.PlaneGeometry(1.6, 1.6),
                    new THREE.MeshPhongMaterial({
                        color: 0x44aaff,
                        side: THREE.DoubleSide,
                        transparent: true,
                        opacity: 0.55,
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
