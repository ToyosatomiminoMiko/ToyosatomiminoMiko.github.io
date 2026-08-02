import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================
// Service Layer
// ============================================================
import { EventBus } from './service/EventBus';
import type { MathLabEvents } from './types';

// ============================================================
// Config
// ============================================================
import { APP_CONFIG, ColorManager } from './config/appConfig';

// ============================================================
// Core Layer
// ============================================================
import { SceneManager } from './core/SceneManager';
import { CameraManager } from './core/CameraManager';
import { ExpressionManager } from './core/ExpressionManager';
import { Plotter } from './core/Plotter';

// ============================================================
// Integration / Derivative
// ============================================================
import { IntegralVisualizer } from './integration/IntegralVisualizer';
import { DerivativePanel } from './derivative/DerivativePanel';

// ============================================================
// UI Layer
// ============================================================
import { ModeController } from './ui/ModeController';
import { CameraToggle } from './ui/CameraToggle';
import { ExprInputController } from './ui/ExprInputController';
import { ExprListRenderer } from './ui/ExprListRenderer';
import { IntegralPanel } from './ui/IntegralPanel';

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
const exprManager = new ExpressionManager(colorManager);
const plotter = new Plotter(sceneManager.getScene());
const integralVisualizer = new IntegralVisualizer(sceneManager.getScene());

// ============================================================
// 3. UI 组件（注入 eventBus,不持有 core 引用）
// ============================================================
const modeController = new ModeController(eventBus);
new CameraToggle(eventBus);
new ExprInputController(eventBus, exprManager, colorManager);
new ExprListRenderer(eventBus, exprManager);
new IntegralPanel(eventBus, exprManager, integralVisualizer);
new DerivativePanel(eventBus, exprManager);

// ============================================================
// 4. 事件订阅（通过 eventBus 解耦的联动逻辑）
// ============================================================

// 模式切换 -> 更新相机 + 更新可见性,不重建几何体
eventBus.on('mode:changed', ({ mode }) => {
    cameraManager.setViewMode(mode);
    plotter.updateMode(mode);
});

// 新增表达式 -> 仅绘制新加的那一条
eventBus.on('expr:added', ({ expr }) => {
    const mode = modeController.getMode();
    if (mode === '2d' && expr.type === '2d') {
        plotter.draw2D(expr);
    } else if (mode === '3d' && expr.type === '3d') {
        plotter.draw3D(expr);
    }
});

// 删除表达式 -> 仅移除目标
eventBus.on('expr:removed', ({ id }) => {
    plotter.remove(id);
});

// 切换可见性 -> 仅设置 Group.visible
eventBus.on('expr:toggled', ({ id }) => {
    const expr = exprManager.getAll().find(e => e.id === id);
    if (expr) {
        plotter.setVisible(id, expr.enabled);
    }
});

// 修改表达式 -> 仅重建目标
eventBus.on('expr:updated', ({ id }) => {
    const expr = exprManager.getAll().find(e => e.id === id);
    if (expr) {
        plotter.updateExpr(expr, modeController.getMode());
    }
});

// 系数滑块变化 -> 重绘目标表达式
eventBus.on('coefficient:changed', ({ id }) => {
    const expr = exprManager.getAll().find(e => e.id === id);
    if (expr) {
        plotter.updateExpr(expr, modeController.getMode());
    }
});

// 相机模式切换
eventBus.on('camera:changed', ({ camMode }) => {
    cameraManager.setCameraMode(camMode);
});

// ============================================================
// 4.5 初始绘制：绘制所有预设表达式
// ============================================================
const initialMode = modeController.getMode();
const initialExprs = exprManager.getAll();
for (const expr of initialExprs) {
    if (!expr.enabled) continue;
    if (expr.type === '2d') {
        plotter.draw2D(expr);
    } else if (expr.type === '3d') {
        plotter.draw3D(expr);
    }
}
// 根据当前模式设置可见性,2D 模式隐藏 3D,反之亦然
plotter.updateMode(initialMode);

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
    controls.object = cameraManager.getCamera();
    controls.update();
    sceneManager.render(cameraManager.getCamera());
}
animate();

// ============================================================
// 6. 左侧抽屉：滑入/滑出 + 宽度拖拽
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

// 初始面板
applyPanelWidth(panelWidth);

console.log('[MathPlot] 初始化完成!使用 2D/3D 模式绘制数学表达式');