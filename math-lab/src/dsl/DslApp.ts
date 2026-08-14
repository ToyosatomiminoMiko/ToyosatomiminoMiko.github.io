import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SceneManager } from '../core/SceneManager';
import { CameraManager } from '../core/CameraManager';
import { Plotter } from '../core/Plotter';
import { parseMiko } from '../parser';
import { compileScene, type AnalysisResult, type ParamDeclaration } from './DslCompiler';
import { EventBus } from '../service/EventBus';
import type { MathLabEvents, MathObject } from '../types';
import type { AstProgram } from '../ast/types';
import { CameraToggle } from '../ui/CameraToggle';
import { ViewCubeController } from '../ui/ViewCubeController';
import { RotationLockController } from '../ui/RotationLockController';
import { PanelController } from '../ui/PanelController';
import { DslIntegralRenderer } from '../visualization/DslIntegralRenderer';

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
    private readonly editor: HTMLTextAreaElement;
    private readonly runButton: HTMLButtonElement;
    private readonly paramsPanel: HTMLElement;
    private readonly diagnostics: HTMLElement;

    private controls: OrbitControls | null = null;
    private animationFrameId: number | null = null;
    private paramValues = new Map<string, number>();
    private compiledObjects: MathObject[] = [];
    private currentAst: AstProgram | null = null;
    private readonly analysisGroup = new THREE.Group();
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
        this.paramsPanel = document.getElementById('params-panel')!;
        this.diagnostics = document.getElementById('diagnostics')!;

        this.sceneManager = new SceneManager(this.viewport);
        this.cameraManager = new CameraManager(this.viewport);
        this.plotter = new Plotter(this.sceneManager.getScene());
        this.integralRenderer = new DslIntegralRenderer(this.sceneManager.getScene());
        this.sceneManager.getScene().add(this.analysisGroup);
    }

    start(): void {
        this._setupControls();
        this._wireViewControls();
        this._wireEditor();
        new PanelController().bind(document.getElementById('app')!);
        window.addEventListener('resize', this.onResize);
        document.addEventListener('keydown', this.onKeyDown);
        this.animate();
        this.run();
    }

    dispose(): void {
        this.disposed = true;
        if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
        window.removeEventListener('resize', this.onResize);
        document.removeEventListener('keydown', this.onKeyDown);
        this.controls?.dispose();
        this.cameraManager.dispose();
        this.integralRenderer.dispose();
        this.plotter.dispose();
        this.sceneManager.dispose();
    }

    async run(): Promise<void> {
        this._clearDiagnostics();

        try {
            const ast = await parseMiko(this.editor.value);
            this.currentAst = ast;
            this._renderParams(compileScene(ast).params);
            const scene = this._refreshObjects();
            this._addDiagnostic(
                'info',
                `解析成功:${ast.statements.length} 条语句，${this.compiledObjects.length} 个对象`,
            );

            if (scene) {
                for (const analysis of scene.analyses) {
                    if (analysis.op === 'divergence') {
                        this._addDiagnostic('info', `${analysis.name}: divergence = ${analysis.scalar}`);
                    } else if (analysis.op === 'curl') {
                        this._addDiagnostic('info', `${analysis.name}: curl = [${analysis.vector.join(', ')}]`);
                    } else {
                        this._addDiagnostic('info', `${analysis.name}: normal = [${analysis.vector.join(', ')}]`);
                    }
                }
            }
        } catch (error) {
            this._addDiagnostic('error', error instanceof Error ? error.message : String(error));
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
        new CameraToggle(this.eventBus);
        new ViewCubeController(this.eventBus);
        new RotationLockController(this.eventBus);

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

    private _refreshObjects(): ReturnType<typeof compileScene> | null {
        if (!this.currentAst) return null;
        const scene = compileScene(this.currentAst, Object.fromEntries(this.paramValues));
        const nextIds = new Set(scene.objects.map((object) => object.id));

        for (const previous of this.compiledObjects) {
            if (!nextIds.has(previous.id)) {
                this.plotter.remove(previous.id);
            }
        }

        for (const object of scene.objects) {
            this.plotter.updateObject(object);
            this.plotter.applyTransform(object.id, scene.objectTransforms.get(object.id) ?? null);
        }

        this.compiledObjects = scene.objects;
        this._renderAnalyses(scene.analyses);
        this.integralRenderer.sync(scene.integrals, scene.objects, (level, message) => {
            this._addDiagnostic(level, message);
        });
        return scene;
    }

    private _renderAnalyses(analyses: AnalysisResult[]): void {
        this._clearAnalysisGroup();

        for (const analysis of analyses) {
            const point = new THREE.Vector3(...analysis.point);
            const vector = new THREE.Vector3(...analysis.vector);

            if (analysis.show.includes('point')) {
                const dot = new THREE.Mesh(
                    new THREE.SphereGeometry(0.08, 16, 16),
                    new THREE.MeshPhongMaterial({ color: 0xffdd44 }),
                );
                dot.position.copy(point);
                this.analysisGroup.add(dot);
            }

            if (analysis.show.includes('normal') && vector.lengthSq() > 1e-12) {
                const direction = vector.clone().normalize();
                const arrow = new THREE.ArrowHelper(direction, point, 1.5, 0xff6b8a, 0.2, 0.1);
                this.analysisGroup.add(arrow);
            }

            if (analysis.show.includes('tangent_plane') && analysis.op === 'gradient') {
                const normal = vector.lengthSq() > 1e-12
                    ? vector.clone().normalize()
                    : new THREE.Vector3(0, 0, 1);
                const plane = new THREE.Mesh(
                    new THREE.PlaneGeometry(1.6, 1.6),
                    new THREE.MeshPhongMaterial({
                        color: 0x44aaff,
                        side: THREE.DoubleSide,
                        transparent: true,
                        opacity: 0.55,
                        depthWrite: false,
                    }),
                );
                plane.position.copy(point);
                plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
                this.analysisGroup.add(plane);
            }
        }
    }

    private _clearAnalysisGroup(): void {
        for (const child of [...this.analysisGroup.children]) {
            this.analysisGroup.remove(child);
            child.traverse((node) => {
                if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
                    node.geometry?.dispose();
                    if (Array.isArray(node.material)) {
                        node.material.forEach((material) => material.dispose());
                    } else {
                        node.material?.dispose();
                    }
                }
            });
        }
    }

    private _renderParams(params: ParamDeclaration[]): void {
        this.paramsPanel.replaceChildren();
        this.paramValues.clear();

        for (const param of params) {
            this.paramValues.set(param.name, param.value);
            this.paramsPanel.appendChild(this._createParamRow(param));
        }
    }

    private _createParamRow(param: ParamDeclaration): HTMLElement {
        const row = document.createElement('div');
        row.className = 'param-row';

        const label = document.createElement('label');
        label.textContent = param.name;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(param.min);
        slider.max = String(param.max);
        slider.step = String(param.step);
        slider.value = String(param.value);

        const numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.min = String(param.min);
        numberInput.max = String(param.max);
        numberInput.step = String(param.step);
        numberInput.value = String(param.value);

        const syncFromSlider = (): void => {
            const next = Number(slider.value);
            numberInput.value = String(next);
            this.paramValues.set(param.name, next);
            this._refreshObjects();
        };

        const syncFromNumber = (): void => {
            const raw = Number(numberInput.value);
            if (!Number.isFinite(raw)) return;
            const clamped = Math.min(param.max, Math.max(param.min, raw));
            slider.value = String(clamped);
            numberInput.value = String(clamped);
            this.paramValues.set(param.name, clamped);
            this._refreshObjects();
        };

        slider.addEventListener('input', syncFromSlider);
        numberInput.addEventListener('input', syncFromNumber);
        numberInput.addEventListener('change', syncFromNumber);

        row.append(label, slider, numberInput);
        return row;
    }

    private _clearDiagnostics(): void {
        this.diagnostics.replaceChildren();
    }

    private _addDiagnostic(level: 'info' | 'warning' | 'error' | 'log', message: string): void {
        const entry = document.createElement('div');
        entry.className = `diagnostic diagnostic-${level}`;
        entry.textContent = `[${level}] ${message}`;
        this.diagnostics.appendChild(entry);
    }
}
