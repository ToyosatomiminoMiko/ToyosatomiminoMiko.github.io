/**
 * SceneStore -- math-lab 应用层的场景状态仓库.
 *
 * 这里只保存与"当前这次编译/渲染会话"直接相关的状态:
 * - 最近一次成功解析的 AST
 * - 当前矩阵运算后端
 * - 最近一次编译出的场景对象快照
 * - 实体/分析/积分的显隐状态
 * - 动画计时起点
 *
 * 它不负责解析/编译/渲染,也不直接操作 DOM.CompileController 负责
 * 写入 AST 和 matrixOps,RenderController 负责写入场景快照并读取显隐状态.
 * 把状态从 DslApp 抽出来,是为了让 DslApp 只做装配和事件编排.
 */
import type { AstProgram } from '../compiler/ast/types';
import type { SceneIR, SceneObject } from '../compiler/ir/types';
import type { MatrixOps } from '../math/tensor/SceneTransform';

export class SceneStore {
    private _currentAst: AstProgram | null = null;
    private _lastRunSource = '';
    /**
     * 首次 run() 成功前没有可用的 WASM 后端;渲染层在该时间点前不会使用矩阵.
     */
    private _matrixOps: MatrixOps | null = null;
    private _compiledObjects: SceneObject[] = [];

    /**
     * @cache
     * 缓存目的:镜像最近一次 SceneIR.objectTransforms,方便未来做对象级
     *          诊断/导出或状态恢复.
     * 更新策略:每次 RenderController 提交 SceneIR 时整体替换.
     * 生命周期:跟随 SceneStore 实例,应用销毁时由 GC 回收.
     *
     * 审查结论(202609):本字段刻意保留为"只写暂不读"的预留快照,不是
     * 缺陷,无需"接上"或删除.
     * - 写入点:setScene(),与 SceneIR.objectTransforms 是同一引用,非拷贝,
     *   无额外内存开销.
     * - 读取面:仅下方 getter;全仓暂没有任何调用方.渲染热路径直接使用
     *   AnimationPlayer 的时间线矩阵,不经由此处,因此它不参与每帧渲染,
     *   也没有实时副作用.
     * - 用途:保留"最近一次会话的对象变换末态",供未来的对象级诊断/
     *   导出/状态恢复直接取用,不必重新从 SceneIR 接线.
     * 若将来确认该能力不会做,删除三处即可:本字段,objectTransforms
     * getter,setScene() 里的赋值.
     */
    private _objectTransforms: Record<number, number[][]> = {};

    private _animationStartTime = 0;

    private readonly _hiddenEntityIds = new Set<number>();
    private readonly _hiddenAnalysisNames = new Set<string>();
    private readonly _hiddenIntegralNames = new Set<string>();
    private readonly _hiddenIntersectionNames = new Set<string>();

    get ast(): AstProgram | null {
        return this._currentAst;
    }

    /** 最近一次成功解析的源码;CompileController 用它把编译错误的 span 换算成行列. */
    get source(): string {
        return this._lastRunSource;
    }

    get matrixOps(): MatrixOps | null {
        return this._matrixOps;
    }

    get compiledObjects(): readonly SceneObject[] {
        return this._compiledObjects;
    }

    /** 只写暂不读的预留快照,当前无调用方;结论见字段 _objectTransforms 注释. */
    get objectTransforms(): Readonly<Record<number, number[][]>> {
        return this._objectTransforms;
    }

    get animationStartTime(): number {
        return this._animationStartTime;
    }

    get hiddenEntityIds(): ReadonlySet<number> {
        return this._hiddenEntityIds;
    }

    get hiddenAnalysisNames(): ReadonlySet<string> {
        return this._hiddenAnalysisNames;
    }

    get hiddenIntegralNames(): ReadonlySet<string> {
        return this._hiddenIntegralNames;
    }

    get hiddenIntersectionNames(): ReadonlySet<string> {
        return this._hiddenIntersectionNames;
    }

    /**
     * @cache-access
     * 在一次源码解析成功后提交新的 AST 和矩阵后端.
     *
     * 只有当源码内容发生变化时才重置显隐状态.这样 Ctrl+Enter 重跑同一份
     * 源码不会把用户手动隐藏的对象突然恢复出来.
     */
    commitSource(
        source: string,
        ast: AstProgram,
        nextMatrixOps: MatrixOps,
    ): void {
        if (this._lastRunSource !== source) {
            this._hiddenEntityIds.clear();
            this._hiddenAnalysisNames.clear();
            this._hiddenIntegralNames.clear();
            this._hiddenIntersectionNames.clear();
        }

        this._lastRunSource = source;
        this._currentAst = ast;
        this._matrixOps = nextMatrixOps;
    }

    /**
     * @cache-access
     * 保存最近一次编译出的对象快照和变换镜像.
     */
    setScene(scene: SceneIR): void {
        this._compiledObjects = scene.objects;
        this._objectTransforms = scene.objectTransforms;
    }

    setAnimationStartTime(value: number): void {
        this._animationStartTime = value;
    }

    /** 返回从动画起点开始经过的秒数;没有起点时按 0 处理. */
    getElapsedSeconds(now: number = performance.now()): number {
        if (this._animationStartTime === 0) return 0;
        return (now - this._animationStartTime) / 1000;
    }

    /**
     * @cache-access
     * 从最近一次编译对象快照中查找实体.
     */
    findObject(id: number): SceneObject | undefined {
        return this._compiledObjects.find((candidate) => candidate.id === id);
    }

    isEntityHidden(id: number): boolean {
        return this._hiddenEntityIds.has(id);
    }

    /**
     * @cache-access
     * 更新实体显隐缓存.
     */
    setEntityHidden(id: number, hidden: boolean): void {
        if (hidden) {
            this._hiddenEntityIds.add(id);
        } else {
            this._hiddenEntityIds.delete(id);
        }
    }

    /**
     * @cache-access
     * 更新分析对象显隐缓存.
     */
    toggleAnalysisHidden(name: string): void {
        if (this._hiddenAnalysisNames.has(name)) {
            this._hiddenAnalysisNames.delete(name);
        } else {
            this._hiddenAnalysisNames.add(name);
        }
    }

    /**
     * @cache-access
     * 更新积分对象显隐缓存.
     */
    toggleIntegralHidden(name: string): void {
        if (this._hiddenIntegralNames.has(name)) {
            this._hiddenIntegralNames.delete(name);
        } else {
            this._hiddenIntegralNames.add(name);
        }
    }

    /**
     * @cache-access
     * 更新求交对象显隐缓存.
     */
    toggleIntersectionHidden(name: string): void {
        if (this._hiddenIntersectionNames.has(name)) {
            this._hiddenIntersectionNames.delete(name);
        } else {
            this._hiddenIntersectionNames.add(name);
        }
    }
}
