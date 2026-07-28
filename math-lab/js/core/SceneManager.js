import * as THREE from 'three';

/*
CameraManager 当前持有 renderer 引用
SceneManager 接管后, CameraManager 需要改为依赖 SceneManager
*/
export class SceneManager {
    constructor(container) {
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
        // --- XYZ 轴标签 使用 Sprite ---
        const makeLabel = (text, position) => {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
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
            return sprite;
        };
        const axisLen = 8.5;
        this.scene.add(makeLabel('X', new THREE.Vector3(axisLen, 0, 0)));
        this.scene.add(makeLabel('Y', new THREE.Vector3(0, axisLen, 0)));
        this.scene.add(makeLabel('Z', new THREE.Vector3(0, 0, axisLen)));
    }

    getScene() { return this.scene; }
    getRenderer() { return this.renderer; }

    addToScene(object) { this.scene.add(object); }
    removeFromScene(object) { this.scene.remove(object); }

    render(camera) {
        this.renderer.render(this.scene, camera);
    }

    resize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.renderer.setSize(width, height);
        return { width, height };
    }

    dispose() {
        this.renderer.dispose();
        // 清理场景中所有几何体和材质
        this.scene.traverse(node => {
            if (node.isMesh) {
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