/**
 * 418 茶壶交互: 拒绝计数器 / 晃动 / 蒸汽增强 / 表情与文案切换.
 * 图标由 shared/icon.ts 生成, 引用 418.html 内联 sprite 里的 <symbol>.
 * 全部可调常量(id / 选择器 / 时长 / 样式值 / 文案)见 teapot/config.ts.
 */
import { icon } from '@/4xx_page/shared/icon';
import {
    CLASS_WOBBLE,
    DOM_ID,
    EYE_LEFT_INDEX,
    FACE_RESTORE_MS,
    ICON_ID,
    ICON_STYLE,
    INITIAL_REJECT_COUNT,
    MESSAGE_COFFEE,
    MESSAGE_COFFEE_HOLD_MS,
    MESSAGE_COFFEE_SUB,
    MESSAGE_DOUBLE_CLICK,
    MESSAGE_TEA,
    MESSAGE_TEA_HOLD_MS,
    MESSAGE_WELCOME,
    MOUTH_ANGRY,
    MOUTH_REST,
    PANEL_FLASH_BG,
    PANEL_FLASH_MS,
    PANEL_FLASH_TRANSITION,
    PANEL_REST_BG,
    PUPIL_LOOK_AWAY,
    PUPIL_SQUINT_LEFT,
    PUPIL_SQUINT_RIGHT,
    PUPIL_TEA_HOLD_MS,
    REJECT_COUNT_STEP,
    SELECTOR,
    STEAM_ANIMATION_BOOST,
    STEAM_ANIMATION_NORMAL,
    STEAM_BOOST_MS,
    TEAS,
    TOAST_COFFEE_MESSAGE,
    TOAST_OPACITY_VISIBLE,
    TOAST_TEA_PREFIX,
    TOAST_TEA_SUFFIX,
    WELCOME_DELAY_MS,
    WOBBLE_MS,
} from './config';

// DOM 引用在模块加载时取一次: 脚本是 body 末尾的 type="module", 此时文档已解析完,
// 下面的事件处理函数复用这些引用, 不再重复查询.
const rejectSpan = document.getElementById(DOM_ID.rejectCount);
const toastDiv = document.getElementById(DOM_ID.actionToast);
const teapotEl = document.getElementById(DOM_ID.teapotMain);
const makeTeaBtn = document.getElementById(DOM_ID.makeTeaBtn);
const coffeeBtn = document.getElementById(DOM_ID.requestCoffeeBtn);
const pupils = document.querySelectorAll<HTMLElement>(SELECTOR.pupils);
const steamSpans = document.querySelectorAll<HTMLElement>(SELECTOR.steamSpans);

// 42 是计数器起始值(见 config.INITIAL_REJECT_COUNT).
let rejectCounter = INITIAL_REJECT_COUNT;

function updateCounterDisplay(): void {
    if (rejectSpan) rejectSpan.textContent = String(rejectCounter);
}

function setToastMessage(html: string): void {
    if (toastDiv) {
        toastDiv.innerHTML = html;
        toastDiv.style.opacity = TOAST_OPACITY_VISIBLE;
    }
}

// 图标一行,文案一行; 泡茶与拒绝咖啡两种临时提示共用同一套换行与缩进.
function setToastWithIcon(iconMarkup: string, text: string): void {
    setToastMessage(`
                ${iconMarkup}
                ${text}
            `);
}

function wobbleTeapot(): void {
    if (teapotEl) {
        teapotEl.classList.add(CLASS_WOBBLE);
        setTimeout(() => {
            teapotEl.classList.remove(CLASS_WOBBLE);
        }, WOBBLE_MS);
    }
}

function triggerSteamBoost(): void {
    steamSpans.forEach(span => {
        span.style.animation = 'none';
        // 先读一次布局属性强制重排, 否则重新赋值 animation 不会重启动画.
        void span.offsetHeight;
        span.style.animation = STEAM_ANIMATION_BOOST;
    });
    // 增强只持续 STEAM_BOOST_MS, 之后换回与 CSS 令牌一致的默认动画.
    setTimeout(() => {
        steamSpans.forEach(span => {
            span.style.animation = STEAM_ANIMATION_NORMAL;
        });
    }, STEAM_BOOST_MS);
}

// 清掉行内 transform, 让 CSS 里的默认瞳孔位置重新生效.
function resetPupils(): void {
    pupils.forEach(p => {
        p.style.transform = '';
    });
}

// 行内写嘴形, 字段与 config 里的 MOUTH_ANGRY / MOUTH_REST 一一对应.
type MouthStyle = {
    readonly borderBottom: string;
    readonly borderRadius: string;
    readonly height: string;
    readonly transform: string;
};

function applyMouthStyle(mouthEl: HTMLElement, style: MouthStyle): void {
    mouthEl.style.borderBottom = style.borderBottom;
    mouthEl.style.borderRadius = style.borderRadius;
    mouthEl.style.height = style.height;
    mouthEl.style.transform = style.transform;
}

// 临时替换 innerHTML, holdMs 之后再还原成替换前的内容.
function flashInnerHTML(el: HTMLElement, html: string, holdMs: number): void {
    const original = el.innerHTML;
    el.innerHTML = html;
    setTimeout(() => {
        el.innerHTML = original;
    }, holdMs);
}

function handleMakeTea(): void {
    wobbleTeapot();
    triggerSteamBoost();

    const randomTea = TEAS[Math.floor(Math.random() * TEAS.length)];

    setToastWithIcon(
        icon(ICON_ID.mugSaucer, ICON_STYLE.marginRight),
        `${TOAST_TEA_PREFIX}${randomTea}${TOAST_TEA_SUFFIX}`,
    );

    // 斜眼看茶: 瞳孔整体偏移, 稍后由 resetPupils() 归位.
    pupils.forEach(p => {
        p.style.transform = PUPIL_LOOK_AWAY;
    });
    setTimeout(resetPupils, PUPIL_TEA_HOLD_MS);

    const msgEl = document.querySelector<HTMLElement>(SELECTOR.message);
    if (msgEl) flashInnerHTML(msgEl, MESSAGE_TEA, MESSAGE_TEA_HOLD_MS);
}

function handleCoffeeRequest(): void {
    rejectCounter += REJECT_COUNT_STEP;
    updateCounterDisplay();

    wobbleTeapot();
    triggerSteamBoost();

    pupils.forEach((p, idx) => {
        if (idx === EYE_LEFT_INDEX) p.style.transform = PUPIL_SQUINT_LEFT;
        else p.style.transform = PUPIL_SQUINT_RIGHT;
    });

    const mouth = document.querySelector<HTMLElement>(SELECTOR.mouth);
    if (mouth) applyMouthStyle(mouth, MOUTH_ANGRY);

    setToastWithIcon(icon(ICON_ID.circleExclamation, ICON_STYLE.alert), TOAST_COFFEE_MESSAGE);

    // 只替换 .message 与 .sub-message 的文案, 大标题 .status-code 不参与.
    const msgEl = document.querySelector<HTMLElement>(SELECTOR.message);
    const subMsg = document.querySelector<HTMLElement>(SELECTOR.subMessage);
    if (msgEl) flashInnerHTML(msgEl, MESSAGE_COFFEE, MESSAGE_COFFEE_HOLD_MS);
    if (subMsg) flashInnerHTML(subMsg, MESSAGE_COFFEE_SUB, MESSAGE_COFFEE_HOLD_MS);

    setTimeout(() => {
        resetPupils();
        if (mouth) applyMouthStyle(mouth, MOUTH_REST);
    }, FACE_RESTORE_MS);

    const panel = document.querySelector<HTMLElement>(SELECTOR.counterPanel);
    if (panel) {
        panel.style.transition = PANEL_FLASH_TRANSITION;
        panel.style.background = PANEL_FLASH_BG;
        setTimeout(() => { panel.style.background = PANEL_REST_BG; }, PANEL_FLASH_MS);
    }
}

/**
 * 绑定按钮 / 双击 / 欢迎语的监听器, 并初始化一次计数显示.
 * 入口(418/index.ts)调用一次即可; 模块顶部的 DOM 查询发生在 import 时, 所以本模块并非零副作用.
 */
export function mountTeapot(): void {
    if (makeTeaBtn) {
        makeTeaBtn.addEventListener('click', handleMakeTea);
    }
    if (coffeeBtn) {
        coffeeBtn.addEventListener('click', handleCoffeeRequest);
    }

    // 彩蛋: 双击茶壶也弹一条吐槽.
    if (teapotEl) {
        teapotEl.addEventListener('dblclick', function () {
            setToastMessage(`${icon(ICON_ID.faceSmileWink)} ${MESSAGE_DOUBLE_CLICK}`);
            wobbleTeapot();
        });
    }

    updateCounterDisplay();

    window.addEventListener('load', () => {
        setTimeout(() => {
            setToastMessage(`${icon(ICON_ID.handPeace)} ${MESSAGE_WELCOME}`);
        }, WELCOME_DELAY_MS);
    });
}
