import * as THREE from 'three';
import { APP_CONFIG } from '../config/appConfig.js';

/*
 * ============================================================
 * 相机管理器
 * 功能: 管理透视/正交,2D/3D切换.
 * 维护两个相机实例: perspCamera (透视) 和 orthoCamera (正交),
 * 通过 activeCamera 指针指向当前使用的相机.
 * ============================================================
 */
export class CameraManager {
    /**
     * @param {THREE.WebGLRenderer} renderer - Three.js 渲染器
     * @param {HTMLElement} container - 画布容器 DOM 元素
     */
    constructor(sceneManager, cameraConfig = {}) {
        this.sceneManager = sceneManager;
        this.container = sceneManager.container;

        // 当前容器宽高比 (用于更新相机投影)
        this.aspect = this.container.clientWidth / this.container.clientHeight;

        // 透视相机 (PerspectiveCamera)
        this.perspCamera = new THREE.PerspectiveCamera(
            45,          // 垂直视野 (FOV)
            this.aspect, // 宽高比
            0.1,         // 近裁剪面
            200          // 远裁剪面
        );
        this.perspCamera.position.set(10, 6, 10);
        this.perspCamera.lookAt(...APP_CONFIG.camera.initViewTarget);

        // 正交相机 (OrthographicCamera)
        const frustumSize = 12;
        const half = frustumSize / 2;
        this.orthoCamera = new THREE.OrthographicCamera(
            -half * this.aspect, half * this.aspect,
            half, -half,
            0.1, 200
        );
        this.orthoCamera.position.set(0, 0, 15);
        this.orthoCamera.lookAt(...APP_CONFIG.camera.initViewTarget);

        /* 当前激活的相机 (默认透视) */
        this.activeCamera = this.perspCamera;

        /* 相机投影模式: 'perspective' | 'orthographic' */
        this.mode = 'perspective';

        /* 视角模式: '2d' (俯视) | '3d' (自由视角) */
        this.viewMode = '3d';

        /* OrbitControls 引用 (用于同步相机切换) */
        this.controls = null;

        /* 预置视角位置表 { '2d', '3d' } */
        this.viewPositions = {
            '2d': {
                pos: new THREE.Vector3(
                    ...APP_CONFIG.camera.initViewPositions['2d']),
                target: new THREE.Vector3(...APP_CONFIG.camera.initViewTarget),
            },
            '3d': {
                pos: new THREE.Vector3(
                    ...APP_CONFIG.camera.initViewPositions['3d']),
                target: new THREE.Vector3(...APP_CONFIG.camera.initViewTarget),
            },
        };
    }

    /**
     * 绑定 OrbitControls 实例并初始化同步
     * @param {OrbitControls} controls
     */
    setControls(controls) {
        this.controls = controls;
        if (this.controls) {
            this.controls.object = this.activeCamera;
            this.controls.target.set(...APP_CONFIG.camera.initViewTarget);
            this.controls.update();
        }
    }

    /**
     * 切换相机投影模式 (透视 <-> 正交)
     * @param {string} mode - 'perspective' | 'orthographic'
     */
    setCameraMode(mode) {
        this.mode = mode;
        this._applyView();
    }

    /**
     * 切换视角模式 (2D俯视 <-> 3D自由)
     * @param {string} mode - '2d' | '3d'
     */
    setViewMode(mode) {
        this.viewMode = mode;
        this._applyView();
    }

    /**
     * 核心: 根据当前 mode + viewMode 应用相机参数
     * 包括位置,朝向,投影矩阵, 并同步 OrbitControls
     */
    _applyView() {
        const vp = this.viewPositions[this.viewMode];
        const pos = vp.pos.clone();
        const target = vp.target.clone();

        if (this.mode === 'perspective') {
            // 透视模式
            this.perspCamera.position.copy(pos);
            this.perspCamera.lookAt(target);
            this.perspCamera.aspect = this.aspect;
            this.perspCamera.updateProjectionMatrix();
            this.activeCamera = this.perspCamera;
        } else {
            // 正交模式
            // 根据视角模式选择视景体大小
            const size = this.viewMode === '2d' ? 12 : 14;
            const half = size / 2;
            this.orthoCamera.left = -half * this.aspect;
            this.orthoCamera.right = half * this.aspect;
            this.orthoCamera.top = half;
            this.orthoCamera.bottom = -half;

            if (this.viewMode === '2d') {
                // 2D正交 面向绘图的面
                this.orthoCamera.position.set(
                    ...APP_CONFIG.camera.initViewPositions['2d']);
                this.orthoCamera.lookAt(...APP_CONFIG.camera.initViewTarget);
            } else {
                this.orthoCamera.position.set(
                    ...APP_CONFIG.camera.initViewPositions['3d']);
                this.orthoCamera.lookAt(...APP_CONFIG.camera.initViewTarget);
            }
            this.orthoCamera.updateProjectionMatrix();
            this.activeCamera = this.orthoCamera;
        }
        if (this.controls) {
            this.controls.object = this.activeCamera;
            //this.controls.target.set(0, 0, 0);
            this.controls.target.copy(target);
            this.controls.update();
        }
    }

    /**
     * 窗口尺寸变化时更新相机宽高比
     * @param {number} width  - 新的容器宽度
     * @param {number} height - 新的容器高度
     */
    updateAspect(width, height) {
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

    /* 获取当前激活的相机 */
    getCamera() {
        return this.activeCamera;
    }
}