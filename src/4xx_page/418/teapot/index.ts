/**
 * 418 · 我是个茶壶 -- 交互逻辑
 * 从 418.html 内联脚本拆出,保持原有行为不变.
 * 图标不再是 Font Awesome 字体,而是 418.html 里 sprite 中的 <symbol>.
 * 全部可调常量(id / 选择器 / 时长 / 样式值 / 文案)见 teapot.config.ts.
 */
import { icon } from '../shared/icon';
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
} from './teapot.config';

// 幽默元素:拒绝计数器 (一开始显示42,之后每次按"强行煮咖啡"增加)
const rejectSpan = document.getElementById(DOM_ID.rejectCount);
const toastDiv = document.getElementById(DOM_ID.actionToast);
const teapotEl = document.getElementById(DOM_ID.teapotMain);
const makeTeaBtn = document.getElementById(DOM_ID.makeTeaBtn);
const coffeeBtn = document.getElementById(DOM_ID.requestCoffeeBtn);

let rejectCounter = INITIAL_REJECT_COUNT;  // 经典梗

// 更新计数显示
function updateCounterDisplay(): void {
    if (rejectSpan) rejectSpan.textContent = String(rejectCounter);
}

// 显示临时消息 (幽默反馈)
function setToastMessage(html: string): void {
    if (toastDiv) {
        toastDiv.innerHTML = html;
        toastDiv.style.opacity = TOAST_OPACITY_VISIBLE;
        // 可以加个小动画,不需要额外处理
    }
}

// 让茶壶晃动 (表示不满/开心)
function wobbleTeapot(): void {
    if (teapotEl) {
        teapotEl.classList.add(CLASS_WOBBLE);
        setTimeout(() => {
            teapotEl.classList.remove(CLASS_WOBBLE);
        }, WOBBLE_MS);
    }
}

// 显示蒸汽效果增强 (已存在,但可以临时增强)
function triggerSteamBoost(): void {
    const steamSpans = document.querySelectorAll<HTMLElement>(SELECTOR.steamSpans);
    steamSpans.forEach(span => {
        span.style.animation = 'none';
        void span.offsetHeight; // 重绘
        span.style.animation = STEAM_ANIMATION_BOOST;
    });
    // STEAM_BOOST_MS 后恢复默认时长(见 teapot.config.ts)
    setTimeout(() => {
        steamSpans.forEach(span => {
            span.style.animation = STEAM_ANIMATION_NORMAL;
        });
    }, STEAM_BOOST_MS);
}

// 泡茶 -- 优雅且幽默
function handleMakeTea(): void {
    wobbleTeapot();
    triggerSteamBoost();

    const randomTea = TEAS[Math.floor(Math.random() * TEAS.length)];

    setToastMessage(`
                ${icon(ICON_ID.mugSaucer, ICON_STYLE.marginRight)}
                ${TOAST_TEA_PREFIX}${randomTea}${TOAST_TEA_SUFFIX}
            `);

    // 改变瞳孔位置 (斜眼看茶)
    const pupils = document.querySelectorAll<HTMLElement>(SELECTOR.pupils);
    pupils.forEach(p => {
        p.style.transform = PUPIL_LOOK_AWAY;
    });
    setTimeout(() => {
        pupils.forEach(p => p.style.transform = '');
    }, PUPIL_TEA_HOLD_MS);

    // 同时加一点傲娇文案
    const msgEl = document.querySelector<HTMLElement>(SELECTOR.message);
    if (msgEl) {
        const originalMsg = msgEl.innerHTML;
        msgEl.innerHTML = MESSAGE_TEA;
        setTimeout(() => {
            msgEl.innerHTML = originalMsg;
        }, MESSAGE_TEA_HOLD_MS);
    }
}

// 强行煮咖啡 -- 触发418幽默错误
function handleCoffeeRequest(): void {
    // 增加拒绝计数
    rejectCounter += REJECT_COUNT_STEP;
    updateCounterDisplay();

    // 猛烈晃动 (表示抗议)
    wobbleTeapot();
    // 蒸汽愤怒冒出
    triggerSteamBoost();

    // 瞳孔变成愤怒/鄙视 (斗鸡眼/不屑)
    const pupils = document.querySelectorAll<HTMLElement>(SELECTOR.pupils);
    pupils.forEach((p, idx) => {
        if (idx === EYE_LEFT_INDEX) p.style.transform = PUPIL_SQUINT_LEFT;
        else p.style.transform = PUPIL_SQUINT_RIGHT;
    });

    // 改变嘴巴成倒U (不屑)
    const mouth = document.querySelector<HTMLElement>(SELECTOR.mouth);
    if (mouth) {
        mouth.style.borderBottom = MOUTH_ANGRY.borderBottom;
        mouth.style.borderRadius = MOUTH_ANGRY.borderRadius;
        mouth.style.height = MOUTH_ANGRY.height;
        mouth.style.transform = MOUTH_ANGRY.transform;
    }

    // 幽默错误消息
    setToastMessage(`
                ${icon(ICON_ID.circleExclamation, ICON_STYLE.alert)}
                ${TOAST_COFFEE_MESSAGE}
            `);

    // 改变主标题和消息区域 (临时)
    const msgEl = document.querySelector<HTMLElement>(SELECTOR.message);
    const subMsg = document.querySelector<HTMLElement>(SELECTOR.subMessage);
    if (msgEl) {
        const original = msgEl.innerHTML;
        msgEl.innerHTML = MESSAGE_COFFEE;
        setTimeout(() => {
            msgEl.innerHTML = original;
        }, MESSAGE_COFFEE_HOLD_MS);
    }
    if (subMsg) {
        const origSub = subMsg.innerHTML;
        subMsg.innerHTML = MESSAGE_COFFEE_SUB;
        setTimeout(() => {
            subMsg.innerHTML = origSub;
        }, MESSAGE_COFFEE_HOLD_MS);
    }

    // 恢复表情
    setTimeout(() => {
        pupils.forEach(p => p.style.transform = '');
        if (mouth) {
            mouth.style.borderBottom = MOUTH_REST.borderBottom;
            mouth.style.borderRadius = MOUTH_REST.borderRadius;
            mouth.style.height = MOUTH_REST.height;
            mouth.style.transform = MOUTH_REST.transform;
        }
    }, FACE_RESTORE_MS);

    // 更新计数板文字闪烁
    const panel = document.querySelector<HTMLElement>(SELECTOR.counterPanel);
    if (panel) {
        panel.style.transition = PANEL_FLASH_TRANSITION;
        panel.style.background = PANEL_FLASH_BG;
        setTimeout(() => { panel.style.background = PANEL_REST_BG; }, PANEL_FLASH_MS);
    }
}

/**
 * 绑定全部交互.入口调用一次即可 -- 模块本身不再有副作用,
 * 这样依赖关系是显式的,也不会因为重复 import 而绑两次.
 */
export function mountTeapot(): void {
    if (makeTeaBtn) {
        makeTeaBtn.addEventListener('click', handleMakeTea);
    }
    if (coffeeBtn) {
        coffeeBtn.addEventListener('click', handleCoffeeRequest);
    }

    // 额外彩蛋:双击茶壶也有反馈
    if (teapotEl) {
        teapotEl.addEventListener('dblclick', function () {
            setToastMessage(`${icon(ICON_ID.faceSmileWink)} ${MESSAGE_DOUBLE_CLICK}`);
            wobbleTeapot();
        });
    }

    // 初始化显示计数器
    updateCounterDisplay();

    // 页面加载完成时显示一条幽默欢迎
    window.addEventListener('load', () => {
        setTimeout(() => {
            setToastMessage(`${icon(ICON_ID.handPeace)} ${MESSAGE_WELCOME}`);
        }, WELCOME_DELAY_MS);
    });
}
