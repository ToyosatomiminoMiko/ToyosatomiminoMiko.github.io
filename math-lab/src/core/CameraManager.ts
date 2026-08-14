import * as THREE from 'three';
import { APP_CONFIG } from '../config/appConfig';
import type { CamMode, ViewMode } from '../types';
// OrbitControls 没有独立类型包,从 three/examples 导入类型
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * ============================================================
 * 相机管理器
 * 功能: 管理透视/正交视角,2D/3D 切换
 * 维护两个相机实例: perspCamera (透视) 和 orthoCamera (正交),
 * 通过 activeCamera 指针指向当前使用的相机
 * ============================================================
 */
export class CameraManager {
    container: HTMLElement;
    aspect: number;

    /** 透视相机 */
    perspCamera: THREE.PerspectiveCamera;
    /** 正交相机 */
    orthoCamera: THREE.OrthographicCamera;
    /** 当前激活的相机 */
    activeCamera: THREE.Camera;
    /** 相机投影模式 */
    mode: CamMode;
    /** 视角模式 (2D 俯视 / 3D 自由) */
    viewMode: ViewMode;
    /** OrbitControls 引用 */
    controls: OrbitControls | null;

    /** 预置视角位置 */
    viewPositions: Record<ViewMode, { pos: THREE.Vector3; target: THREE.Vector3 }>;

    constructor(container: HTMLElement) {
        this.container = container;

        // 当前容器宽高比
        this.aspect = this.container.clientWidth / this.container.clientHeight;

        // 透视相机
        this.perspCamera = new THREE.PerspectiveCamera(
            45,
            this.aspect,
            0.1,
            200,
        );
        this.perspCamera.position.set(10, 6, 10);
        this.perspCamera.lookAt(...APP_CONFIG.camera.initViewTarget as [number, number, number]);

        // 正交相机
        const frustumSize = 12;
        const half = frustumSize / 2;
        this.orthoCamera = new THREE.OrthographicCamera(
            -half * this.aspect, half * this.aspect,
            half, -half,
            0.1, 200,
        );
        this.orthoCamera.position.set(0, 0, 15);
        this.orthoCamera.lookAt(...APP_CONFIG.camera.initViewTarget as [number, number, number]);

        // 默认激活透视相机
        this.activeCamera = this.perspCamera;
        this.mode = 'perspective';
        this.viewMode = '3d';
        this.controls = null;

        // 预置视角位置表
        this.viewPositions = {
            '2d': {
                pos: new THREE.Vector3(
                    ...APP_CONFIG.camera.initViewPositions['2d'] as [number, number, number],
                ),
                target: new THREE.Vector3(
                    ...APP_CONFIG.camera.initViewTarget as [number, number, number],
                ),
            },
            '3d': {
                pos: new THREE.Vector3(
                    ...APP_CONFIG.camera.initViewPositions['3d'] as [number, number, number],
                ),
                target: new THREE.Vector3(
                    ...APP_CONFIG.camera.initViewTarget as [number, number, number],
                ),
            },
        };
    }

    /**
     * 绑定 OrbitControls 实例并初始化同步
     */
    setControls(controls: OrbitControls): void {
        this.controls = controls;
        if (this.controls) {
            this.controls.object = this.activeCamera;
            this.controls.target.set(...APP_CONFIG.camera.initViewTarget as [number, number, number]);
            this.controls.update();
        }
    }

    /**
     * 切换相机投影模式 (透视 ↔ 正交)
     */
    setCameraMode(mode: CamMode): void {
        this.mode = mode;
        this._applyView();
    }

    /**
     * 切换视角模式 (2D 俯视 ↔ 3D 自由)
     */
    setViewMode(mode: ViewMode): void {
        this.viewMode = mode;
        this._applyView();
    }

    /**
     * 窗口尺寸变化时更新相机宽高比
     */
    updateAspect(width: number, height: number): void {
        this.aspect = width / height;
        if (this.mode === 'perspective') {
            this.perspCamera.aspect = this.aspect;
            this.perspCamera.updateProjectionMatrix();
        } else {
            const size = this.viewMode === '2d' ? 12 : 14;
            const half = size / 2;
            this.orthoCamera.left = -half * this.aspect;
            this.orthoCamera.right = half * this.aspect;
            this.orthoCamera.top = half;
            this.orthoCamera.bottom = -half;
            this.orthoCamera.updateProjectionMatrix();
        }
    }

    /** 获取当前激活的相机 */
    getCamera(): THREE.Camera {
        return this.activeCamera;
    }

    /** 释放 OrbitControls 占用的资源。单页应用通常不需要，但保留完整生命周期。 */
    dispose(): void {
        this.controls?.dispose();
        this.controls = null;
    }

    // =====================================================
    //  内部方法
    // =====================================================

    /**
     * 核心: 根据当前 mode + viewMode 应用相机参数
     * 包括位置,朝向,投影矩阵,并同步 OrbitControls
     */
    private _applyView(): void {
        const vp = this.viewPositions[this.viewMode];
        const pos = vp.pos.clone();
        const target = vp.target.clone();

        if (this.mode === 'perspective') {
            this.perspCamera.position.copy(pos);
            this.perspCamera.lookAt(target);
            this.perspCamera.aspect = this.aspect;
            this.perspCamera.updateProjectionMatrix();
            this.activeCamera = this.perspCamera;
        } else {
            const size = this.viewMode === '2d' ? 12 : 14;
            const half = size / 2;
            this.orthoCamera.left = -half * this.aspect;
            this.orthoCamera.right = half * this.aspect;
            this.orthoCamera.top = half;
            this.orthoCamera.bottom = -half;

            if (this.viewMode === '2d') {
                this.orthoCamera.position.set(
                    ...APP_CONFIG.camera.initViewPositions['2d'] as [number, number, number],
                );
                this.orthoCamera.lookAt(
                    ...APP_CONFIG.camera.initViewTarget as [number, number, number],
                );
            } else {
                this.orthoCamera.position.set(
                    ...APP_CONFIG.camera.initViewPositions['3d'] as [number, number, number],
                );
                this.orthoCamera.lookAt(
                    ...APP_CONFIG.camera.initViewTarget as [number, number, number],
                );
            }
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
