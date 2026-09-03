import * as THREE from 'three';
import { APP_CONFIG } from '../../config/appConfig';
import { RENDER_CONFIG, type UpAxis } from '../../config/renderConfig';
import type { CamMode, ViewHome } from '../../types';
// OrbitControls 没有独立类型包,从 three/examples 导入类型
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** 三条坐标轴的正方向(单位向量). */
const UP_VECTORS: Record<UpAxis, readonly [number, number, number]> = {
    x: [1, 0, 0],
    y: [0, 1, 0],
    z: [0, 0, 1],
};

/**
 * 预设视角的观察方向(相机从该方向看向原点).
 *
 * top/bottom 永远沿"向上轴";其余轴按右手系 (right, up, front) 推导,
 * 保证切换向上轴后"上/前/右"仍然是一套自洽的坐标习惯:
 * - Y 向上(Three.js/图形):right = X,front = Z;
 * - Z 向上(数学/工程):right = X,front = -Y;
 * - X 向上(少数工程/地理工具):right = Y,front = -Z.
 */
const VIEW_DIRECTIONS: Record<
    UpAxis,
    Record<'top' | 'bottom' | 'front' | 'back' | 'left' | 'right', readonly [number, number, number]>
> = {
    x: {
        top: [1, 0, 0],
        bottom: [-1, 0, 0],
        front: [0, 0, -1],
        back: [0, 0, 1],
        right: [0, 1, 0],
        left: [0, -1, 0],
    },
    y: {
        top: [0, 1, 0],
        bottom: [0, -1, 0],
        front: [0, 0, 1],
        back: [0, 0, -1],
        right: [1, 0, 0],
        left: [-1, 0, 0],
    },
    z: {
        top: [0, 0, 1],
        bottom: [0, 0, -1],
        front: [0, -1, 0],
        back: [0, 1, 0],
        right: [1, 0, 0],
        left: [-1, 0, 0],
    },
};

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

    /** 当前"正方向朝上"的轴. */
    private upAxis: UpAxis;
    private readonly upVector = new THREE.Vector3();

    constructor(container: HTMLElement) {
        this.container = container;
        this.aspect = this.container.clientWidth / this.container.clientHeight;

        this.upAxis = RENDER_CONFIG.scene.upAxis;
        this.upVector.set(...UP_VECTORS[this.upAxis]);

        this.perspCamera = new THREE.PerspectiveCamera(
            APP_CONFIG.camera.perspFov,
            this.aspect,
            APP_CONFIG.camera.near,
            APP_CONFIG.camera.far,
        );
        this.perspCamera.up.copy(this.upVector);
        this.perspCamera.position.set(...APP_CONFIG.camera.defaultPosition as [number, number, number]);
        this.perspCamera.lookAt(...APP_CONFIG.camera.initViewTarget as [number, number, number]);

        const half = APP_CONFIG.camera.frustumSize / 2;
        this.orthoCamera = new THREE.OrthographicCamera(
            -half * this.aspect, half * this.aspect,
            half, -half,
            APP_CONFIG.camera.near, APP_CONFIG.camera.far,
        );
        this.orthoCamera.up.copy(this.upVector);
        this.orthoCamera.position.set(...APP_CONFIG.camera.defaultPosition as [number, number, number]);
        this.orthoCamera.lookAt(...APP_CONFIG.camera.initViewTarget as [number, number, number]);

        this.activeCamera = this.perspCamera;
        this.mode = APP_CONFIG.camera.defaultMode;
        this.currentHome = APP_CONFIG.camera.defaultHome;
        this.controls = null;
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

    /**
     * 切换"正方向朝上"的轴,并立即按当前预设视角重新取景.
     *
     * @returns 是否真的发生了切换(用于调用方决定是否重建 OrbitControls).
     */
    setUpAxis(axis: UpAxis): boolean {
        if (axis === this.upAxis) return false;
        this.upAxis = axis;
        this.upVector.set(...UP_VECTORS[axis]);
        this._applyView();
        return true;
    }

    /** 释放并解绑 OrbitControls,供切换向上轴后重建. */
    detachControls(): void {
        this.controls?.dispose();
        this.controls = null;
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
        this.detachControls();
    }

    private _applyView(): void {
        const target = new THREE.Vector3(0, 0, 0);
        const pos = this.currentHome === 'isometric'
            ? new THREE.Vector3(
                ...APP_CONFIG.camera.defaultPosition as [number, number, number],
            )
            : this._homePosition(this.currentHome);

        if (this.mode === 'perspective') {
            this.perspCamera.up.copy(this.upVector);
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
            this.orthoCamera.up.copy(this.upVector);
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

    /** 计算 top/bottom/front/back/left/right 预设视角的相机位置. */
    private _homePosition(
        home: Exclude<ViewHome, 'isometric'>,
    ): THREE.Vector3 {
        const direction = VIEW_DIRECTIONS[this.upAxis][home];
        const distance = APP_CONFIG.camera.viewDistance;
        return new THREE.Vector3(
            direction[0] * distance,
            direction[1] * distance,
            direction[2] * distance,
        );
    }
}
