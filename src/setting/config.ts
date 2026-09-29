/*
SETTING 标签页的声明式模型.

这一页只有一样东西:**三块设置组**(背景 / 实时参数 / 图层贴图),外加整页面板
("设置")的标题.这里收的就是"会被 CSS 与自动化按名字命中"的全部字面量:三块组的
宿主 id,组的公共类名,背景行的类名,页面透明度的口径.这类字面量写错**不会报错**,
只会静默失效(样式掉了 / 选择器选不到),所以不许散在标记与行为里.

分工:

  - `setting_page.ts` 按本文件建出整页面板与**三颗空 fieldset**(宿主 = 设置组本身);
  - 各模块只往交回的元素里长内容,不自己建框体,也不记类名:
      背景                 -> `background_section.ts` 的 `mountBackgroundSection()`
      实时参数 / 图层贴图   -> `@/metro_window/src/metro_window` 的 `mountMetroWindow()`

为什么宿主就是那颗 fieldset:面板体的直接子节点因此正好是三颗设置组,既没有
`div` 包 `fieldset` 的一层空壳,也没有"一个 id 定位宿主,另一个 id 定位里面那颗
框体"这种一物两名(同一个东西两个 id,改名字要改两处,还看不出哪个才是框体).
*/

// ---------- 整页面板 ----------

/** 面板标题文案(标签栏那一项是 SETTING,页内标题沿用中文"设置") */
export const SETTING_PANEL_TITLE = '设置';

// ---------- 三块设置组 ----------

/**
 * 设置组的公共样式类名(样式见本目录的 `setting.css`).
 *
 * 它是**站点样式与标记之间的契约**:三块设置组的框体(内边距 / 底色 / 描边 /
 * 圆角 / legend / 禁用态)与组里控件的观感(滑块的配色与字体)都只在那一个作用域下
 * 写一份 -- 少一个类就是"框体与控件观感静默消失".
 */
export const SETTING_GROUP_CLASS = 'setting-group';

/**
 * 三块设置组的 id(顺序即界面顺序).
 *
 * 它们同时是:样式与调试的定位锚点,单测与冒烟脚本的查询钩子.`metro-params` /
 * `metro-uploads` 两块装的是地铁车窗的控制台与上传面板,所以名字沿用组件的叫法;
 * 它们**不是**组件必须提供的宿主 -- 组件只接元素引用(见 metro_window.ts 的
 * `MetroMountPoints`),id 与框体都在站点这一侧.
 */
export const SETTING_GROUP_IDS = {
    /** 背景切换组(缩略图行 + 页面透明度滑块) */
    background: 'setting-bg',
    /** 地铁车窗的实时参数控制台 */
    params: 'metro-params',
    /** 地铁车窗的图层贴图上传面板 */
    uploads: 'metro-uploads',
} as const;

/** 三块设置组的 id 列表(顺序即界面顺序),给"id 唯一且不与标签页撞车"那条测试用 */
export const SETTING_GROUP_ID_LIST = [
    SETTING_GROUP_IDS.background,
    SETTING_GROUP_IDS.params,
    SETTING_GROUP_IDS.uploads,
] as const;

// ---------- 背景切换 ----------

/** 背景缩略图清单的一项 */
interface BackgroundPresetSpec {
    /** 图片地址(站点 public 下的路径) */
    readonly src: string;
    /** 缩略图下方的名字(同时是那颗按钮的可访问名) */
    readonly label: string;
}

/** 可选背景,顺序即界面顺序;点缩略图切整站背景(见 background.ts) */
export const BACKGROUND_PRESETS = [
    { src: '/images/bgimg/bgstar.gif', label: 'STAR' },
    { src: '/images/bgimg/bgcode.gif', label: 'CODE' },
] as const satisfies readonly BackgroundPresetSpec[];

/** 背景设置组的 legend 文案(与另外两块设置组的 legend 同一种用法) */
export const BACKGROUND_GROUP_LEGEND = '背景';

/**
 * 背景组里那条 flex 行的类名(排布样式见 setting.css 的 `.bgrow`):
 * 行本身不是控件,只是把两颗缩略图与"页面透明度"滑块并排摆开的容器;
 * 页面透明度滑块(mountPageOpacity)往它里面追加,所以挂载函数要把它交回去.
 */
export const BACKGROUND_ROW_CLASS = 'bgrow';

/**
 * 缩略图按钮的类名:整块 tile 由库的 `createButton` 生成(基线类 `.ui-button`),
 * 这个类只叠本站要盖住基线的部分(块的排布与内边距,见 setting.css 的 `.bgbtn`).
 */
export const BACKGROUND_BUTTON_CLASS = 'bgbtn';

/**
 * 缩略图本身的类名:background.ts 的点击委托先按**按钮**命中,
 * 再从这个按钮里按它取出要切的那张图.
 */
export const BACKGROUND_IMAGE_CLASS = 'bgimg';

/**
 * 承载"当前生效背景图"的 CSS 自定义属性名.
 * 默认值在 public/css/tokens.css 的 :root(回落到 --bg-image-default),
 * 由 public/css/index.css 的 body 规则消费.这是 CSS 与 TS 的跨语言契约,
 * 改这里的字面量必须同步那两个样式表.
 */
export const BACKGROUND_IMAGE_VARIABLE = '--bg-image-active';

// ---------- 页面透明度 ----------

/*
 背景行里那条"页面透明度"滑块:拖它改的是**标签页窗格**的 opacity(导航条在窗格
 外面,不受影响).这个量的三处落点(滑块本身 / public/css/tokens.css 的初值 /
 index.css 的 `.tab-pane` 规则)里,数值口径集中在这里,样式那边只引用令牌名.
*/

/**
 * 窗格透明度的 CSS 自定义属性名.
 * 默认值在 public/css/tokens.css 的 :root,消费方是 index.css 的 `.tab-pane`
 * 规则;运行时的值由页面透明度滑块写到文档根的内联样式上.
 * 这是 CSS 与 TS 的跨语言契约,改这里的字面量必须同步那两个样式表.
 */
export const PAGE_OPACITY_VARIABLE = '--tab-pane-opacity';

/**
 * 透明度初值(也是滑块的重置目标).
 * 必须与 public/css/tokens.css 的 `--tab-pane-opacity` 相等,理由见那边.
 */
export const PAGE_OPACITY_DEFAULT = 0.9;

/**
 * 滑块区间与步长.
 *
 * 下限 0.5:这条滑块自己就住在窗格(SETTING)里,再往下调连它也会跟着变淡 --
 * 到 0 就是彻底消失,只剩一条看不见的滑杆,想拖回来全靠盲操;0.5 是"自己还看得清"
 * 的那一档.步长 0.01 与缺省的两位小数显示同一档.
 */
export const PAGE_OPACITY_MIN = 0.5;
export const PAGE_OPACITY_MAX = 1;
export const PAGE_OPACITY_STEP = 0.01;

/** 滑块名称(可见文案:库会把 `<label for>` 关联到滑杆,同时是数值框的可访问名) */
export const PAGE_OPACITY_LABEL = '页面透明度';

/**
 * 滑块根节点的站点类名(样式见 setting.css 的 `.opacity-field`:它在背景行里占多宽).
 * 库的 `.slider-field` 只管内部排布,不决定"一条滑块在一排里多宽".
 */
export const PAGE_OPACITY_FIELD_CLASS = 'opacity-field';
