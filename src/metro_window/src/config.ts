/*
地铁车窗前端的集中配置(纯声明式数据,不含业务逻辑).

页面提供**两个**空宿主:舞台(画布)与控制台(设置面板);舞台标记(画布,以及
可选的标题 / 副标题)由 src/ui/stage_content.ts 生成,设置面板(风格按钮 /
播放控制 / 滑块 / 状态区)由 src/ui/settings.ts 按本文件的模型生成;两边靠
下面这些字符串对齐,一旦散落在代码里,改一处漏一处就是"静默失效",
所以统一收到这里:

  - 宿主提供的挂载点 id,组件生成 / 查找的元素 id,类名 / data-* 键名;
  - 车窗标记的文案与画布渲染分辨率;
  - setParam / setStyle 的参数名        -- 必须与 src/metro_window/rust/src/lib.rs 一致;
  - 设置面板的完整结构模型(分组 / 顺序 / 文案 / 范围);
  - WebGPU 适配器识别规则与请求参数;
  - 全部状态 / 报错 / 帮助文案.

约定:
  - 每个值都是重构前字面量的逐字拷贝,只做"起名",不改数值与行为;
  - 对象与数组用 `as const satisfies` 收窄成字面量类型并校验结构;
  - 禁止在这里改动任何 id / class / 参数名,否则运行时静默失效.
*/

// ---------- DOM 契约 ----------

/** 作用域类名:组件样式的选择器全靠它作用域,由挂载函数加到**每一个**宿主上 */
export const WINDOW_CLASS = 'metro-window';

/**
 * 舞台宿主的修饰类:由挂载函数固定加在**舞台**宿主上(面板宿主不加).
 * 它把车窗面板的内边距与底色重置掉,让画布自己铺满宿主 -- 首屏(hero)需要,
 * 卡片内嵌时也无害(只是少一层内边距).画布的显示尺寸仍由 metro_window.css 决定.
 */
export const STAGE_MODIFIER_CLASS = 'metro-window--stage';

/**
 * 面板宿主被省略时,组件自建承载容器的类名.
 * 这个容器是隐藏的:设置面板,状态区与事件绑定都还在(状态区仍要被 Rust 写到),
 * 只是不显示 -- 留给"只想挂舞台"的宿主与拆分过程中的中间态.
 */
export const PANEL_SINK_CLASS = 'metro-panel-sink';

/**
 * 宿主必须提供的空容器 id(组件按 id 找,找不到就报错).
 *
 * 组件拆成"舞台"与"控制台"两块以后,一个页面里有两个宿主:
 *   - stage:WebGPU 画布,站点放在首屏;
 *   - panel:整套设置面板,站点放在 SETTING 标签页.
 * 与下面的 ELEMENT_IDS 区别要分清:这里是**宿主必须提供**的,
 * ELEMENT_IDS 是**组件自己生成**的.
 */
export const MOUNT_IDS = {
    /** 舞台(画布)空宿主 */
    stage: 'metro-window',
    /** 控制台(设置面板)空宿主 */
    panel: 'metro-params',
} as const;

/** 按 id 查元素时的选择器前缀:`#webgpu-canvas` 里的 `#` */
export const ID_SELECTOR_PREFIX = '#';

/** 找不到元素时抛错的文案前缀,后面直接拼 id */
export const MISSING_ELEMENT_MESSAGE_PREFIX = '找不到页面元素 #';

/** 找不到挂载点时的报错文案前缀,后面直接拼 id */
export const MISSING_MOUNT_MESSAGE_PREFIX = '找不到挂载点 #';

/**
 * 组件内部按 id 互相查找的元素.由 ui/stage_content.ts 生成,metro_window.ts
 * 取回,两边都引用这里的值,所以它不是"宿主必须提供的 id".
 * 键名是用途,值一旦改动必须两处同时生效(都从这里取,改这里即可).
 */
export const ELEMENT_IDS = {
    /** WebGPU 渲染画布 <canvas> */
    canvas: 'webgpu-canvas',
} as const;

// ---------- 车窗自身的页面级标记 ----------

/*
 * 画布(以及可选的标题 / 副标题)由 ui/stage_content.ts 生成,不再是页面 HTML.
 *
 * 原因:宿主只提供空容器,文案与画布尺寸集中在这里定义一次 -- 宿主页不重复
 * 任何标记,改文案只动这一个文件.
 *
 * 注意与上面的区别:上面是"宿主必须提供的 id",这里是"组件自己生成的内容".
 */

/**
 * 舞台是否生成首屏文案(标题 + 副标题).
 *
 * false = 只出画布:站点把首屏(hero)文案交给页面自己负责(站名在导航左上角,
 * 中央文案待定),组件不再往画面里塞字;WINDOW_TITLE / WINDOW_SUBTITLE 两个
 * 字符串仍然保留在本文件里,以后要把文案交回组件,改这一个开关即可.
 */
export const STAGE_COPY_ENABLED = false;

/** 车窗标题 <h1> 文案 */
export const WINDOW_TITLE = '🚇 地铁车窗 · Rust + WebGPU';

/** 车窗副标题 <p> 文案 */
export const WINDOW_SUBTITLE =
    'Rust/WASM 驱动 WebGPU:水滴物理/折射虚像/玻璃污渍/冷凝雾气/车厢灯光反射,三种风格实时切换';

/** 副标题的类名(metro_window.css 的 `.metro-window .subtitle`) */
export const SUBTITLE_CLASS = 'subtitle';

/**
 * 画布的渲染分辨率(宽度,像素).Rust 侧直接读 canvas.width/height 建 surface,
 * 所以这个值是**后备缓冲尺寸**(画多大),显示多大由 metro_window.css 控制.
 */
export const CANVAS_WIDTH = 1344;

/** 画布的渲染分辨率(高度,像素),与 CANVAS_WIDTH 同为 16:9 */
export const CANVAS_HEIGHT = 756;

/** 风格按钮的类名(三颗 data-style 按钮共用) */
export const STYLE_BUTTON_CLASS = 'style-btn';

/** 风格按钮"选中"态的类名,由 JS 切换 */
export const STYLE_BUTTON_ACTIVE_CLASS = 'active';

/** 风格按钮上 data-* 的键名(读取 dataset.style,取值 0/1/2) */
export const STYLE_DATA_KEY = 'style';

/** data-style 缺失时回退的风格序号(0 = 泡沫时期东京电车),也是初始选中项 */
export const DEFAULT_STYLE_INDEX = 0;

// ---------- 设置面板的声明式模型 ----------

/** 设置面板 <legend> 文案 */
export const PANEL_LEGEND = '🎚 实时参数';

/** 状态区"WebGPU 状态:"标签文案 */
export const STATUS_LABEL = 'WebGPU 状态:';

/** 状态区初始文案(wasm 加载前) */
export const STATUS_INITIAL = '初始化中...';

/** 状态区下方图层说明文案 */
export const LAYERS_NOTE =
    'Layer 0 窗外实景 · Layer 1 水珠折射虚像 · Layer 2 玻璃污渍 · ' +
    'Layer 3 冷凝雾气 · Layer 4 车厢灯光与倒影';

/**
 * 滑块宽度的 CSS 自定义属性名.组件把它设在每个滑块最外层 div.slider 上,
 * metro_window.css 的 `.slider` 再用 `var(--metro-slider-width)` 取用.
 * 统一加 `--metro-` 前缀,避免和 bootstrap / 站点变量撞名.
 */
export const SLIDER_WIDTH_PROPERTY = '--metro-slider-width';

/**
 * 声明里没写 `width` 时的默认宽度.
 * 指向 tokens.css 的设计令牌 `--metro-size-slider-width`,这样"默认宽度到底多少"
 * 只在 tokens.css 里定义一次;不写 width 的滑块全都拿到同一个值,宽度自然统一.
 */
export const SLIDER_WIDTH_DEFAULT = 'var(--metro-size-slider-width)';

/**
 * 单个实时滑块的声明式描述:既是标记(css 类名 / 范围 / 初始值),
 * 也是行为(param 名 / clamp 区间)的唯一来源.
 *
 * id       -- 生成 <input type="range"> 的 id,<label for> 靠它关联;
 * param    -- setParam 参数名,必须与 src/metro_window/rust/src/app_params.rs 的 SLIDERS 一致;
 * label    -- 滑杆下方的名称(左);
 * hint     -- 名称后的小字注释(可选),为空不渲染;
 * min/max  -- 前端可调区间(与 Rust 侧 clamp 区间各自独立,前端先夹一次);
 * step     -- 步长,同时决定显示小数位数;
 * value    -- 初始值;
 * width    -- 单个滑块的宽度(CSS 长度,可选),留空用 SLIDER_WIDTH_DEFAULT.
 */
export interface SliderSpec {
    readonly id: string;
    readonly param: string;
    readonly label: string;
    readonly hint?: string;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly value: number;
    /**
     * 单个滑块的宽度(CSS 长度,如 '320px' / '24rem' / '50%').
     * 留空 => SLIDER_WIDTH_DEFAULT,也就是 tokens.css 的 --metro-size-slider-width;
     * 因为默认所有滑块都不写 width,它们的宽度天然统一;只有确实需要特殊宽度
     * (比如名字特别长)才在声明里单独覆盖一条.
     */
    readonly width?: string;
}

/** 一个可折叠的滑块分组(<details class="slider-group">) */
export interface SliderGroupSpec {
    /** <summary> 文案 */
    readonly title: string;
    /** 是否默认展开 */
    readonly open: boolean;
    readonly sliders: readonly SliderSpec[];
}

/**
 * 全部实时滑块,按分组与显示顺序声明.
 * param 必须与 src/metro_window/rust/src/app_params.rs 的 SLIDERS 逐字一致(前端按名字调用,
 * 名字写错不会报错,只会静默不生效).
 */
export const SLIDER_GROUPS = [
    {
        title: '🚄 车速与背景距离',
        open: true,
        sliders: [
            /** 车速(倍率) */
            { id: 'vehicleSpeed', param: 'vehicle_speed', label: '车速', hint: '倍率', min: 0, max: 3, step: 0.01, value: 1 },
            /** 远景距离(越大越慢) */
            { id: 'farDistance', param: 'far_distance', label: '远景距离', hint: '越大越慢', min: 0.2, max: 3, step: 0.01, value: 1 },
            /** 中景距离(越大越慢) */
            { id: 'midDistance', param: 'mid_distance', label: '中景距离', hint: '越大越慢', min: 0.2, max: 3, step: 0.01, value: 1 },
            /** 近景距离(越大越慢) */
            { id: 'nearDistance', param: 'near_distance', label: '近景距离', hint: '越大越慢', min: 0.2, max: 3, step: 0.01, value: 1 },
        ],
    },
    {
        title: '💧 水滴与风',
        open: true,
        sliders: [
            /** 水滴大小(倍率) */
            { id: 'dropletSize', param: 'droplet_size', label: '水滴大小', hint: '倍率', min: 0.2, max: 2.5, step: 0.01, value: 1 },
            /** 向后风(随车速) */
            { id: 'windBackward', param: 'wind_backward_factor', label: '向后风', hint: '随车速', min: 0, max: 1, step: 0.01, value: 0.15 },
            /** 摇摆风(倍率) */
            { id: 'windSway', param: 'wind_sway_scale', label: '摇摆风', hint: '倍率', min: 0, max: 2, step: 0.01, value: 1 },
            /** 下落速度(倍率) */
            { id: 'gravityScale', param: 'gravity_scale', label: '下落速度', hint: '倍率', min: 0, max: 3, step: 0.01, value: 1 },
            /** 折射强度(倍率) */
            { id: 'refractionScale', param: 'refraction_scale', label: '折射强度', hint: '倍率', min: 0, max: 3, step: 0.01, value: 1 },
        ],
    },
    {
        title: '🪟 玻璃质感',
        open: true,
        sliders: [
            /** 玻璃污渍浓度 */
            { id: 'dirtOpacity', param: 'dirt_opacity', label: '污渍浓度', min: 0, max: 1, step: 0.01, value: 0.55 },
            /** 冷凝雾气浓度 */
            { id: 'fogOpacity', param: 'fog_opacity', label: '雾气浓度', min: 0, max: 1, step: 0.01, value: 0.3 },
            /** 车厢灯光强度 */
            { id: 'interiorOpacity', param: 'interior_opacity', label: '车厢灯光', min: 0, max: 1, step: 0.01, value: 0.55 },
        ],
    },
] as const satisfies readonly SliderGroupSpec[];

/** 一种可切换的渲染风格(生成一颗 data-style 按钮) */
export interface StylePresetSpec {
    /** 传给 setStyle 的风格编号,必须与 Rust 的 MAX_STYLE_INDEX 区间一致 */
    readonly index: number;
    readonly label: string;
}

/** 三颗风格按钮,顺序即界面顺序 */
export const STYLE_PRESETS = [
    { index: 0, label: '泡沫时期东京电车' },
    { index: 1, label: '赛博朋克' },
    { index: 2, label: '上海磁悬浮' },
] as const satisfies readonly StylePresetSpec[];

/** 播放控制按钮的用途,行为代码按它绑定事件 */
export type TransportAction = 'start' | 'pause' | 'reset';

/** 一颗播放控制按钮 */
export interface TransportButtonSpec {
    readonly action: TransportAction;
    /** 生成元素的 id(便于调试/自动化定位) */
    readonly id: string;
    readonly label: string;
    /** 初始是否禁用(加载完成前不可用) */
    readonly disabled?: boolean;
}

/** 播放 / 暂停 / 重置,顺序即界面顺序(中间由 .spacer 与风格按钮分开) */
export const TRANSPORT_BUTTONS = [
    { action: 'start', id: 'startBtn', label: '▶ 播放', disabled: false },
    { action: 'pause', id: 'pauseBtn', label: '⏸ 暂停', disabled: true },
    { action: 'reset', id: 'resetBtn', label: '🔄 重置', disabled: false },
] as const satisfies readonly TransportButtonSpec[];

/** 状态 <span> 的 id(便于调试/自动化定位) */
export const STATUS_ID = 'status';

/** 设置面板 <fieldset> 的 id(便于调试/自动化定位) */
export const PANEL_ID = 'paramPanel';

// ---------- WebGPU 适配器 ----------

/**
 * WebGPU 适配器请求参数.严格模式:只要高性能硬件适配器,不接受软件回退
 * (软件渲染会用 CPU 模拟每一帧,导致所有核心高占用).
 */
export const GPU_ADAPTER_OPTIONS = {
    /** 只要高性能(独显)适配器 */
    powerPreference: 'high-performance',
    /** 禁止回退到软件适配器 */
    forceFallbackAdapter: false,
} as const;

/** 读不到适配器信息时打印的占位名 */
export const UNKNOWN_ADAPTER_LABEL = '未知';

/** 适配器信息各字段拼成一个标签时的分隔符 */
export const ADAPTER_LABEL_SEPARATOR = ' ';

/** 识别"软件渲染(CPU 模拟)"适配器名称的正则;只匹配明确名称,避免误判 NVIDIA/AMD 硬件 */
export const SOFTWARE_ADAPTER_PATTERN = /swiftshader|llvmpipe|lavapipe|microsoft basic render/i;

/** Rust 侧"WebGPU 适配器"错误的关键字:命中时改走帮助文案而不是普通报错 */
export const WEBGPU_ADAPTER_ERROR_KEYWORD = 'WebGPU 适配器';

// ---------- 事件名 ----------

/** 组件注册的全部 DOM 事件名 */
export const EVENTS = {
    /** 标签页可见性变化(document) */
    visibilityChange: 'visibilitychange',
    /** 滑块/数字框输入(range 拖动,number 输入) */
    input: 'input',
    /** 数字框失焦或回车确认 */
    change: 'change',
    /** 按钮点击 */
    click: 'click',
} as const;

// ---------- 索引 / 解析 ----------

/** 取 IntersectionObserver 回调里最新一条记录时的倒数偏移(entries.length - 1) */
export const LAST_ENTRY_OFFSET = 1;

/** 从 step 字面量里解析小数位数时的分隔符 */
export const DECIMAL_SEPARATOR = '.';

/** split 之后小数部分所在的下标(1) */
export const DECIMAL_FRACTION_INDEX = 1;

// ---------- 文案 ----------

/** 所有报错/提示前的统一前缀(❌ + 一个空格) */
export const ERROR_LABEL = '❌ ';

/** 状态区在正文与帮助步骤之间的分隔 */
export const STATUS_HTML_SEPARATOR = '<br><br>';

/** 初始化状态文案:开始加载 wasm */
export const STATUS_LOADING_WASM = '正在加载 WebAssembly...';

/** 报错文案:浏览器没有 navigator.gpu */
export const STATUS_NO_WEBGPU_API = '当前浏览器不支持 WebGPU(未找到 navigator.gpu).';

/** 报错文案:requestAdapter 返回空 */
export const STATUS_NO_ADAPTER =
    '当前浏览器未提供 WebGPU 适配器(No available adapters).请检查是否已启用 WebGPU 与硬件加速后刷新重试';

/** console.warn 文案:读不到 adapter.info(不阻塞,交给 Rust 侧继续初始化) */
export const WARN_ADAPTER_INFO_UNAVAILABLE = '无法读取 WebGPU 适配器信息,跳过软件渲染检查';

/** console.info 文案前缀:成功读到适配器信息 */
export const LOG_ADAPTER_PREFIX = 'WebGPU 适配器:';

/**
 * 软件渲染适配器的报错文案(带适配器名插值).
 * 文案是"对外可见字符串",这里与拆分前保持逐字一致,只是把插值参数显式化.
 */
export const buildSoftwareAdapterMessage = (adapterLabel: string): string =>
    `${ERROR_LABEL}当前 WebGPU 适配器为 CPU 软件渲染(${adapterLabel}),说明这个浏览器实例访问不到独立显卡.若你用的是 Fedora/Chromium 且系统浏览器仍报此错,已知是 Chromium 沙箱挡住了 NVIDIA Vulkan 驱动,可改用 Firefox,或用 \`chromium-browser --no-sandbox --enable-unsafe-webgpu\` 启动(仅限本机可信页面).注意:chrome://flags/#enable-vulkan 可能导致 Chromium 黑屏,不建议启用`;

/** WebGPU 不可用时的帮助步骤(拼在原始报错之后,原样保留 HTML 片段) */
export const WEBGPU_HELP_STEPS =
    '请按以下任一步骤启用 WebGPU:<br>' +
    '① Chrome / Edge:地址栏打开 <b>chrome://flags/#enable-unsafe-webgpu</b> 或 <b>edge://flags/#enable-unsafe-webgpu</b>,选择 <b>Enabled</b> 并重启浏览器;<br>' +
    '② 在设置中开启"使用硬件加速"(Chrome 设置 -> 系统 -> 使用图形加速),并到 <b>chrome://gpu</b> 确认 WebGPU 状态为可用;<br>' +
    '③ Firefox:地址栏打开 <b>about:config</b>,搜索 <b>dom.webgpu.enabled</b> 设为 <b>true</b>;<br>' +
    '④ 若在虚拟机/远程桌面或无独显环境运行,请改用支持 WebGPU 的物理机/浏览器.';
