/*
声明式 DOM 构造原语(hyperscript 风格的 `h()`)-- **全站唯一**的一个.

本站的 UI 不用框架,但标记不写在 HTML 里,而是由组件函数**声明式**地描述:
每个组件接收 props,返回由 `h()` 构造的元素.`h()` 只做"描述 -> 元素"这一件事:

  - 没有状态,没有副作用,没有生命周期:调用一次就得到一个刚建好的元素;
  - 所有属性都是显式的(`class` / `attrs` / `dataset` / `children`),
    不读全局,也不依赖调用顺序;
  - 事件绑定交给调用方(`addEventListener`),让本模块保持"纯结构".

这样做的目的和 config.ts 一样:把"结构"集中成可读的数据与函数,改一处
(比如面板换布局)不需要同时改 HTML 与 TS 两处.

**唯一原语**:任何模块都不再自己写 `document.createElement`(除了 canvas 的
像素操作这类必须拿原生 API 的场合).原先它养在 metro_window 组件里
(`src/metro_window/src/ui/dom.ts`),站点其它 UI 也要按同一条约定编排时,
提升到这里,由全站共用一份 -- 两处各养一份迟早漂移.
*/

/** 子节点:元素/文本节点,或一段纯文本(按文本节点插入,不会被当成 HTML 解析) */
export type DomChild = Node | string;

/** `h()` 的元素描述 */
export interface DomOptions {
    /** 类名,多个用空格分隔 */
    readonly class?: string;
    /** 纯文本内容;与 children 同时给出时,children 仍会追加在后面 */
    readonly text?: string;
    /** 普通属性,值由 String() 转换,如 id / type / min / max / step */
    readonly attrs?: Readonly<Record<string, string | number>>;
    /**
     * data-* 键值,键名不带 `data-` 前缀,如 { style: 0 } -> data-style="0".
     *
     * 键名是**真正的属性名**,允许出现连字符(`{ 'bs-toggle': 'tab' }` ->
     * `data-bs-toggle="tab"`,bootstrap 的声明式标签页就靠它).所以这里必须走
     * setAttribute:`element.dataset['bs-toggle'] = ...` 会直接抛
     * SyntaxError("not a valid property name") -- dataset(DOMStringMap)的键
     * 只接受不带连字符的标识符,连字符得写成驼峰 bsToggle.
     */
    readonly dataset?: Readonly<Record<string, string | number>>;
}

/** data-* 属性的前缀(键名到属性名的唯一一处拼接) */
const DATA_ATTRIBUTE_PREFIX = 'data-';

/**
 * 按描述创建一个元素.
 *
 * @param tag      标签名(受 HTMLElementTagNameMap 约束,返回类型随之收窄)
 * @param options  类名 / 文本 / 属性 / dataset
 * @param children 子节点(字符串按文本插入)
 */
export function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options: DomOptions = {},
    children: readonly DomChild[] = [],
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (options.class !== undefined) {
        element.className = options.class;
    }
    if (options.text !== undefined) {
        element.textContent = options.text;
    }
    for (const [name, value] of Object.entries(options.attrs ?? {})) {
        element.setAttribute(name, String(value));
    }
    for (const [name, value] of Object.entries(options.dataset ?? {})) {
        element.setAttribute(`${DATA_ATTRIBUTE_PREFIX}${name}`, String(value));
    }
    element.append(...children);
    return element;
}
