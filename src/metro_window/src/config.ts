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
 * "裸宿主"修饰类:去掉车窗面板的内边距与底色,只留组件内容.
 * 首屏(hero)里的两个宿主都用它 -- 舞台要自己铺满整屏,风格按钮要跟时钟并排,
 * 都不是"卡片里嵌一个车窗面板"那种形态,多一层内边距就是多一层看不出源头的留白.
 */
export const BARE_MODIFIER_CLASS = 'metro-window--bare';

/**
 * 舞台宿主的修饰类:在"裸宿主"的基础上再**铺满父层**(absolute + inset: 0).
 * 画布随后用 object-fit: cover 覆盖这一层 -- 首屏要的就是这个.
 * 因此带这个类的舞台,其宿主必须是**定位祖先**(站点的 .hero__stage 是).
 * 画布的显示尺寸与裁切都由 metro_window.css 里这条修饰类的规则决定.
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
 * 组件拆成"舞台"与"控制台"两块以后,站点给了四个宿主:
 *   - stage:WebGPU 画布,放在首屏(要铺满整屏);
 *   - styles:三颗风格按钮,放在首屏底部(与 LED 时钟同排) -- 切风格是"看"的一部分,
 *     不该跟滑块一起埋在 SETTING 里;
 *   - panel:其余整套设置面板(播放控制 / 滑块 / 状态区),放在 SETTING 标签页;
 *   - uploads:图层贴图上传面板,放在 SETTING 标签页里**紧接 panel 的下方** --
 *     它和"调参"是两件事(一个改渲染参数,一个换素材),所以各自一个宿主 / 一块
 *     fieldset,不合并进设置面板.
 * 与下面的 ELEMENT_IDS 区别要分清:这里是**宿主必须提供**的,
 * ELEMENT_IDS 是**组件自己生成**的.
 */
export const MOUNT_IDS = {
    /** 舞台(画布)空宿主 */
    stage: 'metro-window',
    /** 风格按钮空宿主(首屏底部) */
    styles: 'metro-styles',
    /** 控制台(设置面板)空宿主 */
    panel: 'metro-params',
    /** 图层贴图上传面板空宿主(设置面板正下方) */
    uploads: 'metro-uploads',
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
 * 画布由 ui/stage_content.ts 生成,不再是页面 HTML.
 *
 * 原因:宿主只提供空容器,画布尺寸集中在这里定义一次 -- 宿主页不重复任何标记.
 *
 * 注意与上面的区别:上面是"宿主必须提供的 id",这里是"组件自己生成的内容".
 *
 * 这里曾经还有一套"组件生成标题 / 副标题"的开关(STAGE_COPY_ENABLED=false)
 * 连同 WINDOW_TITLE / WINDOW_SUBTITLE / SUBTITLE_CLASS 与 metro_window.css 的
 * `h1`/`.subtitle` 规则,以及只为 h1 服务的 `--metro-font-size-title`.开关一直
 * 是关的,四处都没有消费者,已整体删除.若将来要把文案交回组件,再重新引入,
 * 不要只恢复其中一半(只留常量没规则,或只留规则没生成代码,都是死重量).
 */

/**
 * 画布的渲染分辨率(宽度,像素).Rust 侧直接读 canvas.width/height 建 surface,
 * 所以这个值是**后备缓冲尺寸**(画多大),显示多大由 metro_window.css 控制.
 */
export const CANVAS_WIDTH = 1344;

/** 画布的渲染分辨率(高度,像素),与 CANVAS_WIDTH 同为 16:9 */
export const CANVAS_HEIGHT = 756;

// ---------- 后备缓冲尺寸(首屏舞台随视口变化) ----------

/*
 * 画布的后备缓冲尺寸不再是固定值:站点首屏要铺满整个视口,而画布宽高比必须
 * **恒为 16:9** -- 城市四层是按 uv 直接铺满画布的(见 shaders.wgsl),比例一变
 * 整幅场景就被拉伸.所以后备缓冲按"覆盖宿主所需的 16:9 尺寸"算(见 stage_size.ts),
 * 覆盖多出来的部分交给 CSS 的 object-fit: cover.
 */

/**
 * 设备像素比上限.后备缓冲像素数 = 视口 CSS 尺寸 × dpr × (覆盖倍数),
 * dpr 再高只是徒增 GPU 负载(4K 屏 + dpr2 = 8K 宽,肉眼分辨不出).
 */
export const MAX_DEVICE_PIXEL_RATIO = 2;

/**
 * 后备缓冲的像素总数上限,0 = 不设上限.
 * 先按最佳质量跑(1:1 物理像素),要降代价时把这里改成正数即可:
 * 超过上限会按 sqrt(上限 / 实际) 等比缩小两个方向,画面略软但帧率稳住.
 */
export const MAX_BACKING_PIXELS = 0;

/**
 * 视口尺寸变化后等多久才真正重建后备缓冲(毫秒).
 * 拖动窗口会连续触发 ResizeObserver,而每次重建都要重新分配画布后备缓冲
 * 与 Rust 侧的 surface,不防抖就是每帧一次重分配.
 */
export const RESIZE_DEBOUNCE_MS = 150;

/** 设备像素比下限:有些环境会报出小于 1 的值,按 1 处理(小于 1 等于故意糊画面) */
export const MIN_DEVICE_PIXEL_RATIO = 1;

/** 后备缓冲边长的下限(像素):0 会让 GPU 侧的 surface 配置非法 */
export const MIN_BACKING_DIMENSION = 1;

// ---------- 首屏"不可用"状态 ----------

/**
 * 舞台宿主上 `data-*` 的键名:值为 STAGE_STATE_UNAVAILABLE 时,
 * 样式(metro_window.css)会藏掉画布,放出那句短提示.
 * 与 CSS 的属性选择器是跨语言契约,改这里必须同步改样式.
 */
export const STAGE_STATE_DATA_KEY = 'state';

/** 舞台状态值:WebGPU 这条路走不通(没有 API / 没有适配器 / 只有软件渲染 / 初始化失败) */
export const STAGE_STATE_UNAVAILABLE = 'unavailable';

/** 不可用时组件加到舞台上的短提示的类名 */
export const STAGE_NOTE_CLASS = 'stage-note';

/**
 * 不可用时首屏上那句短提示.
 * 长帮助(四步启用步骤)仍然只进 SETTING 标签页的状态区 -- 首屏是欢迎页,
 * 不该被一段开发向的排错说明占满.
 */
export const STAGE_NOTE_UNAVAILABLE =
    '实时车窗需要 WebGPU,当前浏览器/设备不可用;完整排查步骤见 SETTING 标签页.';

/**
 * 风格按钮"选中"态的类名,由 JS 切换.
 * 基础样式走 `.metro-window button`(见 metro_window.css),所以没有基础类名;
 * 这里只有"选中"这一个可切换状态.
 */
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
    'Layer 0 窗外实景(城市四层视差) · Layer 1 玻璃污渍 · ' +
    'Layer 2 冷凝雾气 · Layer 3 车厢灯光与倒影';

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

// ---------- 图层贴图上传 ----------

/*
 * 上传面板只做三件事:选文件 / 把文件解码成 RGBA8 像素 / 调 wasm 的
 * setLayerImage 换掉某个材质槽位的贴图.真正的"换图"发生在 wasm 里 --
 * 那些纹理是 wgpu 的 GPU 资源,JS 没有别的途径写进去.
 *
 * **没有后端**:文件不上传服务器,只在浏览器内存里转成像素喂给 wasm;
 * 刷新页面即恢复站点自带素材(要持久化得另说,不在这块范围内).
 *
 * 槽位号 / 名字必须与 Rust 的 src/app_params.rs 的 UPLOADABLE_LAYERS 一致
 * (跨语言契约,两侧各有单测).当前只放开城市背景那四层:它们的原图是
 * public/metro_window/resource/ 下按层分开交付的 PNG(level_0.png 最近 ..
 * level_3.png 最远),一层一个文件;效果贴图(污渍 / 雾气 / 车厢)是程序化
 * 生成的,不在这一批里.
 */

/** 一个可上传替换的图层(生成一行"层名 + 选文件 + 恢复默认") */
export interface UploadLayerSpec {
    /** 材质槽位号(wasm 侧 material_views 下标),必须与 Rust 名单一致 */
    readonly slot: number;
    /** 槽位名,与 Rust 的 UPLOADABLE_LAYERS 逐字一致;同时用来拼输入框 id */
    readonly name: string;
    /** 界面上的层名 */
    readonly label: string;
    /** 层名后的小字说明(可选),为空不渲染 */
    readonly hint?: string;
    /** 站点自带素材的文件名(public/metro_window/resource/ 下),仅用于提示 */
    readonly file: string;
}

/**
 * 可上传的四层,顺序即界面顺序(由远到近).
 * slot 与前四项材质槽位(bg / far / mid / near)一一对应:
 * 换掉其中一层不影响另外三层,视差滚动照旧.
 *
 * 槽位名用 `level_N`,N 是"由近到远"的距离编号,也就是 PNG 文件名的编号:
 * level_0 最近(滚动最快),level_3 最远(背景,不滚动).因此名字里的 N 与
 * slot 号是反着的 -- slot 跟的是材质表顺序,名字跟的是距离.
 */
export const UPLOAD_LAYERS = [
    { slot: 0, name: 'level_3', label: '城市背景', hint: '最远一层,不滚动', file: 'level_3.png' },
    { slot: 1, name: 'level_2', label: '城市远景', hint: '滚动最慢', file: 'level_2.png' },
    { slot: 2, name: 'level_1', label: '城市中景', hint: '滚动中等', file: 'level_1.png' },
    { slot: 3, name: 'level_0', label: '城市近景', hint: '滚动最快', file: 'level_0.png' },
] as const satisfies readonly UploadLayerSpec[];

/** 上传面板 <legend> 文案 */
export const UPLOAD_LEGEND = '🖼 图层贴图';

/**
 * 上传面板顶部的一句话说明.
 * 重点说清两件用户会踩的事:改动只在本会话生效(刷新即还原),
 * 以及 alpha 的含义(城市层是 alpha 混合,不透明的图会把下层整片盖住).
 */
export const UPLOAD_NOTE =
    '上传后立即替换该层贴图,只改内存里的纹理,不写文件,刷新页面恢复自带素材;' +
    '请用带透明通道的 PNG:alpha 决定下层是否透出.';

/**
 * 只收 PNG:四张原素材都是 PNG,画师也按层分开交付.
 * 顺带挡掉没有 alpha 通道的格式(JPEG 换上去会把下面几层全盖住).
 * 注意 accept 只是文件选择框的过滤器,真正的判断还是按 MIME 再查一次.
 */
export const UPLOAD_ACCEPT = 'image/png';

/** 允许的 MIME 类型(与 UPLOAD_ACCEPT 对应) */
export const UPLOAD_MIME_TYPE = 'image/png';

/** 顶层素材文件名前的目录提示(拼在小字里,告诉用户换的是哪个文件) */
export const UPLOAD_FILE_HINT_PREFIX = '默认 ';

/** 上传输入框 id 前缀:`<label for>` 与 `<input id>` 都靠它拼(前缀 + 槽位名) */
export const UPLOAD_INPUT_ID_PREFIX = 'upload-';

/** 上传面板 <fieldset> 的 id(便于调试/自动化定位) */
export const UPLOADS_PANEL_ID = 'uploadPanel';

/** "恢复默认"按钮文案 */
export const UPLOAD_RESET_LABEL = '恢复默认';

/** 每层状态:还没上传,用的是自带素材 */
export const UPLOAD_STATUS_DEFAULT = '默认素材';

/** 每层状态:正在解码图片 */
export const UPLOAD_STATUS_DECODING = '解码中...';

/** 每层状态:选了非 PNG 文件 */
export const UPLOAD_STATUS_NOT_PNG = '只支持 PNG(自带素材是带透明通道的 PNG)';

/** 每层状态:图片边长超上限,带上尺寸插值 */
export const buildUploadStatusTooLarge = (width: number, height: number): string =>
    `图片过大(${width}×${height}),单边上限 ${MAX_UPLOAD_DIMENSION}px`;

/** 每层状态:替换成功,带上最终尺寸插值 */
export const buildUploadStatusApplied = (width: number, height: number): string =>
    `已应用 ${width}×${height}`;

/**
 * 图片边长上限(像素).
 * 与 Rust 的 src/render_params.rs 的 MAX_TEXTURE_DIMENSION 是同一个值:
 * 前端先筛一遍给出可读的报错,Rust 侧再挡一次(导出函数是公开 API).
 */
export const MAX_UPLOAD_DIMENSION = 8192;

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
