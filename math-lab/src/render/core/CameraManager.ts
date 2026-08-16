import * as THREE from 'three';
import { APP_CONFIG } from '../../config/appConfig';
import type { CamMode, ViewHome } from '../../types';
// OrbitControls 没有独立类型包,从 three/examples 导入类型
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * 相机管理器
 * - 管理透视/正交投影切换
 * - 管理 ViewCube 的预置观察方向
 * - 管理旋转锁定(平移和缩放保持可用)
 */
export class CameraManager {
    container: HTMLElement;
    aspect: number;

    perspCamera: THREE.PerspectiveCamera;
    orthoCamera: THREE.OrthographicCamera;
    activeCamera: THREE.Camera;
    mode: CamMode;
    currentHome: ViewHome;
    controls: OrbitControls | null;

    viewPositions: Record<ViewHome, { pos: THREE.Vector3; target: THREE.Vector3 }>;

    constructor(container: HTMLElement) {
        this.container = container;
        this.aspect = this.container.clientWidth / this.container.clientHeight;

        this.perspCamera = new THREE.PerspectiveCamera(
            APP_CONFIG.camera.perspFov,
            this.aspect,
            APP_CONFIG.camera.near,
            APP_CONFIG.camera.far,
        );
        this.perspCamera.position.set(...APP_CONFIG.camera.defaultPosition as [number, number, number]);
        this.perspCamera.lookAt(...APP_CONFIG.camera.initViewTarget as [number, number, number]);

        const half = APP_CONFIG.camera.frustumSize / 2;
        this.orthoCamera = new THREE.OrthographicCamera(
            -half * this.aspect, half * this.aspect,
            half, -half,
            APP_CONFIG.camera.near, APP_CONFIG.camera.far,
        );
        this.orthoCamera.position.set(...APP_CONFIG.camera.defaultPosition as [number, number, number]);
        this.orthoCamera.lookAt(...APP_CONFIG.camera.initViewTarget as [number, number, number]);

        this.activeCamera = this.perspCamera;
        this.mode = APP_CONFIG.camera.defaultMode;
        this.currentHome = APP_CONFIG.camera.defaultHome;
        this.controls = null;

        const viewDistance = APP_CONFIG.camera.viewDistance;
        this.viewPositions = {
            top: { pos: new THREE.Vector3(0, viewDistance, 0), target: new THREE.Vector3(0, 0, 0) },
            bottom: { pos: new THREE.Vector3(0, -viewDistance, 0), target: new THREE.Vector3(0, 0, 0) },
            front: { pos: new THREE.Vector3(0, 0, viewDistance), target: new THREE.Vector3(0, 0, 0) },
            back: { pos: new THREE.Vector3(0, 0, -viewDistance), target: new THREE.Vector3(0, 0, 0) },
            left: { pos: new THREE.Vector3(-viewDistance, 0, 0), target: new THREE.Vector3(0, 0, 0) },
            right: { pos: new THREE.Vector3(viewDistance, 0, 0), target: new THREE.Vector3(0, 0, 0) },
            isometric: {
                pos: new THREE.Vector3(...APP_CONFIG.camera.defaultPosition as [number, number, number]),
                target: new THREE.Vector3(0, 0, 0),
            },
        };
    }

    setControls(controls: OrbitControls): void {
        this.controls = controls;
        if (this.controls) {
            this.controls.object = this.activeCamera;
            this.controls.target.set(...APP_CONFIG.camera.initViewTarget as [number, number, number]);
            this.controls.update();
        }
    }

    setCameraMode(mode: CamMode): void {
        this.mode = mode;
        this._applyView();
    }

    setView(home: ViewHome): void {
        this.currentHome = home;
        this._applyView();
    }

    setRotationLock(locked: boolean): void {
        if (this.controls) {
            this.controls.enableRotate = !locked;
        }
    }

    updateAspect(width: number, height: number): void {
        this.aspect = width / height;
        if (this.mode === 'perspective') {
            this.perspCamera.aspect = this.aspect;
            this.perspCamera.updateProjectionMatrix();
        } else {
            const half = APP_CONFIG.camera.frustumSize / 2;
            this.orthoCamera.left = -half * this.aspect;
            this.orthoCamera.right = half * this.aspect;
            this.orthoCamera.top = half;
            this.orthoCamera.bottom = -half;
            this.orthoCamera.updateProjectionMatrix();
        }
    }

    getCamera(): THREE.Camera {
        return this.activeCamera;
    }

    dispose(): void {
        this.controls?.dispose();
        this.controls = null;
    }

    private _applyView(): void {
        const vp = this.viewPositions[this.currentHome];
        const pos = vp.pos.clone();
        const target = vp.target.clone();

        if (this.mode === 'perspective') {
            this.perspCamera.position.copy(pos);
            this.perspCamera.lookAt(target);
            this.perspCamera.aspect = this.aspect;
            this.perspCamera.updateProjectionMatrix();
            this.activeCamera = this.perspCamera;
        } else {
            const half = APP_CONFIG.camera.frustumSize / 2;
            this.orthoCamera.left = -half * this.aspect;
            this.orthoCamera.right = half * this.aspect;
            this.orthoCamera.top = half;
            this.orthoCamera.bottom = -half;
            this.orthoCamera.position.copy(pos);
            this.orthoCamera.lookAt(target);
            this.orthoCamera.updateProjectionMatrix();
            this.activeCamera = this.orthoCamera;
        }

        if (this.controls) {
            this.controls.object = this.activeCamera;
            this.controls.target.copy(target);
            this.controls.update();
        }
    }
}
