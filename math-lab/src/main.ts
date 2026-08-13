import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================
// Service Layer
// ============================================================
import { EventBus } from './service/EventBus';
import type { MathLabEvents, MathObject } from './types';

// ============================================================
// Config
// ============================================================
import { APP_CONFIG } from './config/appConfig';

// ============================================================
// Core Layer
// ============================================================
import { SceneManager } from './core/SceneManager';
import { CameraManager } from './core/CameraManager';
import { Plotter } from './core/Plotter';
import { ColorManager, MathObjectManager } from './math_objects';

// ============================================================
// Integration / Vector-field
// ============================================================
import { IntegralVisualizer } from './visualization/IntegralVisualizer';
import { GradientVisualizer } from './visualization/GradientVisualizer';
import { SelectionManager } from './ui/SelectionManager';
import { DetailPanel } from './ui/DetailPanel';
// 曲面三角形剔除.运行在主线程的wasm
import { ensureReady } from './visualization/SurfaceMeshWasm';
// ============================================================
// UI Layer
// ============================================================
import { ModeController } from './ui/ModeController';
import { CameraToggle } from './ui/CameraToggle';
import { ExprInputController } from './ui/ExprInputController';
import { ExprListRenderer } from './ui/ExprListRenderer';

// ============================================================
// 0. 启动日志
// ============================================================
console.log('THREE version:', THREE.REVISION);

// ============================================================
// 1. 基础设施
// ============================================================
const eventBus = new EventBus<MathLabEvents>();
const container = document.getElementById('canvas-container')!;
const sceneManager = new SceneManager(container);
const colorManager = new ColorManager(APP_CONFIG.colorPalette);
const renderer = sceneManager.getRenderer();

// ============================================================
// 2. 核心逻辑
// ============================================================
const cameraManager = new CameraManager(sceneManager);
const objectManager = new MathObjectManager(colorManager);
const plotter = new Plotter(sceneManager.getScene());
const integralVisualizer = new IntegralVisualizer(sceneManager.getScene());
const gradientVisualizer = new GradientVisualizer(sceneManager.getScene());

// ============================================================
// 3. UI 组件(注入 eventBus,部分暂用 any 兼容尚未更新的组件)
// ============================================================
const selectionManager = new SelectionManager(eventBus);
const modeController = new ModeController(eventBus);
new CameraToggle(eventBus);
new ExprInputController(eventBus, objectManager, colorManager);
new ExprListRenderer(eventBus, objectManager, selectionManager);
new DetailPanel(
    eventBus,
    objectManager,
    selectionManager,
    integralVisualizer,
    gradientVisualizer,
);

// 脏标记:系数变化时先标记,下一帧统一绘制
const dirtyObjectIds = new Set<number>();

function processDirtyDraws(): void {
    if (dirtyObjectIds.size === 0) return;
    const mode = modeController.getMode();
    for (const id of dirtyObjectIds) {
        const obj = objectManager.getById(id);
        if (!obj) continue;
        if (obj.kind === 'point') {
            plotter.drawPoint(obj);
        } else if (obj.kind === 'vector') {
            plotter.drawVector(obj);
        } else {
            plotter.updateObject(obj, mode);
        }
    }
    dirtyObjectIds.clear();
}
// ============================================================
// 4. 事件订阅(新事件名 + discriminated union 分发)
// ============================================================

// 模式切换 -> 更新相机 + 更新可见性
eventBus.on('mode:changed', ({ mode }) => {
    cameraManager.setViewMode(mode);
    plotter.updateMode(mode);
});

// 新增数学对象 -> 绘制新加的那一个
eventBus.on('mathobj:added', ({ object }: { object: MathObject }) => {
    switch (object.kind) {
        case 'curve':
            plotter.drawCurve(object);
            break;
        case 'surface':
            plotter.drawSurface(object);
            break;
        case 'point':
            plotter.drawPoint(object);
            break;
        case 'vector':
            plotter.drawVector(object);
            break;
        case 'vector_field':
            plotter.drawVectorField(object);
            break;
    }
});

// 删除 -> 仅移除目标
eventBus.on('mathobj:removed', ({ id }) => {
    plotter.remove(id);
});

// 切换可见性 -> 仅设置 Group.visible
eventBus.on('mathobj:toggled', ({ id }) => {
    const obj = objectManager.getById(id);
    if (obj) {
        plotter.setVisible(id, obj.enabled);
    }
});

// 修改表达式 -> 重建目标
eventBus.on('mathobj:updated', ({ id }) => {
    const obj = objectManager.getById(id);
    if (obj) {
        plotter.updateObject(obj, modeController.getMode());
    }
});

// 系数滑块变化 -> 重绘目标
eventBus.on('coefficient:changed', ({ id }) => {
    dirtyObjectIds.add(id);
});

// 相机投影模式切换
eventBus.on('camera:changed', ({ camMode }) => {
    cameraManager.setCameraMode(camMode);
});

// ============================================================
// 4.5 初始绘制:等待 WASM 就绪后绘制所有预设对象
// ============================================================
const initialMode = modeController.getMode();
const initialObjects = objectManager.getAll();

function drawAll() {
    for (const obj of initialObjects) {
        if (!obj.enabled) continue;
        switch (obj.kind) {
            case 'curve': plotter.drawCurve(obj); break;
            case 'surface': plotter.drawSurface(obj); break;
            case 'point': plotter.drawPoint(obj); break;
            case 'vector': plotter.drawVector(obj); break;
            case 'vector_field': plotter.drawVectorField(obj); break;
        }
    }
    plotter.updateMode(initialMode);
}

// await wasm,就绪后再绘制 (setup 内的顶层代码用 .then)
ensureReady().then(drawAll);

// ============================================================
// 5. OrbitControls + 动画循环
// ============================================================
const controls = new OrbitControls(cameraManager.getCamera(), renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.update();
cameraManager.setControls(controls);

// 窗口自适应
window.addEventListener('resize', () => {
    const { width, height } = sceneManager.resize();
    cameraManager.updateAspect(width, height);
});

// 键盘事件
document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Home') {
        controls.target.set(0, 0, 0);
    }
});

// 动画循环
function animate(): void {
    requestAnimationFrame(animate);
    // performance.mark('frame-start');
    controls.update();
    // performance.mark('controls-updated');
    processDirtyDraws();
    // performance.mark('dirty-draws');
    sceneManager.render(cameraManager.getCamera());
    // performance.mark('render-done');
    // performance.measure('frame', 'frame-start', 'render-done');
    // performance.measure('-controls.update', 'frame-start', 'controls-updated');
    // performance.measure('-processDirtyDraws', 'controls-updated', 'dirty-draws');
    // performance.measure('-renderer.render', 'dirty-draws', 'render-done');
}
animate();

// ============================================================
// 6. 左侧抽屉:滑入/滑出 + 宽度拖拽
// ============================================================
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn') as HTMLButtonElement;
const panel = document.getElementById('panel') as HTMLElement;
const resizeHandle = document.getElementById('resizeHandle') as HTMLElement;

let panelWidth = 600;
const MIN_WIDTH = 280;
const MAX_WIDTH = 900;

function applyPanelWidth(w: number): void {
    panel.style.width = w + 'px';
    document.documentElement.style.setProperty('--panel-width', w + 'px');
}

// 抽屉切换
sidebarToggleBtn.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('open');
    sidebarToggleBtn.textContent = isOpen ? '◀' : '▶';
});

// 宽度拖拽
let isDragging = false;
let startX = 0;
let startWidth = 0;

resizeHandle.addEventListener('mousedown', (e: Event) => {
    isDragging = true;
    startX = (e as MouseEvent).clientX;
    startWidth = panel.offsetWidth;
    resizeHandle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
});

document.addEventListener('mousemove', (e: Event) => {
    if (!isDragging) return;
    const delta = (e as MouseEvent).clientX - startX;
    let newWidth = startWidth + delta;
    newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
    applyPanelWidth(newWidth);
    panelWidth = newWidth;
});

document.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.userSelect = '';
    }
});

// 初始面板宽度
applyPanelWidth(panelWidth);

console.log('[MathPlot] 初始化完成！使用 2D/3D 模式绘制数学表达式');