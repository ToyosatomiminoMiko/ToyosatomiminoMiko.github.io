import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SceneManager } from '../render/core/SceneManager';
import { CameraManager } from '../render/core/CameraManager';
import { Plotter } from '../render/core/Plotter';
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
 * 编辑 -> parseMiko -> compileScene -> 3D 视口 + param 面板 + 诊断输出.
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
    private readonly analysisRenderer: AnalysisRenderer;
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
    private currentAst: AstProgram | null = null;
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

        this.sceneManager = new SceneManager(this.viewport);
        this.cameraManager = new CameraManager(this.viewport);
        this.plotter = new Plotter(this.sceneManager.getScene());
        this.integralRenderer = new DslIntegralRenderer(
            this.sceneManager.getScene(),
            this.computeEngine,
        );
        this.paramPanelController = new ParamPanelController(paramsPanel, (name) => this._scheduleRefresh(name));
        this.diagnosticsController = new DiagnosticsController(diagnostics);
        this.analysisRenderer = new AnalysisRenderer();
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
        this.animate();
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
            this.currentAst = ast;
            const scene = compileScene(ast, {}, this.matrixOps);
            this.paramPanelController.render(scene.params);
            this._applyScene(scene);
            this.diagnosticsController.add(
                'info',
                `解析成功:${ast.statements.length} 条语句,${this.compiledObjects.length} 个对象`,
            );

            for (const analysis of scene.analyses) {
                if (analysis.op === 'divergence') {
                    this.diagnosticsController.add('info', `${analysis.name}: divergence = ${analysis.scalar}`);
                } else if (analysis.op === 'curl') {
                    this.diagnosticsController.add('info', `${analysis.name}: curl = [${analysis.vector.join(', ')}]`);
                } else {
                    this.diagnosticsController.add('info', `${analysis.name}: normal = [${analysis.vector.join(', ')}]`);
                }
            }
        } catch (error) {
            this.diagnosticsController.add('error', error instanceof Error ? error.message : String(error));
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

    private animate = (): void => {
        if (this.disposed) return;
        this.animationFrameId = requestAnimationFrame(this.animate);
        this.controls?.update();
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
        );
        this._applyScene(scene, changedParams);
        return scene;
    }

    private _applyScene(
        scene: SceneIR,
        changedParams?: ReadonlySet<string>,
    ): void {
        const nextIds = new Set(scene.objects.map((object) => object.id));

        for (const previous of this.compiledObjects) {
            if (!nextIds.has(previous.id)) {
                this.plotter.remove(previous.id);
            }
        }

        const dirtyObjectIds = new Set<number>();
        for (const object of scene.objects) {
            const shouldRedraw = !changedParams
                || changedParams.size === 0
                || this._objectDependsOnParams(object, changedParams);
            if (shouldRedraw) {
                dirtyObjectIds.add(object.id);
                this.plotter.updateObject(object, true);
                this.plotter.applyTransform(object.id, scene.objectTransforms[object.id] ?? null);
            } else {
                // 引用仍需同步,否则后续其他参数变化时,renderer 手里还拿着旧数据.
                this.plotter.updateObject(object, false);
            }
        }

        this.compiledObjects = scene.objects;
        this.analysisRenderer.render(scene.analyses);
        this.integralRenderer.sync(
            scene.integrals,
            scene.objects,
            (level, message) => {
                this.diagnosticsController.add(level, message);
            },
            changedParams ? dirtyObjectIds : null,
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
}
