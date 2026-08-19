import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SceneManager } from '../render/core/SceneManager';
import { CameraManager } from '../render/core/CameraManager';
import { Plotter } from '../render/core/Plotter';
import { AnimationPlayer } from '../render/core/AnimationPlayer';
import { createWasmMatrixOps, parseMiko } from '../compiler/parser';
import { createMatrixOps, type MatrixOps } from '../math/tensor/SceneTransform';
import { compileScene } from '../compiler/dsl/DslCompiler';
import type {
    SceneIR,
    SceneObject,
} from '../compiler/ir/types';
import { EventBus } from '../service/EventBus';
import type { MathLabEvents } from '../types';
import type { AstProgram } from '../compiler/ast/types';
import { CameraToggle } from '../render/controls/CameraToggle';
import { ViewCubeController } from '../render/controls/ViewCubeController';
import { RotationLockController } from '../render/controls/RotationLockController';
import { PanelController } from '../ui/PanelController';
import { ParamPanelController } from '../ui/ParamPanelController';
import { DiagnosticsController } from '../ui/DiagnosticsController';
import { ObjectListController } from '../ui/ObjectListController';
import { AnalysisRenderer } from '../render/core/renderers/AnalysisRenderer';
import { DslIntegralRenderer } from '../render/visualization/DslIntegralRenderer';
import { MathComputeEngine } from '../math/compute/MathComputeEngine';
import { disposeIntegralWorker } from '../math/compute/IntegralWasm';
import { disposeCurveComputeClient } from '../math/compute/workers/CurveComputeClient';
import { disposeSurfaceComputeClient } from '../math/compute/workers/SurfaceComputeClient';
import { disposeVectorFieldComputeClient } from '../math/compute/workers/VectorFieldComputeClient';

/**
 * OpenSCAD 式 DSL Shell.
 *
 * 源码是唯一真相源:
 * 编辑 -> parseMiko -> compileScene -> 3D 视口 + param 面板 + 对象列表.
 */
export class DslApp {
    private readonly eventBus = new EventBus<MathLabEvents>();
    private readonly viewport: HTMLElement;
    private readonly sceneManager: SceneManager;
    private readonly cameraManager: CameraManager;
    private readonly plotter: Plotter;
    private readonly integralRenderer: DslIntegralRenderer;
    private readonly computeEngine = new MathComputeEngine();
    private readonly paramPanelController: ParamPanelController;
    private readonly diagnosticsController: DiagnosticsController;
    private readonly objectListController: ObjectListController;
    private readonly analysisRenderer: AnalysisRenderer;
    private readonly animationPlayer: AnimationPlayer;
    private matrixOps: MatrixOps = createMatrixOps();
    private readonly editor: HTMLTextAreaElement;
    private readonly runButton: HTMLButtonElement;
    private panelController: PanelController | null = null;
    private cameraToggle: CameraToggle | null = null;
    private viewCubeController: ViewCubeController | null = null;
    private rotationLockController: RotationLockController | null = null;

    private controls: OrbitControls | null = null;
    private animationFrameId: number | null = null;
    private refreshFrame: number | null = null;
    private readonly pendingParamChanges = new Set<string>();
    private runSequence = 0;
    private compiledObjects: SceneObject[] = [];
    private objectTransforms: Record<number, number[][]> = {};
    private animationStartTime = 0;
    private currentAst: AstProgram | null = null;
    private readonly hiddenEntityIds = new Set<number>();
    private readonly hiddenAnalysisNames = new Set<string>();
    private readonly hiddenIntegralNames = new Set<string>();
    private lastRunSource = '';
    private disposed = false;

    private readonly onResize = (): void => {
        const { width, height } = this.sceneManager.resize();
        this.cameraManager.updateAspect(width, height);
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Home' && this.controls) {
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        }
    };

    constructor() {
        this.viewport = document.getElementById('viewport')!;
        this.editor = document.getElementById('dsl-editor') as HTMLTextAreaElement;
        this.runButton = document.getElementById('run-btn') as HTMLButtonElement;
        const paramsPanel = document.getElementById('params-panel')!;
        const diagnostics = document.getElementById('diagnostics')!;
        const entityList = document.getElementById('entity-object-list')!;
        const analysisList = document.getElementById('analysis-object-list')!;
        const integralList = document.getElementById('integral-object-list')!;

        this.sceneManager = new SceneManager(this.viewport);
        this.cameraManager = new CameraManager(this.viewport);
        this.plotter = new Plotter(this.sceneManager.getScene());
        this.integralRenderer = new DslIntegralRenderer(
            this.sceneManager.getScene(),
            this.computeEngine,
        );
        this.paramPanelController = new ParamPanelController(paramsPanel, (name) => this._scheduleRefresh(name));
        this.diagnosticsController = new DiagnosticsController(diagnostics);
        this.objectListController = new ObjectListController(
            entityList,
            analysisList,
            integralList,
            (id) => this._toggleObject(id),
            (name) => this._toggleAnalysis(name),
            (name) => this._toggleIntegral(name),
        );
        this.analysisRenderer = new AnalysisRenderer();
        this.animationPlayer = new AnimationPlayer(this.matrixOps);
        this.sceneManager.getScene().add(this.analysisRenderer.group);
    }

    start(): void {
        this._setupControls();
        this._wireViewControls();
        this._wireEditor();
        this.panelController = new PanelController();
        this.panelController.bind(document.getElementById('app')!);
        window.addEventListener('resize', this.onResize);
        document.addEventListener('keydown', this.onKeyDown);
        this.animationFrameId = requestAnimationFrame(this.animate);
        this.run();
    }

    dispose(): void {
        this.disposed = true;
        if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
        this._cancelPendingRefresh();
        window.removeEventListener('resize', this.onResize);
        document.removeEventListener('keydown', this.onKeyDown);
        this.controls?.dispose();
        this.panelController?.dispose();
        this.cameraToggle?.dispose();
        this.viewCubeController?.dispose();
        this.rotationLockController?.dispose();
        this.cameraManager.dispose();
        this.integralRenderer.dispose();
        this.paramPanelController.dispose();
        this.diagnosticsController.dispose();
        this.objectListController.dispose();
        this.analysisRenderer.dispose();
        this.plotter.dispose();
        this.computeEngine.dispose();
        this.sceneManager.dispose();
        // 共享 worker 必须最后统一 terminate；前面的 renderer.dispose()
        // 已经不再拥有销毁这些 client 的权利.
        disposeCurveComputeClient();
        disposeSurfaceComputeClient();
        disposeVectorFieldComputeClient();
        disposeIntegralWorker();
    }

    async run(): Promise<void> {
        /*
         * 入口流程（一次运行只编译一次场景）:
         *
         *   editor.value
         *       │
         *       ▼
         *   parseMiko(source)          // Rust pest 解析为 AST
         *       │
         *       ▼
         *   compileScene(ast)          // 静态缓存 + 默认参数
         *       │
         *       ├─► paramPanelController.render  // 生成滑块,并维护当前参数值
         *       │
         *       └─► _applyScene        // 用同一份 scene 更新绘图 / 分析 / 积分
         *
         * 之后拖动滑块只走 _refreshObjects -> compileScene(ast, currentValues),
         * 不会在 run() 里重复编译同一个 AST.
         */
        this.diagnosticsController.clear();
        const runId = ++this.runSequence;
        this._cancelPendingRefresh();

        try {
            const ast = await parseMiko(this.editor.value);
            if (this.disposed || runId !== this.runSequence) return;
            this.matrixOps = createWasmMatrixOps();
            this.animationPlayer.configure(this.matrixOps);
            this.animationStartTime = performance.now();
            this.currentAst = ast;
            if (this.lastRunSource !== this.editor.value) {
                this.hiddenEntityIds.clear();
                this.hiddenAnalysisNames.clear();
                this.hiddenIntegralNames.clear();
                this.lastRunSource = this.editor.value;
            }
            const scene = this._compileWithVisibility(ast, {});
            this.paramPanelController.render(scene.params);
            this._applyScene(scene);
        } catch (error) {
            this.diagnosticsController.add(
                'error',
                error instanceof Error ? error.message : String(error),
            );
        }
    }

    private _setupControls(): void {
        const renderer = this.sceneManager.getRenderer();
        const controls = new OrbitControls(this.cameraManager.getCamera(), renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.target.set(0, 0, 0);
        controls.update();
        this.cameraManager.setControls(controls);
        this.controls = controls;
    }

    private _wireViewControls(): void {
        this.cameraToggle = new CameraToggle(this.eventBus);
        this.viewCubeController = new ViewCubeController(this.eventBus);
        this.rotationLockController = new RotationLockController(this.eventBus);

        this.eventBus.on('camera:changed', ({ camMode }) => this.cameraManager.setCameraMode(camMode));
        this.eventBus.on('camera:view', ({ view }) => this.cameraManager.setView(view));
        this.eventBus.on('camera:rotationLock', ({ locked }) => this.cameraManager.setRotationLock(locked));
    }

    private _wireEditor(): void {
        this.runButton.addEventListener('click', () => this.run());
        this.editor.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                this.run();
            }
        });
    }

    private animate = (timestamp: number): void => {
        if (this.disposed) return;
        this.animationFrameId = requestAnimationFrame(this.animate);
        this.controls?.update();
        this._updateAnimations(timestamp);
        this.sceneManager.render(this.cameraManager.getCamera());
    };

    private _scheduleRefresh(name: string): void {
        if (this.disposed) return;
        this.pendingParamChanges.add(name);
        if (this.refreshFrame !== null) return;

        this.refreshFrame = requestAnimationFrame(() => {
            this.refreshFrame = null;
            const changedParams = new Set(this.pendingParamChanges);
            this.pendingParamChanges.clear();
            this._refreshObjects(changedParams);
        });
    }

    private _cancelPendingRefresh(): void {
        if (this.refreshFrame !== null) {
            cancelAnimationFrame(this.refreshFrame);
            this.refreshFrame = null;
        }
        this.pendingParamChanges.clear();
    }

    private _refreshObjects(
        changedParams?: ReadonlySet<string>,
    ): ReturnType<typeof compileScene> | null {
        if (!this.currentAst) return null;
        const scene = compileScene(
            this.currentAst,
            this.paramPanelController.getValues(),
            this.matrixOps,
            {
                hiddenAnalysisNames: this.hiddenAnalysisNames,
                hiddenIntegralNames: this.hiddenIntegralNames,
            },
        );
        this._applyScene(scene, changedParams);
        return scene;
    }

    private _applyScene(
        scene: SceneIR,
        changedParams?: ReadonlySet<string>,
    ): void {
        const nextIds = new Set(scene.objects.map((object) => object.id));

        for (const id of this.hiddenEntityIds) {
            if (!nextIds.has(id)) this.hiddenEntityIds.delete(id);
        }
        for (const object of scene.objects) {
            object.enabled = !this.hiddenEntityIds.has(object.id);
        }
        this.objectTransforms = scene.objectTransforms;
        this.animationPlayer.setScene(
            scene.objectTransforms,
            scene.animations,
            scene.objectAnimations,
        );

        for (const previous of this.compiledObjects) {
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
                // 引用仍需同步,否则后续其他参数变化时,renderer 手里还拿着旧数据.
                this.plotter.updateObject(object, false);
            }
        }

        this.compiledObjects = scene.objects;
        this._syncOverlays(scene, changedParams ? dirtyObjectIds : null);
    }

    private _updateAnimations(timestamp: number): void {
        if (this.animationStartTime === 0) return;
        const elapsedSeconds = (timestamp - this.animationStartTime) / 1000;
        for (const object of this.compiledObjects) {
            if (!object.enabled) continue;
            this._applyObjectTransform(object.id, elapsedSeconds);
        }
    }

    private _applyObjectTransform(id: number, elapsedSeconds?: number): void {
        const elapsed = elapsedSeconds ?? this._getAnimationElapsedSeconds();
        const matrix = this.animationPlayer.getObjectMatrix(id, elapsed);
        this.plotter.applyTransform(id, matrix);
    }

    private _getAnimationElapsedSeconds(): number {
        if (this.animationStartTime === 0) return 0;
        return (performance.now() - this.animationStartTime) / 1000;
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
            (name, value) => this.objectListController.setIntegralResult(name, value),
            (name, message) => this.objectListController.setIntegralError(name, message),
        );
    }

    /**
     * point/vector 的坐标表达式虽然暂时没有 coefficients 字段,
     * 但它们也可能引用 param,因此参数变化时保守地标记为 dirty.
     */
    private _objectDependsOnParams(
        object: SceneObject,
        changedParams: ReadonlySet<string>,
    ): boolean {
        if (object.kind === 'point' || object.kind === 'vector') {
            return true;
        }
        return object.coefficients.some((coefficient) => changedParams.has(coefficient.name));
    }

    private _toggleObject(id: number): void {
        const object = this.compiledObjects.find((candidate) => candidate.id === id);
        const nextVisible = !(object?.enabled ?? true);

        if (object) object.enabled = nextVisible;
        if (nextVisible) {
            this.hiddenEntityIds.delete(id);
        } else {
            this.hiddenEntityIds.add(id);
        }

        if (!object) {
            this.objectListController.setEntityVisible(id, nextVisible);
            return;
        }

        if (nextVisible) {
            this.plotter.updateObject(object, true);
            this._applyObjectTransform(object.id);
        } else {
            this.plotter.setVisible(id, false);
        }
        this.objectListController.setEntityVisible(id, nextVisible);
    }

    private _toggleAnalysis(name: string): void {
        if (this.hiddenAnalysisNames.has(name)) {
            this.hiddenAnalysisNames.delete(name);
        } else {
            this.hiddenAnalysisNames.add(name);
        }
        this._recompileForVisibilityChange();
    }

    private _toggleIntegral(name: string): void {
        if (this.hiddenIntegralNames.has(name)) {
            this.hiddenIntegralNames.delete(name);
        } else {
            this.hiddenIntegralNames.add(name);
        }
        this._recompileForVisibilityChange();
    }

    private _compileWithVisibility(
        ast: AstProgram,
        paramOverrides: Record<string, number>,
    ): SceneIR {
        return compileScene(ast, paramOverrides, this.matrixOps, {
            hiddenAnalysisNames: this.hiddenAnalysisNames,
            hiddenIntegralNames: this.hiddenIntegralNames,
        });
    }

    private _recompileForVisibilityChange(): void {
        if (!this.currentAst) return;

        const scene = this._compileWithVisibility(
            this.currentAst,
            this.paramPanelController.getValues(),
        );
        for (const object of scene.objects) {
            object.enabled = !this.hiddenEntityIds.has(object.id);
        }

        this.compiledObjects = scene.objects;
        this.objectTransforms = scene.objectTransforms;
        this.animationPlayer.setScene(
            scene.objectTransforms,
            scene.animations,
            scene.objectAnimations,
        );
        this._syncOverlays(scene, null);
    }
}
