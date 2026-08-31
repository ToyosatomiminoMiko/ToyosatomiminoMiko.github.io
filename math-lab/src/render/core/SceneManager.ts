import * as THREE from 'three';
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
        const axesHelper = new THREE.AxesHelper(RENDER_CONFIG.scene.axesLength);
        this.scene.add(axesHelper);
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

    render(camera: THREE.Camera): void {
        this.renderer.render(this.scene, camera);
    }

    resize(): { width: number; height: number } {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.renderer.setSize(width, height);
        return { width, height };
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
