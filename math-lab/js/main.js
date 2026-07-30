import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
console.log("THREE version:", THREE.REVISION);
//import { WebGPURenderer } from 'three/webgpu';
//console.log('WebGPURenderer:', WebGPURenderer);  // 应该输出类构造函数

// Service Layer
import { EventBus } from './service/EventBus.js';

// Config
import { APP_CONFIG, ColorManager } from './config/appConfig.js';

// Core Layer
import { SceneManager } from './core/SceneManager.js';
import { CameraManager } from './core/CameraManager.js';
import { ExpressionManager } from './core/ExpressionManager.js';
import { Plotter } from './core/Plotter.js';
import { IntegralVisualizer } from './integration/IntegralVisualizer.js';

// UI Layer
import { ModeController } from './ui/ModeController.js';
import { CameraToggle } from './ui/CameraToggle.js';
import { ExprInputController } from './ui/ExprInputController.js';
import { ExprListRenderer } from './ui/ExprListRenderer.js';
import { IntegralPanel } from './ui/IntegralPanel.js';

// =====================================================
// 1. 基础设施
// =====================================================
const eventBus = new EventBus();
const sceneManager = new SceneManager(document.getElementById('canvas-container'));
const colorManager = new ColorManager(APP_CONFIG.colorPalette);
const renderer = sceneManager.getRenderer();

// =====================================================
// 2. 核心逻辑
// =====================================================
const cameraManager = new CameraManager(sceneManager, APP_CONFIG.camera);
const exprManager = new ExpressionManager(colorManager);
const plotter = new Plotter(sceneManager.getScene());
const integralVisualizer = new IntegralVisualizer(sceneManager.getScene());

// =====================================================
// 3. UI 组件(注入 eventBus,不持有 core 引用)
// =====================================================
const modeController = new ModeController(eventBus);
new CameraToggle(eventBus);
new ExprInputController(eventBus, exprManager, colorManager);
new ExprListRenderer(eventBus, exprManager);
new IntegralPanel(eventBus, exprManager, integralVisualizer);

// =====================================================
// 4. 事件订阅(通过 eventBus 解耦的联动逻辑)
// =====================================================

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

// 4.5 初始绘制: 绘制所有预设表达式
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
// 根据当前模式设置可见性,2D模式隐藏,3D反之亦然
plotter.updateMode(initialMode);

// 相机模式切换
eventBus.on('camera:changed', ({ camMode }) => {
    cameraManager.setCameraMode(camMode);
});

// =====================================================
// 5. OrbitControls + 动画循环
// =====================================================
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
document.addEventListener('keydown', (e) => {
    if (e.key === 'Home') {
        controls.target.set(0, 0, 0);
    }
});

// 动画循环
function animate() {
    requestAnimationFrame(animate); // 浏览器每帧调用一次
    controls.object = cameraManager.getCamera();
    controls.update();
    sceneManager.render(cameraManager.getCamera());
}
animate();

// 面板折叠/展开
const panelToggleBtn = document.getElementById('panelToggleBtn');
const panel = document.getElementById('panel');
if (panelToggleBtn && panel) {
    panelToggleBtn.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
    });
}

console.log('[MathPlot] 初始化完成! 使用 2D/3D 模式绘制数学表达式');