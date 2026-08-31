import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { RENDER_CONFIG } from '../../config/renderConfig';

/**
 * 场景管理器 — 负责创建场景,渲染器,灯光,坐标轴等基础元素
 * CameraManager 通过注入 SceneManager 获取 renderer 引用
 */
export class SceneManager {
    container: HTMLElement;
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    private readonly centerSphere: THREE.Mesh;
    /** Line2 坐标轴材质,resize 时同步分辨率,线宽变化时统一更新 */
    private readonly axisLineMaterials: LineMaterial[] = [];

    constructor(container: HTMLElement) {
        this.container = container;

        // --- 场景 ---
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(RENDER_CONFIG.scene.background);

        // --- 光源 ---
        const ambientLight = new THREE.AmbientLight(0x404060);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(5, 10, 7);
        this.scene.add(dirLight);

        // --- 渲染器 ---
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        // --- 辅助元素 ---
        // XYZ 坐标轴改用 Line2 绘制,支持像素线宽
        this.createAxisLine(
            [0, 0, 0],
            [RENDER_CONFIG.scene.axesLength, 0, 0],
            RENDER_CONFIG.scene.axisColors.x,
        );
        this.createAxisLine(
            [0, 0, 0],
            [0, RENDER_CONFIG.scene.axesLength, 0],
            RENDER_CONFIG.scene.axisColors.y,
        );
        this.createAxisLine(
            [0, 0, 0],
            [0, 0, RENDER_CONFIG.scene.axesLength],
            RENDER_CONFIG.scene.axisColors.z,
        );
        // 坐标系网格
        const gridHelper = new THREE.GridHelper(
            RENDER_CONFIG.scene.gridSize,
            RENDER_CONFIG.scene.gridDivisions,
            undefined, // 坐标轴线颜色已经设置
            RENDER_CONFIG.scene.gridColor
        );
        // gridHelper.traverse((child) => {
        //     if (child instanceof THREE.LineSegments) {
        //         child.material.transparent = true;
        //         child.material.opacity = 0;  // 网格坐标轴透明
        //         child.material.depthWrite = false; // 不写入深度缓冲,避免遮挡其他物体
        //     }
        // });
        this.scene.add(gridHelper);

        // 原点小球:使用单位球,大小/缩放通过 scale 控制,避免每次改值重建几何体
        const sphereGeo = new THREE.SphereGeometry(1, 16, 16);
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.centerSphere = new THREE.Mesh(sphereGeo, sphereMat);
        this.centerSphere.scale.setScalar(
            RENDER_CONFIG.scene.originPoint.radius
            * RENDER_CONFIG.scene.originPoint.scale,
        );
        this.centerSphere.visible = RENDER_CONFIG.scene.originPoint.visible;
        this.scene.add(this.centerSphere);

        // --- XYZ 轴标签(使用 Sprite)---
        const makeLabel = (text: string, position: THREE.Vector3, color: string): void => {
            const canvas = document.createElement('canvas');
            canvas.width = RENDER_CONFIG.scene.labelCanvasSize;
            canvas.height = RENDER_CONFIG.scene.labelCanvasSize;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = 'rgba(0,0,0,0)';
            ctx.fillRect(0, 0, RENDER_CONFIG.scene.labelCanvasSize, RENDER_CONFIG.scene.labelCanvasSize);
            ctx.font = RENDER_CONFIG.scene.labelFont; // 字体设置加载预设
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = color; // 使用传入的颜色
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 4;
            ctx.fillText(
                text,
                RENDER_CONFIG.scene.labelCanvasSize / 2,
                RENDER_CONFIG.scene.labelCanvasSize / 2,
            );

            const texture = new THREE.CanvasTexture(canvas);
            const material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                depthTest: false,
            });
            const sprite = new THREE.Sprite(material);
            sprite.position.copy(position);
            sprite.scale.set(
                RENDER_CONFIG.scene.labelScale,
                RENDER_CONFIG.scene.labelScale,
                1,
            );
            this.scene.add(sprite);
        };

        const axisLen = RENDER_CONFIG.scene.axisLabelLength;
        // X 红色 | Y 绿色 | Z 蓝色 与 AxesHelper 配色一致
        makeLabel('X', new THREE.Vector3(axisLen, 0, 0), RENDER_CONFIG.scene.axisColors.x);
        makeLabel('Y', new THREE.Vector3(0, axisLen, 0), RENDER_CONFIG.scene.axisColors.y);
        makeLabel('Z', new THREE.Vector3(0, 0, axisLen), RENDER_CONFIG.scene.axisColors.z);
    }

    getScene(): THREE.Scene {
        return this.scene;
    }

    getRenderer(): THREE.WebGLRenderer {
        return this.renderer;
    }

    addToScene(object: THREE.Object3D): void {
        this.scene.add(object);
    }

    removeFromScene(object: THREE.Object3D): void {
        this.scene.remove(object);
    }

    /** 设置原点小球可见性 */
    setOriginVisible(visible: boolean): void {
        this.centerSphere.visible = visible;
    }

    /** 设置原点小球半径(已由调用方计算 大小 × 比例缩放) */
    setOriginRadius(radius: number): void {
        this.centerSphere.scale.setScalar(Math.max(0, radius));
    }

    /** 设置坐标轴线宽(像素) */
    setAxisLineWidth(width: number): void {
        const clamped = Math.max(1, width);
        for (const material of this.axisLineMaterials) {
            material.linewidth = clamped;
        }
    }

    render(camera: THREE.Camera): void {
        this.renderer.render(this.scene, camera);
    }

    resize(): { width: number; height: number } {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.renderer.setSize(width, height);
        for (const material of this.axisLineMaterials) {
            material.resolution.set(width, height);
        }
        return { width, height };
    }

    /**
     * 创建一段 Line2 坐标轴,并记录材质供线宽/分辨率更新.
     */
    private createAxisLine(
        start: [number, number, number],
        end: [number, number, number],
        color: string,
    ): void {
        const geometry = new LineGeometry();
        geometry.setPositions([...start, ...end]);

        const material = new LineMaterial({
            color,
            linewidth: RENDER_CONFIG.scene.axisLineWidth,
            resolution: new THREE.Vector2(
                this.container.clientWidth,
                this.container.clientHeight,
            ),
        });
        const line = new Line2(geometry, material);
        this.scene.add(line);
        this.axisLineMaterials.push(material);
    }

    dispose(): void {
        this.scene.traverse((node: THREE.Object3D) => {
            if (
                node instanceof THREE.Mesh
                || node instanceof THREE.Line
                || node instanceof THREE.Points
            ) {
                node.geometry?.dispose();
                const materials = Array.isArray(node.material) ? node.material : [node.material];
                for (const material of materials) {
                    const texturedMaterial = material as {
                        map?: THREE.Texture | null;
                        dispose?: () => void;
                    };
                    texturedMaterial.map?.dispose();
                    texturedMaterial.dispose?.();
                }
            } else if (node instanceof THREE.Sprite) {
                node.geometry?.dispose();
                node.material.map?.dispose();
                node.material.dispose();
            }
        });

        this.renderer.dispose();
        if (this.renderer.domElement.parentElement === this.container) {
            this.container.removeChild(this.renderer.domElement);
        }
    }
}
