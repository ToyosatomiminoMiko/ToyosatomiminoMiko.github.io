/**
 * RenderController —— 3D 视口、相机、绘图与异步计算的渲染编排器.
 *
 * DslApp 只负责把编译结果交给这里，不再直接管理 Three.js 场景、renderer、
 * camera、Plotter、动画和积分可视化.RenderController 对外暴露:
 * - `applyScene`:完整运行或参数刷新后更新对象;
 * - `commitSceneWithoutRedraw`:仅显隐变化时同步 SceneIR 和 overlay;
 * - `frame`:每帧更新 OrbitControls、动画并渲染;
 * - `toggleObject`:切换单个实体的可见性.
 */
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SceneManager } from '../render/core/SceneManager';
import { CameraManager } from '../render/core/CameraManager';
import { Plotter } from '../render/core/Plotter';
import { AnimationPlayer } from '../render/core/AnimationPlayer';
import { AnalysisRenderer } from '../render/core/renderers/AnalysisRenderer';
import { DslIntegralRenderer } from '../render/visualization/DslIntegralRenderer';
import { MathComputeEngine } from '../math/compute/MathComputeEngine';
import { CameraToggle } from '../render/controls/CameraToggle';
import { ViewCubeController } from '../render/controls/ViewCubeController';
import { RotationLockController } from '../render/controls/RotationLockController';
import type { SceneIR, SceneObject } from '../compiler/ir/types';
import type { MathLabEvents } from '../types';
import { EventBus } from '../service/EventBus';
import { SceneStore } from './SceneStore';
import { DiagnosticsController } from '../ui/DiagnosticsController';
import { ObjectListController } from '../ui/ObjectListController';
import { disposeCurveComputeClient } from '../math/compute/workers/CurveComputeClient';
import { disposeSurfaceComputeClient } from '../math/compute/workers/SurfaceComputeClient';
import { disposeVectorFieldComputeClient } from '../math/compute/workers/VectorFieldComputeClient';
import { disposeIntegralWorker } from '../math/compute/IntegralWasm';

export class RenderController {
    private readonly sceneManager: SceneManager;
    private readonly cameraManager: CameraManager;
    private readonly plotter: Plotter;
    private readonly animationPlayer: AnimationPlayer;
    private readonly analysisRenderer: AnalysisRenderer;
    private readonly integralRenderer: DslIntegralRenderer;
    private readonly computeEngine: MathComputeEngine;

    private controls: OrbitControls | null = null;
    private cameraToggle: CameraToggle | null = null;
    private viewCubeController: ViewCubeController | null = null;
    private rotationLockController: RotationLockController | null = null;

    /**
     * @cache
     * 缓存目的:保存上一份 SceneIR 的对象快照，用于识别消失对象并移除 renderer.
     * 键/失效策略:applyScene/commitSceneWithoutRedraw 后整体替换.
     * 生命周期:跟随 RenderController 实例.
     */
    private previousObjects: SceneObject[] = [];

    constructor(
        viewport: HTMLElement,
        private readonly store: SceneStore,
        private readonly diagnosticsController: DiagnosticsController,
        private readonly objectListController: ObjectListController,
    ) {
        this.sceneManager = new SceneManager(viewport);
        this.cameraManager = new CameraManager(viewport);
        this.plotter = new Plotter(this.sceneManager.getScene());
        this.computeEngine = new MathComputeEngine();
        this.integralRenderer = new DslIntegralRenderer(
            this.sceneManager.getScene(),
            this.computeEngine,
        );
        this.analysisRenderer = new AnalysisRenderer();
        this.animationPlayer = new AnimationPlayer(this.store.matrixOps);
        this.sceneManager.getScene().add(this.analysisRenderer.group);
    }

    setupControls(): void {
        const renderer = this.sceneManager.getRenderer();
        const controls = new OrbitControls(
            this.cameraManager.getCamera(),
            renderer.domElement,
        );
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.target.set(0, 0, 0);
        controls.update();
        this.cameraManager.setControls(controls);
        this.controls = controls;
    }

    /** 把相机相关 UI 控件挂到 EventBus，保持 DslApp 不直接处理相机细节. */
    wireViewControls(eventBus: EventBus<MathLabEvents>): void {
        this.cameraToggle = new CameraToggle(eventBus);
        this.viewCubeController = new ViewCubeController(eventBus);
        this.rotationLockController = new RotationLockController(eventBus);

        eventBus.on('camera:changed', ({ camMode }) =>
            this.cameraManager.setCameraMode(camMode),
        );
        eventBus.on('camera:view', ({ view }) =>
            this.cameraManager.setView(view),
        );
        eventBus.on('camera:rotationLock', ({ locked }) =>
            this.cameraManager.setRotationLock(locked),
        );
    }

    /** 每帧执行一次，由 DslApp 的 requestAnimationFrame 循环调用. */
    frame(timestamp: number): void {
        this.controls?.update();
        this._updateAnimations(timestamp);
        this.sceneManager.render(this.cameraManager.getCamera());
    }

    resize(): void {
        const { width, height } = this.sceneManager.resize();
        this.cameraManager.updateAspect(width, height);
    }

    resetHome(): void {
        if (!this.controls) return;
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    /**
     * 完整应用一份 SceneIR.
     *
     * @param changedParams 传入集合时只重绘依赖这些参数的对象;不传则视为
     *                      完整运行，所有对象都重新采样.
     */
    applyScene(
        scene: SceneIR,
        changedParams?: ReadonlySet<string>,
    ): void {
        this.animationPlayer.configure(this.store.matrixOps);

        const nextIds = new Set(scene.objects.map((object) => object.id));

        for (const id of this.store.hiddenEntityIds) {
            if (!nextIds.has(id)) this.store.setEntityHidden(id, false);
        }
        for (const object of scene.objects) {
            object.enabled = !this.store.isEntityHidden(object.id);
        }

        this.store.setScene(scene);
        this.animationPlayer.setScene(
            scene.objectTransforms,
            scene.animations,
            scene.objectAnimations,
        );

        for (const previous of this.previousObjects) {
            if (!nextIds.has(previous.id)) {
                this.plotter.remove(previous.id);
            }
        }

        const dirtyObjectIds = new Set<number>();
        for (const object of scene.objects) {
            if (!object.enabled) {
                this.plotter.setVisible(object.id, false);
                continue;
            }

            const shouldRedraw = !changedParams
                || this._objectDependsOnParams(object, changedParams);
            if (shouldRedraw) {
                dirtyObjectIds.add(object.id);
                this.plotter.updateObject(object, true);
                this._applyObjectTransform(object.id);
            } else {
                // 引用仍需同步，否则后续其他参数变化时，renderer 手里还拿着旧数据.
                this.plotter.updateObject(object, false);
            }
        }

        this.previousObjects = scene.objects;
        this._syncOverlays(scene, changedParams ? dirtyObjectIds : null);
    }

    /**
     * 显隐变化时不需要重新采样几何对象，只需更新 SceneIR、动画时间线
     * 和分析/积分/对象列表等 overlay.
     */
    commitSceneWithoutRedraw(scene: SceneIR): void {
        this.animationPlayer.configure(this.store.matrixOps);
        this.store.setScene(scene);
        this.animationPlayer.setScene(
            scene.objectTransforms,
            scene.animations,
            scene.objectAnimations,
        );
        this.previousObjects = scene.objects;
        this._syncOverlays(scene, null);
    }

    toggleObject(object: SceneObject): void {
        const nextVisible = !object.enabled;
        object.enabled = nextVisible;
        this.store.setEntityHidden(object.id, !nextVisible);

        if (nextVisible) {
            this.plotter.updateObject(object, true);
            this._applyObjectTransform(object.id);
        } else {
            this.plotter.setVisible(object.id, false);
        }

        this.objectListController.setEntityVisible(object.id, nextVisible);
    }

    dispose(): void {
        this.controls?.dispose();
        this.cameraToggle?.dispose();
        this.viewCubeController?.dispose();
        this.rotationLockController?.dispose();
        this.cameraManager.dispose();
        this.integralRenderer.dispose();
        this.analysisRenderer.dispose();
        this.plotter.dispose();
        this.computeEngine.dispose();
        this.sceneManager.dispose();

        // 共享 worker 必须最后统一 terminate;前面的 renderer.dispose()
        // 已经不再拥有销毁这些 client 的权利.
        disposeCurveComputeClient();
        disposeSurfaceComputeClient();
        disposeVectorFieldComputeClient();
        disposeIntegralWorker();
    }

    private _updateAnimations(timestamp: number): void {
        if (this.store.animationStartTime === 0) return;

        const elapsedSeconds =
            (timestamp - this.store.animationStartTime) / 1000;
        for (const object of this.store.compiledObjects) {
            if (!object.enabled) continue;
            this._applyObjectTransform(object.id, elapsedSeconds);
        }
    }

    private _applyObjectTransform(
        id: number,
        elapsedSeconds?: number,
    ): void {
        const elapsed = elapsedSeconds ?? this.store.getElapsedSeconds();
        const matrix = this.animationPlayer.getObjectMatrix(id, elapsed);
        this.plotter.applyTransform(id, matrix);
    }

    private _syncOverlays(
        scene: SceneIR,
        dirtyObjectIds: ReadonlySet<number> | null,
    ): void {
        this.diagnosticsController.clear();
        this.objectListController.renderScene(scene);
        this.analysisRenderer.render(
            scene.analyses.filter((analysis) => analysis.enabled),
        );
        this.integralRenderer.sync(
            scene.integrals,
            scene.objects,
            (level, message) => this.diagnosticsController.add(level, message),
            dirtyObjectIds,
            (name, value) =>
                this.objectListController.setIntegralResult(name, value),
            (name, message) =>
                this.objectListController.setIntegralError(name, message),
        );
    }

    /**
     * point/vector 的坐标表达式虽然暂时没有 coefficients 字段，
     * 但它们也可能引用 param，因此参数变化时保守地标记为 dirty.
     */
    private _objectDependsOnParams(
        object: SceneObject,
        changedParams: ReadonlySet<string>,
    ): boolean {
        if (object.kind === 'point' || object.kind === 'vector') {
            return true;
        }
        return object.coefficients.some((coefficient) =>
            changedParams.has(coefficient.name),
        );
    }
}
