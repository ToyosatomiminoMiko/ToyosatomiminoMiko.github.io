/**
 * 418 · 我是个茶壶 -- 交互逻辑
 * 从 418.html 内联脚本拆出,保持原有行为不变.
 * 图标不再是 Font Awesome 字体,而是 418.html 里 sprite 中的 <symbol>.
 */
import { icon } from '../shared/icon';

// 幽默元素:拒绝计数器 (一开始显示42,之后每次按"强行煮咖啡"增加)
const rejectSpan = document.getElementById('rejectCount');
const toastDiv = document.getElementById('actionToast');
const teapotEl = document.getElementById('teapotMain');
const makeTeaBtn = document.getElementById('makeTeaBtn');
const coffeeBtn = document.getElementById('requestCoffeeBtn');

let rejectCounter = 42;  // 经典梗

// 更新计数显示
function updateCounterDisplay(): void {
    if (rejectSpan) rejectSpan.textContent = String(rejectCounter);
}

// 显示临时消息 (幽默反馈)
function setToastMessage(html: string): void {
    if (toastDiv) {
        toastDiv.innerHTML = html;
        toastDiv.style.opacity = '1';
        // 可以加个小动画,不需要额外处理
    }
}

// 让茶壶晃动 (表示不满/开心)
function wobbleTeapot(): void {
    if (teapotEl) {
        teapotEl.classList.add('wobble');
        setTimeout(() => {
            teapotEl.classList.remove('wobble');
        }, 400);
    }
}

// 显示蒸汽效果增强 (已存在,但可以临时增强)
function triggerSteamBoost(): void {
    const steamSpans = document.querySelectorAll<HTMLElement>('.steam span');
    steamSpans.forEach(span => {
        span.style.animation = 'none';
        void span.offsetHeight; // 重绘
        span.style.animation = 'steamFloat 1.8s infinite ease-in-out';
    });
    // 3.5秒后恢复默认时长
    setTimeout(() => {
        steamSpans.forEach(span => {
            span.style.animation = 'steamFloat 2.5s infinite ease-in-out';
        });
    }, 2000);
}

// 泡茶 -- 优雅且幽默
function handleMakeTea(): void {
    wobbleTeapot();
    triggerSteamBoost();

    const teas = ['大吉岭', '伯爵茶', '乌龙茶', '薄荷茶', '洋甘菊', '普洱'];
    const randomTea = teas[Math.floor(Math.random() * teas.length)];

    setToastMessage(`
                ${icon('i-mug-saucer', 'margin-right:6px;')}
                正在为您冲泡 ${randomTea} ...  🍵 好香!茶壶露出了欣慰的表情.
            `);

    // 改变瞳孔位置 (斜眼看茶)
    const pupils = document.querySelectorAll<HTMLElement>('.pupil');
    pupils.forEach(p => {
        p.style.transform = 'translateX(2px) translateY(-1px)';
    });
    setTimeout(() => {
        pupils.forEach(p => p.style.transform = '');
    }, 600);

    // 同时加一点傲娇文案
    const msgEl = document.querySelector<HTMLElement>('.message');
    if (msgEl) {
        const originalMsg = msgEl.innerHTML;
        msgEl.innerHTML = '🫖 茶壶:"这才是正确的打开方式."';
        setTimeout(() => {
            msgEl.innerHTML = originalMsg;
        }, 2000);
    }
}

// 强行煮咖啡 -- 触发418幽默错误
function handleCoffeeRequest(): void {
    // 增加拒绝计数
    rejectCounter += 1;
    updateCounterDisplay();

    // 猛烈晃动 (表示抗议)
    wobbleTeapot();
    // 蒸汽愤怒冒出
    triggerSteamBoost();

    // 瞳孔变成愤怒/鄙视 (斗鸡眼/不屑)
    const pupils = document.querySelectorAll<HTMLElement>('.pupil');
    pupils.forEach((p, idx) => {
        if (idx === 0) p.style.transform = 'translateX(-3px)';
        else p.style.transform = 'translateX(3px)';
    });

    // 改变嘴巴成倒U (不屑)
    const mouth = document.querySelector<HTMLElement>('.mouth');
    if (mouth) {
        mouth.style.borderBottom = '5px solid #8b3a1a';
        mouth.style.borderRadius = '30% 30% 0 0';
        mouth.style.height = '12px';
        mouth.style.transform = 'translateX(-50%) rotate(2deg)';
    }

    // 幽默错误消息
    setToastMessage(`
                ${icon('i-circle-exclamation', 'color:#b34e4e;')}
                <strong>418 I'm a teapot</strong> -- 拒绝冲煮咖啡.茶壶甚至翻了个白眼.
            `);

    // 改变主标题和消息区域 (临时)
    const msgEl = document.querySelector<HTMLElement>('.message');
    const subMsg = document.querySelector<HTMLElement>('.sub-message');
    if (msgEl) {
        const original = msgEl.innerHTML;
        msgEl.innerHTML = '😤 茶壶:"我说了我是茶壶!再问就滋你一脸红茶!"';
        setTimeout(() => {
            msgEl.innerHTML = original;
        }, 2800);
    }
    if (subMsg) {
        const origSub = subMsg.innerHTML;
        subMsg.innerHTML = '⚠️ HTCPCP 错误: 实体是茶壶,无法处理咖啡请求.';
        setTimeout(() => {
            subMsg.innerHTML = origSub;
        }, 2800);
    }

    // 恢复表情
    setTimeout(() => {
        pupils.forEach(p => p.style.transform = '');
        if (mouth) {
            mouth.style.borderBottom = '5px solid #6b3e1e';
            mouth.style.borderRadius = '0 0 30% 30%';
            mouth.style.height = '16px';
            mouth.style.transform = 'translateX(-50%)';
        }
    }, 800);

    // 更新计数板文字闪烁
    const panel = document.querySelector<HTMLElement>('.counter-panel');
    if (panel) {
        panel.style.transition = '0.2s';
        panel.style.background = '#f0cdb0';
        setTimeout(() => { panel.style.background = '#eedbcb'; }, 200);
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
            setToastMessage(`${icon('i-face-smile-wink')} 茶壶小声嘀咕:"别戳了,再戳我就...... 还是只会泡茶."`);
            wobbleTeapot();
        });
    }

    // 初始化显示计数器
    updateCounterDisplay();

    // 页面加载完成时显示一条幽默欢迎
    window.addEventListener('load', () => {
        setTimeout(() => {
            setToastMessage(`${icon('i-hand-peace')} 欢迎!本茶壶今日心情:拒绝咖啡,从我做起.`);
        }, 300);
    });
}
