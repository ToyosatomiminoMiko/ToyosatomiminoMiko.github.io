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

/**
 * 画布宽高比的 CSS 自定义属性名.
 *
 * 宽高比只有**一个来源**:上面的 `CANVAS_WIDTH / CANVAS_HEIGHT`
 * (`stage_size.ts` 按同一个比例算后备缓冲).挂载时把它写到舞台宿主上,
 * CSS 的 `aspect-ratio` 取同一个值;tokens.css 里那份只是"JS 还没挂载 /
 * 纯 CSS 场景"的兜底,不再是与 TS 并列的第二份事实.
 */
export const CANVAS_ASPECT_PROPERTY = '--metro-size-canvas-aspect';

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

/**
 * data-style 缺失时回退的风格序号,也是初始选中项与**启动风格**:
 * 1 = 赛博朋克(见 STYLE_PRESETS).
 *
 * 这是默认风格的**唯一来源**:挂载时它被初始点亮的那颗按钮使用,同时作为
 * `startApp(canvas, status, style)` 的第三个参数传进 wasm(越界会被 wasm 夹到
 * `MAX_STYLE_INDEX`).wasm 侧不再另存一份默认值,所以改这里就够了.
 */
export const DEFAULT_STYLE_INDEX = 1;

// ---------- 设置面板的声明式模型 ----------

/** 设置面板 <legend> 文案 */
export const PANEL_LEGEND = '实时参数';

/** 状态区"WebGPU 状态:"标签文案 */
export const STATUS_LABEL = 'WebGPU 状态:';

/** 状态区初始文案(wasm 加载前) */
export const STATUS_INITIAL = '初始化中...';

/** 状态区下方图层说明文案 */
export const LAYERS_NOTE =
    'Layer 0 窗外实景(城市四层视差) / Layer 1 玻璃污渍 / ' +
    'Layer 2 冷凝雾气 / Layer 3 车厢灯光与倒影';

/**
 * 单个滑块声明里 `width` 覆盖用的 CSS 自定义属性名.
 *
 * 滑块本身(名称 + 滑杆 + 数值框 + 重置按钮)由 UI 库的 `createSlider` 生成,
 * 布局与宽度口径都在库的样式表(`@miko/ui/styles/widgets.css` 的
 * `.slider-field`)里;只有声明里确实写了 `width` 时,组件才把这条属性设在
 * 该滑块根节点上覆盖库的默认宽度.统一加 `--metro-` 前缀,避免和 bootstrap /
 * 站点变量撞名.
 */
export const SLIDER_WIDTH_PROPERTY = '--slider-field-width';

/**
 * 单个实时滑块的声明式描述:既是标记(范围 / 初始值),
 * 也是行为(param 名 / clamp 区间)的唯一来源.
 *
 * 只有 `param` 是逐字跨语言的契约(Rust 的 SLIDERS 用同一批名字);
 * 区间与初始值都以前端这份为准,Rust 侧的 `GlassParams::DEFAULT` 只是
 * "JS 推入之前的占位值"(详见下面 `value` 一条).
 *
 * id       -- 本声明的稳定标识,单测用它断言"没有重复的滑块";
 *             DOM 里 `<input type="range">` 的 id 由库生成(库的滑块不暴露 id,
 *             `<label for>` 的关联在库内部接好),它不再进标记;
 * param    -- setParam 参数名,必须与 src/metro_window/rust/src/app_params.rs 的 SLIDERS 一致;
 * label    -- 名称(数值框左侧,同时是重置按钮可访问名的来源);
 * hint     -- 名称后的小字注释(可选),为空不渲染;
 * min/max  -- 前端可调区间(与 Rust 侧 clamp 区间各自独立,前端先夹一次);
 * step     -- 步长(数值框的箭头粒度与滑杆的吸附粒度);
 * value    -- 初始值:同时是滑杆的起始位置,重置按钮的目标值与**启动时推给
 *             wasm 的渲染参数**(挂载函数在 startApp 之后补推一次,见
 *             metro_window.ts 的 pushSliderValues;改这里不需要再动 Rust);
 * width    -- 单个滑块的宽度(CSS 长度,可选),留空用库的默认宽度.
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
     * 留空 => 库的默认宽度(`.slider-field` 里的 --slider-field-width);
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
            { id: 'vehicleSpeed', param: 'vehicle_speed', label: '车速', hint: '倍率', min: 0, max: 3, step: 0.01, value: 3 },
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
            { id: 'interiorOpacity', param: 'interior_opacity', label: '车厢灯光', min: 0, max: 1, step: 0.01, value: 1 },
        ],
    },
] as const satisfies readonly SliderGroupSpec[];

/** 一种可切换的渲染风格(生成一颗 data-style 按钮) */
export interface StylePresetSpec {
    /** 传给 setStyle 的风格编号,必须与 Rust 的 MAX_STYLE_INDEX 区间一致 */
    readonly index: number;
    readonly label: string;
}

/**
 * 三颗风格按钮,顺序即界面顺序.
 * 其中 `{ index: 1, label: '赛博朋克' }` 是默认风格(见 DEFAULT_STYLE_INDEX).
 */
export const STYLE_PRESETS = [
    { index: 0, label: '东京电车' },
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
 * 这里(而不是 Rust)是图层清单的**唯一来源**:槽位号 / 名字 / 文件名 / 是否
 * 不透明都由这份声明决定,挂载时随 [`RUNTIME_CONFIG`] 传给 wasm;Rust 只校验
 * "声明了几层"是否与着色器实现一致(见 rust/src/boot_config.rs).
 * 当前只放开城市背景那四层:它们的原图是 public/metro_window/resource/ 下
 * 按层分开交付的 PNG(level_0.png 最近 .. level_3.png 最远),一层一个文件;
 * 效果贴图(污渍 / 雾气 / 车厢)是程序化生成的,不在这一批里.
 */

/** 一个可上传替换的图层(生成一行"层名 + 选文件 + 恢复默认") */
export interface UploadLayerSpec {
    /** 材质槽位号(wasm 侧 material_views 下标),必须等于它在清单里的位置 */
    readonly slot: number;
    /** 槽位名:随配置传给 wasm,用于报错文案与契约对照;同时用来拼输入框 id */
    readonly name: string;
    /** 界面上的层名 */
    readonly label: string;
    /** 层名后的小字说明(可选),为空不渲染 */
    readonly hint?: string;
    /** 站点自带素材的文件名(public/metro_window/resource/ 下) */
    readonly file: string;
    /**
     * 原图 alpha 是否恒为不透明.true => wasm 侧不预乘 alpha.
     *
     * 这是**素材属性**:最底层是全屏实景(alpha 恒为 255),预乘不预乘都一样;
     * 而带透明通道的层必须预乘,否则建筑轮廓外会渗出黑边
     * (透明处是 (0,0,0),合成式 `c = c*(1-a) + rgb` 会把它当"黑色")--
     * 理由见 rust/src/textures.rs 的 premultiply_alpha.
     */
    readonly opaque: boolean;
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
    { slot: 0, name: 'level_3', label: '城市背景', hint: '最远一层,不滚动', file: 'level_3.png', opaque: true },
    { slot: 1, name: 'level_2', label: '城市远景', hint: '滚动最慢', file: 'level_2.png', opaque: false },
    { slot: 2, name: 'level_1', label: '城市中景', hint: '滚动中等', file: 'level_1.png', opaque: false },
    { slot: 3, name: 'level_0', label: '城市近景', hint: '滚动最快', file: 'level_0.png', opaque: false },
] as const satisfies readonly UploadLayerSpec[];

/**
 * 城市贴图在站点里的公开路径前缀(不带结尾斜杠).
 *
 * 这四张 PNG 由 wasm 在运行时自己 fetch(不进 wasm 包,也拿不到 Vite 带 hash
 * 的地址),所以地址必须是构建后真实可访问的绝对路径;文件放在站点唯一的静态
 * 资源根 `public/metro_window/resource/` 下,Vite 把 `public/` 按原路径挂载
 * (dev)/拷贝(build),URL 与目录层级一致,不需要重写插件.
 *
 * 用绝对路径而不是相对路径:相对路径会随页面 URL 变化(例如
 * /4xx_page/404.html 这类回退地址),fetch 会拿到 HTML 回退页而不是 PNG,
 * 报 Invalid PNG signature.
 */
export const RESOURCE_BASE = '/metro_window/resource';

/** 上传面板 <legend> 文案 */
export const UPLOAD_LEGEND = '图层贴图';

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
    `图片过大(${width}x${height}),单边上限 ${MAX_UPLOAD_DIMENSION}px`;

/** 每层状态:替换成功,带上最终尺寸插值 */
export const buildUploadStatusApplied = (width: number, height: number): string =>
    `已应用 ${width}x${height}`;

/**
 * 图片边长上限(像素),**策略值**.
 *
 * 前端先筛一遍给出可读报错;wasm 侧还会与设备真实能力
 * (`device.limits().max_texture_dimension_2d`)取小后再挡一次 -- 设备能力是
 * 硬件事实,不从 TS 传,所以这里允许比设备上限大.
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
    /** 文件选择框确认(document 级上传面板:选文件后浏览器发 change) */
    change: 'change',
    /** 按钮点击 */
    click: 'click',
} as const;

// ---------- 索引 / 解析 ----------

/** 取 IntersectionObserver 回调里最新一条记录时的倒数偏移(entries.length - 1) */
export const LAST_ENTRY_OFFSET = 1;

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

// ---------- 传给 wasm 的启动配置 ----------

/*
 * "TS 是唯一数据来源,Rust 只做调用方":凡是产品 / 资源 / 界面能决定的值
 * (有几种风格,有哪几层贴图,贴图文件叫什么,资源挂在哪个 URL,上传允许多大,
 * 每个滑块的区间)都只写在本文件里,挂载时作为 `startApp(canvas, status, config)`
 * 的第三个参数**一次性**传给 wasm.下面的类型就是那份配置的形状,Rust 侧
 * `boot_config.rs` 的 `BootConfig::from_js` 按同名键读取并校验:
 *
 *   - 名字对不上 / 类型不对 / 层数与着色器实现不一致 -> 启动就报错,不静默降级;
 *   - Rust 侧不再各自存一份默认值或清单,也就没有"改了一边忘了另一边"的错配.
 *
 * 留在 Rust 的是两类**非配置**的值:着色器/管线的实现能力(实现了几个风格分支,
 * 几种材质槽位),以及渲染内部调参(帧率,噪声频率,贴图尺寸).设备能力
 * (如 maxTextureDimension2D)也不从 TS 传,它是硬件事实.
 */

/** 传给 wasm 的图层声明(字段名与 Rust 的 `LayerConfig` 一一对应) */
export interface RuntimeLayerSpec {
    readonly slot: number;
    readonly name: string;
    readonly file: string;
    readonly opaque: boolean;
}

/** 传给 wasm 的滑块声明(字段名与 Rust 的 `ParamRange` 一一对应) */
export interface RuntimeParamSpec {
    readonly name: string;
    readonly min: number;
    readonly max: number;
}

/** 启动配置整体形状(Rust 按这些键名读取,改名要两边同时改) */
export interface RuntimeConfig {
    /** 初始风格编号 */
    readonly styleIndex: number;
    /** 可选风格数量(上限由它推导) */
    readonly styleCount: number;
    /** 城市贴图的公开路径前缀 */
    readonly resourceBase: string;
    /** 上传图片的边长上限(策略值;wasm 会再与设备能力取小) */
    readonly uploadMaxDimension: number;
    readonly layers: readonly RuntimeLayerSpec[];
    readonly params: readonly RuntimeParamSpec[];
}

/**
 * 从上面的声明**派生**出来的启动配置(不要在别处手写第二份).
 * 只做字段改名/投影,不含任何新的数值.
 */
export const RUNTIME_CONFIG: RuntimeConfig = {
    styleIndex: DEFAULT_STYLE_INDEX,
    styleCount: STYLE_PRESETS.length,
    resourceBase: RESOURCE_BASE,
    uploadMaxDimension: MAX_UPLOAD_DIMENSION,
    layers: UPLOAD_LAYERS.map((layer) => ({
        slot: layer.slot,
        name: layer.name,
        file: layer.file,
        opaque: layer.opaque,
    })),
    // 分组是各自的元组类型,这里按统一的 SliderGroupSpec 收口后再投影.
    params: SLIDER_GROUPS.flatMap((group: SliderGroupSpec) => group.sliders).map((slider) => ({
        name: slider.param,
        min: slider.min,
        max: slider.max,
    })),
};
