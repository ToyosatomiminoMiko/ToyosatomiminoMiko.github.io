import * as THREE from 'three';
/*
黎曼积分可视化
2D: InstancedMesh 方块柱体
3D: InstancedMesh 方块柱体
勒贝格积分(计划中)
*/
export class IntegralVisualizer {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.scene.add(this.group);
        this.cache = new Map(); // id -> { type, objects }
    }

    clearAll() {
        while (this.group.children.length > 0) {
            const child = this.group.children[0];
            this.group.remove(child);
            child.traverse((node) => {
                if (node.isMesh) {
                    node.geometry?.dispose();
                    if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
                    else node.material?.dispose();
                }
            });
        }
        this.cache.clear();
    }

    clear(id) {
        const entry = this.cache.get(id);
        if (entry) {
            this.group.remove(entry.objects);
            entry.objects.traverse((node) => {
                if (node.isMesh) {
                    node.geometry?.dispose();
                    if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
                    else node.material?.dispose();
                }
            });
            this.cache.delete(id);
        }
    }

    // 2D 黎曼和可视化
    // 用 InstancedMesh 合并所有方块,减少 draw call
    // 间隙 gap 控制方块之间的视觉间隔,gap=0 为紧贴
    visualize2DRiemann(expr, a, b, N) {
        const fn = expr.fn;
        const h = (b - a) / N;       // 每个方块的宽度
        const color = new THREE.Color(expr.color);

        // 先收集所有有效柱子的数据
        const bars = [];
        for (let i = 0; i < N; i++) {
            const x0 = a + i * h;
            const yVal = fn(x0);     // 左端点高度,与 riemann1dLeft 一致

            if (!isFinite(yVal) || Math.abs(yVal) < 1e-12) continue;
            const absY = Math.abs(yVal);

            bars.push({
                pos: [x0 + h / 2, yVal / 2, 0],
                scale: [h * 0.97, absY, 0.3],   // 间隙 3%, z 轴深度 0.3
                color: color,
            });
        }

        if (bars.length === 0) return;

        // 共享几何体: 单位盒子,通过 scale 调整大小
        const boxGeo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshPhongMaterial({
            color: color,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
        });

        // InstancedMesh: 一次 draw call 画所有方块
        const mesh = new THREE.InstancedMesh(boxGeo, mat, bars.length);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < bars.length; i++) {
            const b = bars[i];
            dummy.position.set(b.pos[0], b.pos[1], b.pos[2]);
            dummy.scale.set(b.scale[0], b.scale[1], b.scale[2]);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;

        // 边框: InstancedMesh + EdgesGeometry 共享
        const edgeGeo = new THREE.EdgesGeometry(boxGeo);
        const edgeMat = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.4,
        });
        const wireMesh = new THREE.InstancedMesh(edgeGeo, edgeMat, bars.length);
        for (let i = 0; i < bars.length; i++) {
            const b = bars[i];
            dummy.position.set(b.pos[0], b.pos[1], b.pos[2]);
            dummy.scale.set(b.scale[0], b.scale[1], b.scale[2]);
            dummy.updateMatrix();
            wireMesh.setMatrixAt(i, dummy.matrix);
        }
        wireMesh.instanceMatrix.needsUpdate = true;

        const barGroup = new THREE.Group();
        barGroup.add(mesh);
        barGroup.add(wireMesh);

        this.group.add(barGroup);
        this.cache.set(expr.id, { type: '2d', objects: barGroup });
    }

    visualize3DRiemann(expr, xRange, yRange, N, M) {
        const fn = expr.fn;
        const [xMin, xMax] = xRange;
        const [yMin, yMax] = yRange;
        const hx = (xMax - xMin) / N;
        const hy = (yMax - yMin) / M;
        const baseColor = new THREE.Color(expr.color);

        // 先收集所有有效柱子的数据
        const bars = [];
        for (let j = 0; j < M; j++) {
            const y0 = yMin + j * hy;
            for (let i = 0; i < N; i++) {
                const x0 = xMin + i * hx;
                const zVal = fn(x0, y0);
                if (!isFinite(zVal) || Math.abs(zVal) < 1e-12) continue;

                const absZ = Math.abs(zVal);
                const c = baseColor.clone();
                const brightness = 0.6 + 0.4 * (zVal / 4 + 0.5);
                c.multiplyScalar(Math.max(0.3, Math.min(1.2, brightness)));

                bars.push({
                    pos: [x0 + hx / 2, y0 + hy / 2, zVal / 2],
                    scale: [hx * 0.98, hy * 0.98, absZ], // 间隙系数
                    color: c,
                });
            }
        }

        if (bars.length === 0) return;

        // 共享几何体和材质
        const boxGeo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshPhongMaterial({
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
        });

        // InstancedMesh
        const mesh = new THREE.InstancedMesh(boxGeo, mat, bars.length);
        const dummy = new THREE.Object3D();
        const colorAttr = new THREE.Color();

        for (let i = 0; i < bars.length; i++) {
            const b = bars[i];
            dummy.position.set(b.pos[0], b.pos[1], b.pos[2]);
            dummy.scale.set(b.scale[0], b.scale[1], b.scale[2]);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            mesh.setColorAt(i, b.color);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;

        // 边框也用 InstancedMesh
        const edgeGeo = new THREE.EdgesGeometry(boxGeo);
        const brighterColor = baseColor.clone().multiplyScalar(1.3);
        const edgeMat = new THREE.LineBasicMaterial({
            color: brighterColor,
            transparent: true,
            opacity: 0.15,
        });
        const wireMesh = new THREE.InstancedMesh(edgeGeo, edgeMat, bars.length);
        for (let i = 0; i < bars.length; i++) {
            const b = bars[i];
            dummy.position.set(b.pos[0], b.pos[1], b.pos[2]);
            dummy.scale.set(b.scale[0], b.scale[1], b.scale[2]);
            dummy.updateMatrix();
            wireMesh.setMatrixAt(i, dummy.matrix);
        }
        wireMesh.instanceMatrix.needsUpdate = true;

        const barGroup = new THREE.Group();
        barGroup.add(mesh);
        barGroup.add(wireMesh);

        this.group.add(barGroup);
        this.cache.set(expr.id, { type: '3d', objects: barGroup });
    }
    // 2D勒贝格可视化
    visualize2DLebesgue(expr, a, b, layers = 50) {
        const fn = expr.fn;
        const baseColor = new THREE.Color(expr.color);

        // ========== 第1步:高精度采样 ==========
        const h = (b - a) / 1000;
        const samples = [];
        let yMin = Infinity, yMax = -Infinity;
        for (let x = a; x <= b; x += h) {
            const y = fn(x);
            if (isFinite(y)) {
                samples.push({ x, y });
                if (y < yMin) yMin = y;
                if (y > yMax) yMax = y;
            }
        }
        if (samples.length === 0) return;

        // ========== 第2步:定义一个内部辅助函数,用来查找"连续区间" ==========
        // 因为正部和负部都要查区间,复用这段逻辑避免代码冗余
        // predicate 是一个判断函数,接收 y 值,返回 true 表示该点"在区间内"
        const scanIntervals = (predicate) => {
            const intervals = [];
            let start = null;
            for (let i = 0; i < samples.length; i++) {
                const inRange = isFinite(samples[i].y) && predicate(samples[i].y);
                if (inRange && start === null) start = samples[i].x;       // 进入区间
                if (!inRange && start !== null) {                          // 离开区间
                    intervals.push([start, samples[i].x]);
                    start = null;
                }
            }
            if (start !== null) intervals.push([start, b]); // 闭合到右端点
            return intervals;
        };

        // 存储所有将要绘制的条带数据
        const strips = [];

        // ================================================================
        // 第3步:[正部绘制]只处理 f(x) > 0 的部分(从 y=0 向上堆叠)
        // ================================================================
        if (yMax > 1e-12) {  // 只有最大值大于0才画正部
            const dy = yMax / layers;  // 正部每一层的高度
            if (dy >= 1e-12) {
                for (let k = 0; k < layers; k++) {
                    const lowerThreshold = k * dy;                    // 下阈值(从0开始)
                    const upperThreshold = (k + 1) * dy;              // 上阈值
                    const centerY = (lowerThreshold + upperThreshold) / 2; // 方块中心 y 坐标

                    // 找出所有满足 f(x) > lowerThreshold 的连续 x 区间
                    const intervals = scanIntervals((y) => y > lowerThreshold);

                    for (const [xStart, xEnd] of intervals) {
                        const stripWidth = xEnd - xStart;
                        if (stripWidth < 1e-6) continue;

                        // 颜色处理:层数越高越亮(向白色渐变)
                        const t = k / layers;
                        const c = baseColor.clone();
                        c.lerp(new THREE.Color(0xffffff), t * 0.5);

                        strips.push({
                            pos: [(xStart + xEnd) / 2, centerY, 0],
                            scale: [stripWidth * 0.98, dy * 0.9, 0.15],
                            color: c,
                        });
                    }
                }
            }
        }

        // ================================================================
        // 第4步:[负部绘制]只处理 f(x) < 0 的部分(从 y=0 向下堆叠)
        // ================================================================
        if (yMin < -1e-12) { // 只有最小值小于0才画负部
            const absYMin = -yMin;           // 取绝对值
            const dy = absYMin / layers;     // 负部每一层的高度(正值)
            if (dy >= 1e-12) {
                for (let k = 0; k < layers; k++) {
                    const lowerThreshold = k * dy;                    // 下阈值(从0开始递增)
                    const upperThreshold = (k + 1) * dy;
                    const centerY = -(lowerThreshold + upperThreshold) / 2; // 方块中心 y 坐标(负值)

                    // 找出所有满足 f(x) < -lowerThreshold 的连续 x 区间
                    // 例如 lowerThreshold=0.5 时,找 f(x) < -0.5 的区域
                    const intervals = scanIntervals((y) => y < -lowerThreshold);

                    for (const [xStart, xEnd] of intervals) {
                        const stripWidth = xEnd - xStart;
                        if (stripWidth < 1e-6) continue;

                        // 颜色处理:同样向白色渐变,但为了区分正负,我们让负部颜色偏冷(带一点蓝色)且略暗
                        const t = k / layers;
                        const c = baseColor.clone();
                        c.lerp(new THREE.Color(0xffffff), t * 0.4);     // 向白色插值比例略少,保留更多原色
                        c.lerp(new THREE.Color(0x4488ff), 0.15);        // 强制混入 15% 的蓝色,视觉上与正部区分

                        strips.push({
                            pos: [(xStart + xEnd) / 2, centerY, 0],
                            scale: [stripWidth * 0.98, dy * 0.9, 0.15],
                            color: c,
                        });
                    }
                }
            }
        }

        // ========== 如果没有生成任何条带,直接返回 ==========
        if (strips.length === 0) return;

        // ========== 第5步:批量渲染(与原代码相同,但为了完整性保留) ==========
        const boxGeo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshPhongMaterial({
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide,
        });

        const mesh = new THREE.InstancedMesh(boxGeo, mat, strips.length);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < strips.length; i++) {
            const s = strips[i];
            dummy.position.set(s.pos[0], s.pos[1], s.pos[2]);
            dummy.scale.set(s.scale[0], s.scale[1], s.scale[2]);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            mesh.setColorAt(i, s.color);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;

        const stripGroup = new THREE.Group();
        stripGroup.add(mesh);

        this.group.add(stripGroup);
        this.cache.set(expr.id + '_lebesgue', { type: '2d', objects: stripGroup });
    }

    // ================================================================
    // 3D 勒贝格积分可视化(等高线切片)
    // 数学逻辑:严格区分正部(z>0,向上堆叠)和负部(z<0,向下堆叠)
    // 阈值全部从 z=0 开始计算,确保准确反映函数与 xOy 平面围成的有符号体积
    // ================================================================
    visualize3DLebesgue(expr, xRange, yRange, layers = 20) {
        // ----- 第1步:解构参数,准备采样 -----
        const fn = expr.fn;
        const [xMin, xMax] = xRange;
        const [yMin, yMax] = yRange;
        const baseColor = new THREE.Color(expr.color);
        const res = 80;  // 采样网格精度:80x80 = 6400 个网格单元

        // 计算 x 和 y 方向上的采样步长
        const hx = (xMax - xMin) / res;
        const hy = (yMax - yMin) / res;

        // ----- 第2步:在二维网格上采样,记录每个点的 z 值 -----
        let zMin = Infinity, zMax = -Infinity;
        const grid = []; // 二维数组,grid[j][i] 对应坐标 (xMin + i*hx, yMin + j*hy)
        for (let j = 0; j <= res; j++) {
            const y = yMin + j * hy;
            const row = [];
            for (let i = 0; i <= res; i++) {
                const x = xMin + i * hx;
                const z = fn(x, y);
                if (isFinite(z)) {
                    row.push(z);
                    // 实时更新全局最大最小值(原始值,不取绝对值)
                    if (z < zMin) zMin = z;
                    if (z > zMax) zMax = z;
                } else {
                    row.push(NaN); // 无效点用 NaN 占位
                }
            }
            grid.push(row);
        }

        // 如果没有任何有效点,直接退出
        if (!isFinite(zMin) || !isFinite(zMax)) return;

        // ----- 第3步:存储所有将要绘制的小方块(切片)的数据 -----
        const slices = [];

        // ================================================================
        // 第4步:【绘制正部】只处理 z > 0 的部分(从 z=0 向上堆叠)
        // 注意:正部使用完整的 layers 层,以保证细节丰富
        // ================================================================
        if (zMax > 1e-12) { // 只有最大值明显大于 0 才画正部
            const dzPos = zMax / layers; // 正部每一层在 z 轴上的厚度

            // 如果层厚太薄(接近 0),说明数据有问题,跳过
            if (dzPos >= 1e-12) {
                // 遍历每一层,k 从 0 到 layers-1
                for (let k = 0; k < layers; k++) {
                    // 【关键修正】下阈值从 0 开始,而不是从 zMin 开始！
                    const lowerThreshold = k * dzPos;          // 例如:0, 0.1, 0.2, ...
                    const upperThreshold = (k + 1) * dzPos;    // 例如:0.1, 0.2, 0.3, ...
                    // 方块的中心高度取这一层的中间值(都在 z>0 区域)
                    const centerZ = (lowerThreshold + upperThreshold) / 2;

                    // 遍历所有网格单元 (j, i),判断这个单元是否"完全位于超水平集内部"
                    for (let j = 0; j < res; j++) {
                        for (let i = 0; i < res; i++) {
                            // 取出该网格单元的四个角上的 z 值
                            const z00 = grid[j][i];
                            const z10 = grid[j][i + 1];
                            const z01 = grid[j + 1][i];
                            const z11 = grid[j + 1][i + 1];

                            // 只要有一个角是 NaN(无效点),这个单元就不画
                            if (!isFinite(z00) || !isFinite(z10) ||
                                !isFinite(z01) || !isFinite(z11)) continue;

                            // 【数学严谨判定】只有四个角的 z 值都严格大于下阈值,才画这个单元
                            // 理由:这样才能保证这个单元 100% 属于集合 { (x,y) | f(x,y) > threshold }
                            // 虽然会漏掉边界上部分高于阈值的区域,但画出来的部分绝对正确,没有"灰色地带"
                            if (z00 > lowerThreshold && z10 > lowerThreshold &&
                                z01 > lowerThreshold && z11 > lowerThreshold) {

                                // 计算这个网格单元在 xOy 平面上的边界
                                const x0 = xMin + i * hx;
                                const x1 = x0 + hx;
                                const y0 = yMin + j * hy;
                                const y1 = y0 + hy;

                                // 计算方块中心位置(x 和 y 取单元中心,z 取层中心)
                                const centerX = (x0 + x1) / 2;
                                const centerY = (y0 + y1) / 2;

                                // 颜色处理:层数越高(t 越大),颜色越亮(向白色渐变)
                                const t = k / layers;
                                const c = baseColor.clone();
                                c.lerp(new THREE.Color(0xffffff), t * 0.5);

                                // 把这个方块的数据存起来,稍后批量绘制
                                slices.push({
                                    pos: [centerX, centerY, centerZ],
                                    // 尺寸:x 和 y 方向留 5% 的间隙(*0.95),z 方向厚度固定 0.05
                                    scale: [hx * 1, hy * 1, 0.05],
                                    color: c,
                                });
                            }
                        }
                    }
                }
            }
        }

        // ================================================================
        // 第5步:【绘制负部】只处理 z < 0 的部分(从 z=0 向下堆叠)
        // 注意:负部同样使用完整的 layers 层,以保证细节丰富
        // ================================================================
        if (zMin < -1e-12) { // 只有最小值明显小于 0 才画负部
            const absZMin = -zMin;               // 取绝对值,比如 zMin = -2,则 absZMin = 2
            const dzNeg = absZMin / layers;      // 负部每一层在 z 轴上的厚度(正值)

            if (dzNeg >= 1e-12) {
                for (let k = 0; k < layers; k++) {
                    // 这里 threshold 是正数(绝对值),用来衡量"离 z=0 平面有多远"
                    const lowerThreshold = k * dzNeg;          // 例如:0, 0.2, 0.4, ...
                    const upperThreshold = (k + 1) * dzNeg;    // 例如:0.2, 0.4, 0.6, ...
                    // 方块的中心高度取这一层的中间值,但整体取负(因为朝下生长)
                    const centerZ = -(lowerThreshold + upperThreshold) / 2; // 例如:-0.1, -0.3, ...

                    for (let j = 0; j < res; j++) {
                        for (let i = 0; i < res; i++) {
                            const z00 = grid[j][i];
                            const z10 = grid[j][i + 1];
                            const z01 = grid[j + 1][i];
                            const z11 = grid[j + 1][i + 1];

                            if (!isFinite(z00) || !isFinite(z10) ||
                                !isFinite(z01) || !isFinite(z11)) continue;

                            // 【数学严谨判定】四个角的 z 值都严格小于"负的阈值"
                            // 例如 lowerThreshold = 0.2,则条件为 z < -0.2
                            // 这保证了该单元完全位于集合 { (x,y) | f(x,y) < -threshold } 内部
                            if (z00 < -lowerThreshold && z10 < -lowerThreshold &&
                                z01 < -lowerThreshold && z11 < -lowerThreshold) {

                                const x0 = xMin + i * hx;
                                const x1 = x0 + hx;
                                const y0 = yMin + j * hy;
                                const y1 = y0 + hy;

                                const centerX = (x0 + x1) / 2;
                                const centerY = (y0 + y1) / 2;

                                // ---------- 颜色处理 ----------
                                const t = k / layers;
                                const c = baseColor.clone();
                                c.lerp(new THREE.Color(0xffffff), t * 0.5);

                                // =====================================================
                                // 【负部颜色调整区】如果你想让负部颜色和正部有所区分,
                                // 可以取消下面这行注释,让负部混入 15% 的蓝色调。
                                // 目前为了保持纯净的数学可视化,暂时保持和正部完全一致,
                                // 仅依靠"朝下生长"的位置来区分正负。
                                // =====================================================
                                // c.lerp(new THREE.Color(0x4488ff), 0.15); 

                                slices.push({
                                    pos: [centerX, centerY, centerZ],
                                    scale: [hx * 0.95, hy * 0.95, 0.1], // 厚度保持 0.05
                                    color: c,
                                });
                            }
                        }
                    }
                }
            }
        }

        // ----- 第6步:如果没有生成任何切片,直接返回 -----
        if (slices.length === 0) return;

        // ----- 第7步:批量绘制(使用 InstancedMesh)-----
        // 因为所有切片都是扁长方体,形状相同,只是位置/大小/颜色不同,
        // 使用 InstancedMesh 可以只上传一次几何体,大幅提高渲染性能。
        const boxGeo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshPhongMaterial({
            transparent: true,
            opacity: 0.4, // 【透明度参数】如果你想调整整体透明度,改这里(范围 0~1)
            side: THREE.DoubleSide, // 双面渲染,方便从各个角度观察切片
        });

        const mesh = new THREE.InstancedMesh(boxGeo, mat, slices.length);
        const dummy = new THREE.Object3D(); // 辅助对象,用来计算变换矩阵

        for (let i = 0; i < slices.length; i++) {
            const s = slices[i];
            dummy.position.set(s.pos[0], s.pos[1], s.pos[2]);
            dummy.scale.set(s.scale[0], s.scale[1], s.scale[2]);
            dummy.updateMatrix(); // 将位置/缩放更新到矩阵中
            mesh.setMatrixAt(i, dummy.matrix); // 把矩阵赋值给第 i 个实例
            mesh.setColorAt(i, s.color);       // 把颜色赋值给第 i 个实例
        }

        // 必须通知 Three.js 矩阵和颜色数据已经修改,需要重新上传到 GPU
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;

        // 把 mesh 装进一个 Group 里,方便统一管理
        const sliceGroup = new THREE.Group();
        sliceGroup.add(mesh);

        // 添加到场景,并缓存起来(方便后续移除或更新)
        this.group.add(sliceGroup);
        this.cache.set(expr.id + '_lebesgue', { type: '3d', objects: sliceGroup });
    }
}