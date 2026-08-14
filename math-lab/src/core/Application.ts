import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { APP_CONFIG } from '../config/appConfig';
import type { MathLabEvents, MathObject } from '../types';
import { EventBus } from '../service/EventBus';
import { logDebug } from '../service/logger';
import { SceneManager } from './SceneManager';
import { CameraManager } from './CameraManager';
import { Plotter } from './Plotter';
import { ColorManager, MathObjectManager } from '../math_objects';
import { IntegralVisualizer } from '../visualization/IntegralVisualizer';
import { GradientVisualizer } from '../visualization/GradientVisualizer';
import { SelectionManager } from '../ui/SelectionManager';
import { DetailPanel } from '../ui/DetailPanel';
import { ModeController } from '../ui/ModeController';
import { CameraToggle } from '../ui/CameraToggle';
import { ExprInputController } from '../ui/ExprInputController';
import { ExprListRenderer } from '../ui/ExprListRenderer';
import { ensureReady } from '../visualization/SurfaceMeshWasm';

/**
 * Application — math-lab 的启动编排器。
 * 将原先平铺在 main.ts 中的初始化、事件绑定、渲染循环集中到生命周期中。
 */
export class Application {
    private readonly eventBus: EventBus<MathLabEvents>;
    private readonly container: HTMLElement;
    private readonly sceneManager: SceneManager;
    private readonly colorManager: ColorManager;
    private readonly cameraManager: CameraManager;
    private readonly objectManager: MathObjectManager;
    private readonly plotter: Plotter;
    private readonly integralVisualizer: IntegralVisualizer;
    private readonly gradientVisualizer: GradientVisualizer;
    private readonly modeController: ModeController;
    private readonly dirtyObjectIds = new Set<number>();

    private controls: OrbitControls | null = null;
    private animationFrameId: number | null = null;
    private disposed = false;

    private readonly onPointerDown = (event: PointerEvent): void => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.coeff-row')) {
            if (this.controls) this.controls.enabled = false;
        }
    };

    private readonly onPointerUp = (): void => {
        if (this.controls) this.controls.enabled = true;
    };

    private readonly onResize = (): void => {
        const { width, height } = this.sceneManager.resize();
        this.cameraManager.updateAspect(width, height);
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Home' && this.controls) {
            this.controls.target.set(0, 0, 0);
        }
    };

    constructor() {
        this.eventBus = new EventBus<MathLabEvents>();
        this.container = document.getElementById('canvas-container')!;
        this.sceneManager = new SceneManager(this.container);
        this.colorManager = new ColorManager(APP_CONFIG.colorPalette);
        this.cameraManager = new CameraManager(this.container);
        this.objectManager = new MathObjectManager(this.colorManager);
        this.plotter = new Plotter(this.sceneManager.getScene());
        this.integralVisualizer = new IntegralVisualizer(this.sceneManager.getScene());
        this.gradientVisualizer = new GradientVisualizer(this.sceneManager.getScene());
        this.modeController = new ModeController(this.eventBus);

        this._wireUi();
        this._wireEvents();
    }

    start(): void {
        if (this.disposed) return;

        logDebug('THREE version:', THREE.REVISION);
        this._setupControls();
        this._bindWindowEvents();
        this.animate();

        ensureReady().then(() => this._drawAll());
        logDebug('[MathPlot] 初始化完成！使用 2D/3D 模式绘制数学表达式');
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        document.removeEventListener('pointerdown', this.onPointerDown);
        document.removeEventListener('pointerup', this.onPointerUp);
        document.removeEventListener('pointercancel', this.onPointerUp);
        window.removeEventListener('resize', this.onResize);
        document.removeEventListener('keydown', this.onKeyDown);

        this.cameraManager.dispose();
        this.controls = null;
        this.plotter.dispose();
        this.sceneManager.getRenderer().dispose();
    }

    private _wireUi(): void {
        const selectionManager = new SelectionManager(this.eventBus);
        new CameraToggle(this.eventBus);
        new ExprInputController(this.eventBus, this.objectManager, this.colorManager);
        new ExprListRenderer(this.eventBus, this.objectManager, selectionManager);
        new DetailPanel(
            this.eventBus,
            this.objectManager,
            selectionManager,
            this.integralVisualizer,
            this.gradientVisualizer,
        );
    }

    private _wireEvents(): void {
        this.eventBus.on('mode:changed', ({ mode }) => {
            this.cameraManager.setViewMode(mode);
            this.plotter.updateMode(mode);
        });

        this.eventBus.on('mathobj:added', ({ object }: { object: MathObject }) => {
            this._drawObjectImmediately(object);
        });

        this.eventBus.on('mathobj:removed', ({ id }) => {
            this.plotter.remove(id);
        });

        this.eventBus.on('mathobj:toggled', ({ id }) => {
            const obj = this.objectManager.getById(id);
            if (obj) this.plotter.setVisible(id, obj.enabled);
        });

        this.eventBus.on('mathobj:updated', ({ id }) => {
            const obj = this.objectManager.getById(id);
            if (obj) this.plotter.updateObject(obj, this.modeController.getMode());
        });

        this.eventBus.on('coefficient:changed', ({ id }) => {
            this.dirtyObjectIds.add(id);
        });

        this.eventBus.on('camera:changed', ({ camMode }) => {
            this.cameraManager.setCameraMode(camMode);
        });
    }

    private _setupControls(): void {
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

    private _bindWindowEvents(): void {
        document.addEventListener('pointerdown', this.onPointerDown);
        document.addEventListener('pointerup', this.onPointerUp);
        document.addEventListener('pointercancel', this.onPointerUp);
        window.addEventListener('resize', this.onResize);
        document.addEventListener('keydown', this.onKeyDown);
    }

    private animate = (): void => {
        if (this.disposed) return;
        this.animationFrameId = requestAnimationFrame(this.animate);
        this.controls?.update();
        this._processDirtyDraws();
        this.sceneManager.render(this.cameraManager.getCamera());
    };

    private _processDirtyDraws(): void {
        if (this.dirtyObjectIds.size === 0) return;
        const mode = this.modeController.getMode();
        for (const id of this.dirtyObjectIds) {
            const obj = this.objectManager.getById(id);
            if (obj) this.plotter.updateObject(obj, mode);
        }
        this.dirtyObjectIds.clear();
    }

    private _drawAll(): void {
        const mode = this.modeController.getMode();
        for (const obj of this.objectManager.getAll()) {
            if (obj.enabled) this._drawObjectImmediately(obj);
        }
        this.plotter.updateMode(mode);
    }

    private _drawObjectImmediately(obj: MathObject): void {
        switch (obj.kind) {
            case 'curve':
                this.plotter.drawCurve(obj);
                break;
            case 'surface':
                this.plotter.drawSurface(obj);
                break;
            case 'point':
                this.plotter.drawPoint(obj);
                break;
            case 'vector':
                this.plotter.drawVector(obj);
                break;
            case 'vector_field':
                this.plotter.drawVectorField(obj);
                break;
        }
    }

}
