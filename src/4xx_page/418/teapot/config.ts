/**
 * 418 茶壶交互(teapot.ts)的可调常量.
 *
 * 抽出的是: DOM id / 选择器 / 类名 / sprite 图标 id 与内联样式 /
 * 各类时长(ms) / 表情与面板的临时样式值 / 幽默文案.
 * 这些值原样搬自 418.html 内联脚本, 改变它们会改变交互表现, 不是纯重构.
 */

/** 交互涉及的 DOM id(必须与 418.html 一致, 不要改) */
export const DOM_ID = {
    /** 拒绝计数器 <span> */
    rejectCount: 'rejectCount',
    /** 临时消息条 */
    actionToast: 'actionToast',
    /** 茶壶主体(晃动用) */
    teapotMain: 'teapotMain',
    /** "泡茶"按钮 */
    makeTeaBtn: 'makeTeaBtn',
    /** "强行煮咖啡"按钮 */
    requestCoffeeBtn: 'requestCoffeeBtn',
} as const;

/** querySelector 选择器 */
export const SELECTOR = {
    /** 蒸汽柱(逐个重启动画) */
    steamSpans: '.steam span',
    /** 瞳孔 */
    pupils: '.pupil',
    /** 主消息区 */
    message: '.message',
    /** 副消息区 */
    subMessage: '.sub-message',
    /** 嘴巴 */
    mouth: '.mouth',
    /** 计数面板 */
    counterPanel: '.counter-panel',
} as const;

/** 晃动时临时挂上的类名(动画见 418.css 的 .teapot.wobble) */
export const CLASS_WOBBLE = 'wobble';

/** sprite 图标 id(定义在 418.html 的 <symbol>) */
export const ICON_ID = {
    /** 茶杯 */
    mugSaucer: 'i-mug-saucer',
    /** 圆圈感叹号 */
    circleExclamation: 'i-circle-exclamation',
    /** 眨眼笑脸 */
    faceSmileWink: 'i-face-smile-wink',
    /** 和平手势 */
    handPeace: 'i-hand-peace',
} as const;

/** 图标内联样式片段 */
export const ICON_STYLE = {
    /** 与紧跟文字留出间距 */
    marginRight: 'margin-right:6px;',
    /** 警示红 */
    alert: 'color:#b34e4e;',
} as const;

/** 初始拒绝次数(经典 42 梗) */
export const INITIAL_REJECT_COUNT = 42;

/** 每按一次"强行煮咖啡"计数器增加多少 */
export const REJECT_COUNT_STEP = 1;

/** toast 可见时的不透明度 */
export const TOAST_OPACITY_VISIBLE = '1';

/** 茶壶晃动动画时长(ms) */
export const WOBBLE_MS = 400;

/** 蒸汽增强后恢复默认时长的延迟(ms) */
export const STEAM_BOOST_MS = 2000;

/** 泡茶时"斜眼看茶"的瞳孔位移保持时间(ms) */
export const PUPIL_TEA_HOLD_MS = 600;

/** 泡茶时傲娇文案的保持时间(ms) */
export const MESSAGE_TEA_HOLD_MS = 2000;

/** 拒绝咖啡时主/副消息的保持时间(ms) */
export const MESSAGE_COFFEE_HOLD_MS = 2800;

/** 拒绝咖啡后表情恢复的延迟(ms) */
export const FACE_RESTORE_MS = 800;

/** 计数面板闪一下的保持时间(ms) */
export const PANEL_FLASH_MS = 200;

/** 页面加载完成后欢迎语的延迟(ms) */
export const WELCOME_DELAY_MS = 300;

/** 左眼在 .pupil NodeList 里的下标(0 = 左, 1 = 右) */
export const EYE_LEFT_INDEX = 0;

/** 蒸汽增强时的动画(更快) */
export const STEAM_ANIMATION_BOOST = 'steamFloat 1.8s infinite ease-in-out';

/** 蒸汽默认动画(与 418.css 里 .steam span 的 animation 一致) */
export const STEAM_ANIMATION_NORMAL = 'steamFloat 2.5s infinite ease-in-out';

/** 泡茶: 瞳孔斜眼看茶 */
export const PUPIL_LOOK_AWAY = 'translateX(2px) translateY(-1px)';

/** 拒绝咖啡: 左眼向内 */
export const PUPIL_SQUINT_LEFT = 'translateX(-3px)';

/** 拒绝咖啡: 右眼向内 */
export const PUPIL_SQUINT_RIGHT = 'translateX(3px)';

/** 生气表情: 倒 U 嘴 */
export const MOUTH_ANGRY = {
    borderBottom: '5px solid #8b3a1a',
    borderRadius: '30% 30% 0 0',
    height: '12px',
    transform: 'translateX(-50%) rotate(2deg)',
} as const;

/** 恢复默认: 不屑嘴(与 418.css 的 .mouth 一致) */
export const MOUTH_REST = {
    borderBottom: '5px solid #6b3e1e',
    borderRadius: '0 0 30% 30%',
    height: '16px',
    transform: 'translateX(-50%)',
} as const;

/** 计数面板闪烁的过渡时长 */
export const PANEL_FLASH_TRANSITION = '0.2s';

/** 计数面板闪烁时的背景色 */
export const PANEL_FLASH_BG = '#f0cdb0';

/** 计数面板恢复后的背景色(与 418.css 的 .counter-panel 一致) */
export const PANEL_REST_BG = '#eedbcb';

/** 可选茶叶(随机抽一种) */
export const TEAS: readonly string[] = ['大吉岭', '伯爵茶', '乌龙茶', '薄荷茶', '洋甘菊', '普洱'];

/** 泡茶 toast: 茶名之前的部分 */
export const TOAST_TEA_PREFIX = '正在为您冲泡 ';

/** 泡茶 toast: 茶名之后的部分 */
export const TOAST_TEA_SUFFIX = ' ...  🍵 好香!茶壶露出了欣慰的表情.';

/** 拒绝咖啡 toast 正文(图标之后) */
export const TOAST_COFFEE_MESSAGE = "<strong>418 I'm a teapot</strong> -- 拒绝冲煮咖啡.茶壶甚至翻了个白眼.";

/** 泡茶时替换主消息区的傲娇文案 */
export const MESSAGE_TEA = '🫖 茶壶:"这才是正确的打开方式."';

/** 拒绝咖啡时替换主消息区的文案 */
export const MESSAGE_COFFEE = '😤 茶壶:"我说了我是茶壶!再问就滋你一脸红茶!"';

/** 拒绝咖啡时替换副消息区的文案 */
export const MESSAGE_COFFEE_SUB = '⚠️ HTCPCP 错误: 实体是茶壶,无法处理咖啡请求.';

/** 页面加载完成后的欢迎语 */
export const MESSAGE_WELCOME = '欢迎!本茶壶今日心情:拒绝咖啡,从我做起.';

/** 双击茶壶的吐槽 */
export const MESSAGE_DOUBLE_CLICK = '茶壶小声嘀咕:"别戳了,再戳我就...... 还是只会泡茶."';
