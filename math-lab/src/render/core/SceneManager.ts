import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { RENDER_CONFIG } from '../../config/renderConfig';

type AxisName = 'x' | 'y' | 'z';
type GridPlane = 'xz' | 'xy' | 'yz';

/**
 * 场景管理器 — 负责创建场景,渲染器,灯光,坐标轴等基础元素
 * CameraManager 通过注入 SceneManager 获取 renderer 引用
 */
export class SceneManager {
    container: HTMLElement;
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    /** 三个坐标平面网格,各自独立显隐 */
    private readonly planeGroups: Record<GridPlane, THREE.Group> = {
        xz: new THREE.Group(),
        xy: new THREE.Group(),
        yz: new THREE.Group(),
    };
    private readonly tickGroup = new THREE.Group();
    /** Line2 坐标轴材质,resize 时同步分辨率,线宽变化时统一更新 */
    private readonly axisLineMaterials: LineMaterial[] = [];
    /** 所有 Line2/LineSegments2 材质,resize 时统一同步分辨率 */
    private readonly resolutionMaterials: LineMaterial[] = [];
    private gridMajorMaterial: LineMaterial | null = null;
    private gridMinorMaterial: LineMaterial | null = null;
    private tickMajorMaterial: LineMaterial | null = null;
    private tickMinorMaterial: LineMaterial | null = null;
    /** 各轴标签 Sprite */
    private readonly axisLabels: Partial<Record<AxisName, THREE.Sprite>> = {};
    /** 各轴刻度数字 Sprite,随对应轴标签一起显隐 */
    private readonly axisTickNumbers: Record<AxisName, THREE.Sprite[]> = {
        x: [],
        y: [],
        z: [],
    };

    constructor(container: HTMLElement) {
        this.container = container;

        // --- 场景 ---
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(RENDER_CONFIG.scene.background);

        // --- 光源 ---
        const ambientLight = new THREE.AmbientLight(0x404060);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(5, 10, 7);
        this.scene.add(dirLight);

        // --- 渲染器 ---
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        // --- 辅助元素 ---
        // XYZ 坐标轴改用 Line2 绘制,支持像素线宽
        this.createAxisLine(
            [0, 0, 0],
            [RENDER_CONFIG.scene.axesLength, 0, 0],
            RENDER_CONFIG.scene.axisColors.x,
        );
        this.createAxisLine(
            [0, 0, 0],
            [0, RENDER_CONFIG.scene.axesLength, 0],
            RENDER_CONFIG.scene.axisColors.y,
        );
        this.createAxisLine(
            [0, 0, 0],
            [0, 0, RENDER_CONFIG.scene.axesLength],
            RENDER_CONFIG.scene.axisColors.z,
        );

        // 大/小刻度网格 + 坐标轴刻度
        this.buildGridAndTicks();
        this.scene.add(
            this.planeGroups.xz,
            this.planeGroups.xy,
            this.planeGroups.yz,
        );
        this.scene.add(this.tickGroup);

        // XYZ 轴标签(使用 Sprite)
        const axisLen = RENDER_CONFIG.scene.axisLabelLength;
        const axisLabel = (
            axis: AxisName,
            text: string,
            position: THREE.Vector3,
            color: string,
        ): void => {
            const sprite = this.createTextSprite(text, color);
            sprite.position.copy(position);
            sprite.visible = RENDER_CONFIG.scene.axisLabels[axis];
            this.axisLabels[axis] = sprite;
            this.scene.add(sprite);
        };
        // X 红色 | Y 绿色 | Z 蓝色 与 AxesHelper 配色一致
        axisLabel('x', 'X', new THREE.Vector3(axisLen, 0, 0), RENDER_CONFIG.scene.axisColors.x);
        axisLabel('y', 'Y', new THREE.Vector3(0, axisLen, 0), RENDER_CONFIG.scene.axisColors.y);
        axisLabel('z', 'Z', new THREE.Vector3(0, 0, axisLen), RENDER_CONFIG.scene.axisColors.z);
    }

    getScene(): THREE.Scene {
        return this.scene;
    }

    getRenderer(): THREE.WebGLRenderer {
        return this.renderer;
    }

    addToScene(object: THREE.Object3D): void {
        this.scene.add(object);
    }

    removeFromScene(object: THREE.Object3D): void {
        this.scene.remove(object);
    }

    /** 设置坐标轴线宽(像素) */
    setAxisLineWidth(width: number): void {
        const clamped = Math.max(1, width);
        for (const material of this.axisLineMaterials) {
            material.linewidth = clamped;
        }
    }

    /** 设置某个坐标平面网格的可见性 */
    setPlaneVisible(plane: GridPlane, visible: boolean): void {
        this.planeGroups[plane].visible = visible;
    }

    /** 设置坐标轴刻度可见性 */
    setTicksVisible(visible: boolean): void {
        this.tickGroup.visible = visible;
    }

    /** 设置大/小刻度线宽(像素),同时作用于网格线和坐标轴刻度 */
    setGridLineWidths(majorWidth: number, minorWidth: number): void {
        const major = Math.max(1, majorWidth);
        const minor = Math.max(0.5, minorWidth);
        if (this.gridMajorMaterial) this.gridMajorMaterial.linewidth = major;
        if (this.gridMinorMaterial) this.gridMinorMaterial.linewidth = minor;
        if (this.tickMajorMaterial) this.tickMajorMaterial.linewidth = major;
        if (this.tickMinorMaterial) this.tickMinorMaterial.linewidth = minor;
    }

    /** 设置某条轴的标签可见性,同时隐藏/显示该轴的刻度数字 */
    setAxisLabelVisible(axis: AxisName, visible: boolean): void {
        const label = this.axisLabels[axis];
        if (label) label.visible = visible;
        for (const sprite of this.axisTickNumbers[axis]) {
            sprite.visible = visible;
        }
    }

    render(camera: THREE.Camera): void {
        this.renderer.render(this.scene, camera);
    }

    resize(): { width: number; height: number } {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.renderer.setSize(width, height);
        for (const material of this.resolutionMaterials) {
            material.resolution.set(width, height);
        }
        return { width, height };
    }

    /**
     * 构建大/小刻度网格(XZ 平面)和 XYZ 轴刻度线.
     * - 大刻度线:较粗、较亮,按 majorStep 间隔;
     * - 小刻度线:较细、较暗,按 minorStep 间隔;
     * - 中心线(经过原点)由坐标轴承担,网格不再重复绘制.
     */
    private buildGridAndTicks(): void {
        const { grid, axisTicks } = RENDER_CONFIG.scene;
        const { size, majorStep, minorStep } = grid;
        const half = size / 2;
        const eps = minorStep * 1e-6;

        const makeMaterial = (
            color: number,
            linewidth: number,
        ): LineMaterial => {
            const material = new LineMaterial({
                color,
                linewidth,
                resolution: new THREE.Vector2(
                    this.container.clientWidth,
                    this.container.clientHeight,
                ),
            });
            this.resolutionMaterials.push(material);
            return material;
        };

        this.gridMajorMaterial = makeMaterial(grid.majorColor, grid.majorLineWidth);
        this.gridMinorMaterial = makeMaterial(grid.minorColor, grid.minorLineWidth);
        this.tickMajorMaterial = makeMaterial(axisTicks.color, grid.majorLineWidth);
        this.tickMinorMaterial = makeMaterial(axisTicks.color, grid.minorLineWidth);

        // --- 三个坐标平面的网格线(XZ/XY/YZ,大/小刻度同风格)---
        for (const plane of ['xz', 'xy', 'yz'] as const) {
            const majorSegments: number[] = [];
            const minorSegments: number[] = [];
            for (let v = -half; v <= half + eps; v += minorStep) {
                const isMajor = Math.abs(v % majorStep) < eps;
                const target = isMajor ? majorSegments : minorSegments;
                if (plane === 'xz') {
                    // y=0:沿 Z 方向与沿 X 方向各一条
                    target.push(v, 0, -half, v, 0, half);
                    target.push(-half, 0, v, half, 0, v);
                } else if (plane === 'xy') {
                    // z=0:沿 Y 方向与沿 X 方向各一条
                    target.push(v, -half, 0, v, half, 0);
                    target.push(-half, v, 0, half, v, 0);
                } else {
                    // x=0:沿 Z 方向与沿 Y 方向各一条
                    target.push(0, v, -half, 0, v, half);
                    target.push(0, -half, v, 0, half, v);
                }
            }
            if (majorSegments.length) {
                const geometry = new LineSegmentsGeometry();
                geometry.setPositions(majorSegments);
                this.planeGroups[plane].add(
                    new LineSegments2(geometry, this.gridMajorMaterial),
                );
            }
            if (minorSegments.length) {
                const geometry = new LineSegmentsGeometry();
                geometry.setPositions(minorSegments);
                this.planeGroups[plane].add(
                    new LineSegments2(geometry, this.gridMinorMaterial),
                );
            }
            this.planeGroups[plane].visible = grid.planes[plane];
        }

        // --- 坐标轴刻度线 ---
        const axisLength = RENDER_CONFIG.scene.axesLength;
        const tickMajorSegments: number[] = [];
        const tickMinorSegments: number[] = [];
        for (let pos = minorStep; pos <= axisLength + eps; pos += minorStep) {
            const isMajor = Math.abs(pos % majorStep) < eps;
            const length = isMajor ? axisTicks.majorLength : axisTicks.minorLength;
            const halfLen = length / 2;
            const target = isMajor ? tickMajorSegments : tickMinorSegments;
            // X 轴刻度沿 Z 方向;Y/Z 轴刻度沿 X 方向
            target.push(pos, 0, -halfLen, pos, 0, halfLen);
            target.push(-halfLen, pos, 0, halfLen, pos, 0);
            target.push(-halfLen, 0, pos, halfLen, 0, pos);
        }
        if (tickMajorSegments.length) {
            const geometry = new LineSegmentsGeometry();
            geometry.setPositions(tickMajorSegments);
            this.tickGroup.add(new LineSegments2(geometry, this.tickMajorMaterial));
        }
        if (tickMinorSegments.length) {
            const geometry = new LineSegmentsGeometry();
            geometry.setPositions(tickMinorSegments);
            this.tickGroup.add(new LineSegments2(geometry, this.tickMinorMaterial));
        }

        // --- 刻度数字(与 XYZ 轴标签共用字体/画布尺寸/缩放)---
        const { labelColor, labelOffset } = axisTicks;
        for (let pos = minorStep; pos <= axisLength + eps; pos += minorStep) {
            const xLabel = this.createTextSprite(String(pos), labelColor);
            xLabel.position.set(pos, 0, labelOffset);
            xLabel.visible = RENDER_CONFIG.scene.axisLabels.x;
            this.axisTickNumbers.x.push(xLabel);
            this.tickGroup.add(xLabel);

            const yLabel = this.createTextSprite(String(pos), labelColor);
            yLabel.position.set(labelOffset, pos, 0);
            yLabel.visible = RENDER_CONFIG.scene.axisLabels.y;
            this.axisTickNumbers.y.push(yLabel);
            this.tickGroup.add(yLabel);

            const zLabel = this.createTextSprite(String(pos), labelColor);
            zLabel.position.set(labelOffset, 0, pos);
            zLabel.visible = RENDER_CONFIG.scene.axisLabels.z;
            this.axisTickNumbers.z.push(zLabel);
            this.tickGroup.add(zLabel);
        }
        this.tickGroup.visible = axisTicks.visible;
    }

    /**
     * 创建文字 Sprite.
     * 刻度数字与 XYZ 轴标签共用同一字体/画布尺寸/缩放,保证一起缩放.
     */
    private createTextSprite(text: string, color: string): THREE.Sprite {
        const size = RENDER_CONFIG.scene.labelCanvasSize;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, size, size);
        ctx.font = RENDER_CONFIG.scene.labelFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(text, size / 2, size / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(
            RENDER_CONFIG.scene.labelScale,
            RENDER_CONFIG.scene.labelScale,
            1,
        );
        return sprite;
    }

    /**
     * 创建一段 Line2 坐标轴,并记录材质供线宽/分辨率更新.
     */
    private createAxisLine(
        start: [number, number, number],
        end: [number, number, number],
        color: string,
    ): void {
        const geometry = new LineGeometry();
        geometry.setPositions([...start, ...end]);

        const material = new LineMaterial({
            color,
            linewidth: RENDER_CONFIG.scene.axisLineWidth,
            resolution: new THREE.Vector2(
                this.container.clientWidth,
                this.container.clientHeight,
            ),
        });
        const line = new Line2(geometry, material);
        this.scene.add(line);
        this.axisLineMaterials.push(material);
        this.resolutionMaterials.push(material);
    }

    dispose(): void {
        this.scene.traverse((node: THREE.Object3D) => {
            if (
                node instanceof THREE.Mesh
                || node instanceof THREE.Line
                || node instanceof THREE.Points
            ) {
                node.geometry?.dispose();
                const materials = Array.isArray(node.material) ? node.material : [node.material];
                for (const material of materials) {
                    const texturedMaterial = material as {
                        map?: THREE.Texture | null;
                        dispose?: () => void;
                    };
                    texturedMaterial.map?.dispose();
                    texturedMaterial.dispose?.();
                }
            } else if (node instanceof THREE.Sprite) {
                node.geometry?.dispose();
                node.material.map?.dispose();
                node.material.dispose();
            }
        });

        this.renderer.dispose();
        if (this.renderer.domElement.parentElement === this.container) {
            this.container.removeChild(this.renderer.domElement);
        }
    }
}
