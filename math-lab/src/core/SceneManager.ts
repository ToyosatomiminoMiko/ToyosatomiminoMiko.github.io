import * as THREE from 'three';

/**
 * 场景管理器 — 负责创建场景、渲染器、灯光、坐标轴等基础元素。
 * CameraManager 通过注入 SceneManager 获取 renderer 引用。
 */
export class SceneManager {
    container: HTMLElement;
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;

    constructor(container: HTMLElement) {
        this.container = container;

        // --- 场景 ---
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111122);

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
        const axesHelper = new THREE.AxesHelper(8);
        this.scene.add(axesHelper);

        const gridHelper = new THREE.GridHelper(20, 20);
        this.scene.add(gridHelper);

        const sphereGeo = new THREE.SphereGeometry(0.2, 16, 16);
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const centerSphere = new THREE.Mesh(sphereGeo, sphereMat);
        this.scene.add(centerSphere);

        // --- XYZ 轴标签（使用 Sprite）---
        const makeLabel = (text: string, position: THREE.Vector3): void => {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = 'rgba(0,0,0,0)';
            ctx.fillRect(0, 0, 64, 64);
            ctx.font = 'Bold 36px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 4;
            ctx.fillText(text, 32, 32);

            const texture = new THREE.CanvasTexture(canvas);
            const material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                depthTest: false,
            });
            const sprite = new THREE.Sprite(material);
            sprite.position.copy(position);
            sprite.scale.set(0.8, 0.8, 1);
            this.scene.add(sprite);
        };

        const axisLen = 8.5;
        makeLabel('X', new THREE.Vector3(axisLen, 0, 0));
        makeLabel('Y', new THREE.Vector3(0, axisLen, 0));
        makeLabel('Z', new THREE.Vector3(0, 0, axisLen));
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
        this.renderer.dispose();
        // 清理场景中所有几何体和材质
        this.scene.traverse((node: THREE.Object3D) => {
            if (node instanceof THREE.Mesh) {
                node.geometry?.dispose();
                if (Array.isArray(node.material)) {
                    node.material.forEach(m => m.dispose());
                } else {
                    node.material?.dispose();
                }
            }
        });
    }
}