/*
地铁车窗前端的集中配置(纯常量,不含业务逻辑).

metro_window/index.html 提供标记,metro_window.ts / page.ts 只负责行为;两边靠
id / class / data-* / Rust 参数名这些字符串对齐,一旦散落在代码里,改一处漏一处
就是"静默失效",所以统一收到这里:

  - DOM 挂载点,元素 id,类名,data-* 键名  -- 必须与 metro_window/index.html 一致;
  - setParam / setStyle 的参数名            -- 必须与 metro_window/src/lib.rs 一致;
  - WebGPU 适配器识别规则与请求参数;
  - 全部状态 / 报错 / 帮助文案.

约定:
  - 每个值都是重构前字面量的逐字拷贝,只做"起名",不改数值与行为;
  - 对象与数组用 `as const` 收窄成字面量类型,防止被当成可变结构误改;
  - 禁止在这里改动任何 id / class / 参数名,否则运行时静默失效.
*/

// ---------- DOM 契约(必须与 metro_window/index.html 一致) ----------

/** 容器必须带的作用域类名:组件样式的选择器全靠它作用域 */
export const WINDOW_CLASS = 'metro-window';

/** 挂载点 id:page.ts 用它 getElementById,index.html 里也是这个值 */
export const MOUNT_ID = 'metro-window';

/** 风格按钮的类名(三颗 data-style 按钮共用) */
export const STYLE_BUTTON_CLASS = 'style-btn';

/** 风格按钮"选中"态的类名,由 JS 切换 */
export const STYLE_BUTTON_ACTIVE_CLASS = 'active';

/** 按 id 查元素时的选择器前缀:`#status` 里的 `#` */
export const ID_SELECTOR_PREFIX = '#';

/** 找不到元素时抛错的文案前缀,后面直接拼 id */
export const MISSING_ELEMENT_MESSAGE_PREFIX = '找不到页面元素 #';

/** 找不到挂载点时的报错文案前缀,后面直接拼 id */
export const MISSING_MOUNT_MESSAGE_PREFIX = '找不到挂载点 #';

/**
 * 组件依赖的全部元素 id(与 metro_window/index.html 一一对应).
 * 键名是用途,值必须与 HTML 里的 id 完全一致,不得改动.
 */
export const ELEMENT_IDS = {
    /** WebGPU 状态文字 <span> */
    status: 'status',
    /** WebGPU 渲染画布 <canvas> */
    canvas: 'webgpu-canvas',
    /** ▶ 播放按钮 */
    startButton: 'startBtn',
    /** ⏸ 暂停按钮 */
    pauseButton: 'pauseBtn',
    /** 🔄 重置按钮 */
    resetButton: 'resetBtn',
    /** 滑块面板 <fieldset>,加载完成后才启用 */
    paramPanel: 'paramPanel',
} as const;

/** 数字输入框 id = 滑块 id + 此后缀(如 vehicleSpeed -> vehicleSpeedNum) */
export const NUMBER_INPUT_ID_SUFFIX = 'Num';

/** 风格按钮上 data-* 的键名(读取 dataset.style,取值 0/1/2) */
export const STYLE_DATA_KEY = 'style';

/** data-style 缺失时回退的风格序号(0 = 泡沫时期东京电车) */
export const DEFAULT_STYLE_INDEX = 0;

// ---------- Rust 参数契约 ----------

/**
 * 滑块 <-> Rust 参数名的映射.param 必须与 metro_window/src/lib.rs 的
 * set_param 分支一致,写错不会报错,只会静默不生效,所以集中在这里便于对照.
 * id 必须与 index.html 里滑块的 id 一致.
 */
export const SLIDERS = [
    /** 车速(倍率) */
    { id: 'vehicleSpeed', param: 'vehicle_speed' },
    /** 远景距离(越大越慢) */
    { id: 'farDistance', param: 'far_distance' },
    /** 中景距离(越大越慢) */
    { id: 'midDistance', param: 'mid_distance' },
    /** 近景距离(越大越慢) */
    { id: 'nearDistance', param: 'near_distance' },
    /** 水滴大小(倍率) */
    { id: 'dropletSize', param: 'droplet_size' },
    /** 向后风(随车速) */
    { id: 'windBackward', param: 'wind_backward_factor' },
    /** 摇摆风(倍率) */
    { id: 'windSway', param: 'wind_sway_scale' },
    /** 下落速度(倍率) */
    { id: 'gravityScale', param: 'gravity_scale' },
    /** 折射强度(倍率) */
    { id: 'refractionScale', param: 'refraction_scale' },
    /** 玻璃污渍浓度 */
    { id: 'dirtOpacity', param: 'dirt_opacity' },
    /** 冷凝雾气浓度 */
    { id: 'fogOpacity', param: 'fog_opacity' },
    /** 车厢灯光强度 */
    { id: 'interiorOpacity', param: 'interior_opacity' },
] as const;

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
