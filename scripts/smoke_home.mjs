/**
 * 首页的**真浏览器**验收(端到端,只做进程内单测做不到的那部分).
 *
 * 分工(两边不重叠):
 *
 *   - **标记长什么样 / 行为怎么迁移** -> `src/**` 下的 `*.test.ts`(vitest + happy-dom,进程内,
 *     `npm test` 里跑):标签名 / 类名 / id / 属性 / 文案 / 结构与 CSS 选择器是否对得上,
 *     以及标签页点击与方向键之后 active / show / ARIA 落在哪个元素上.
 *   - **在真浏览器里能不能用** -> 本脚本:canvas 真的画出来了吗,标签页切完真的只有一个
 *     窗格可见吗,`getComputedStyle` 下布局对不对,生成出来的宿主与地铁车窗组件是否接上了.
 *
 * 为什么要留下这一层:进程内 DOM 没有像素,没有布局,也没有真实 CSS 级联,happy-dom 里
 * `getContext('2d')` 也是空的 -- 上面那几件事只有在真引擎里才成立.
 * 反之,把结构断言也写在这里,就会得到"要 build + 要 chromium 才能验证类名"的慢回路,
 * 所以两边各管一段.
 *
 * 用法(必须先有 dist/):
 *
 *     npm run build:app        # 或者 npm run build
 *     npm run smoke:home
 *
 * 环境要求(Linux):chromium 可执行文件(`chromium-browser`)与 node 22+(全局 WebSocket).
 * 不需要 GPU:headless 里 WebGPU 走不通,地铁车窗会落到 `data-state="unavailable"`
 * 的回退分支,所以这里只断言"它的四个宿主接上了,面板长出来了",不断言车窗画面.
 * 与 `scripts/perf/451.mjs` 一样,它不参与 `build:all`(需要浏览器,不适合塞进构建流水线).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(join(HERE, '..'));
const DIST = join(ROOT, 'dist');
/** 静态服务器端口(与 scripts/perf/451.mjs 的 8781 错开,两个脚本可以同时跑) */
const PORT = 8790;
/** CDP 端口(同上,错开) */
const CDP_PORT = 9712;
/**
 * headless Chromium 的用户目录:放**系统临时目录**里.
 * 它是一次性的运行时垃圾(缓存 / GPU 缓存 / Cookies),不属于仓库的任何一类产物,
 * 所以既不进仓库根(要 gitignore 一条),也不进 dist/(那是要发布的站点产物) --
 * 每次跑前删掉重建,跑完留着由系统回收.
 */
const PROFILE = join(tmpdir(), 'toyosatomimino-home-smoke-profile');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
};

/** 起一个只服务 dist/ 的静态服务器(与线上 URL 同构) */
function serve() {
    const srv = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
            const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
            const file = join(DIST, rel === '/' ? 'index.html' : rel);
            if (!file.startsWith(DIST)) { res.writeHead(403).end('forbidden'); return; }
            const body = await readFile(file);
            res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
            res.end(body);
        } catch {
            if (!res.headersSent) { try { res.writeHead(404).end('not found'); } catch { /* ignore */ } }
        }
    });
    return new Promise((r) => srv.listen(PORT, '127.0.0.1', () => r(srv)));
}

/** 极简 CDP 客户端(与 scripts/perf/451.mjs 同一套路,只用 node 自带的 WebSocket) */
class Cdp {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.logs = []; this.errors = []; }
    static async connect(port) {
        for (let i = 0; i < 80; i++) {
            try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(250); }
        }
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === 'page');
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r));
        const cdp = new Cdp(ws);
        ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && cdp.pending.has(msg.id)) { cdp.pending.get(msg.id)(msg); cdp.pending.delete(msg.id); return; }
            if (msg.method === 'Runtime.consoleAPICalled') {
                cdp.logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`);
            }
            if (msg.method === 'Runtime.exceptionThrown') {
                cdp.errors.push(msg.params.exceptionDetails.text + ' :: ' +
                    (msg.params.exceptionDetails.exception?.description ?? ''));
            }
        });
        return cdp;
    }
    send(method, params = {}) {
        return new Promise((res) => { const id = ++this.id; this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
    }
    async eval(expression) {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        const ex = r.result?.exceptionDetails;
        if (ex) {
            return { __err: ex.text, description: ex.exception?.description ?? '' };
        }
        return r.result?.result?.value;
    }
}

// 先确认有构建产物:没有 dist 时打开的一定是 404 页面,断言会以"看不到元素"的形式
// 一次失败十几条,那种报错完全没指向"你忘了先 build".
if (!existsSync(join(DIST, 'index.html'))) {
    console.error('dist/index.html 不存在:先跑 `npm run build:app`(或 `npm run build`).');
    process.exit(1);
}

const srv = await serve();
rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn('chromium-browser', [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*',
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--window-size=1280,900', '--force-device-scale-factor=1', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });

const cdp = await Cdp.connect(CDP_PORT);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });

// 等骨架挂上(挂载发生在 DOMContentLoaded)
let mounted = false;
for (let i = 0; i < 60; i++) {
    mounted = await cdp.eval(`document.querySelector('#site-root')?.childElementCount > 0`);
    if (mounted === true) break;
    await sleep(250);
}
await sleep(700); // 让"每帧 / 每秒"的东西跑一轮(时钟,初始渲染)

const report = await cdp.eval(`(() => {
    const out = [];
    const ok = (name, pass, extra) => out.push({ name, pass: !!pass, extra: extra === undefined ? '' : String(extra) });
    const q = (s) => document.querySelector(s);
    const qa = (s) => Array.from(document.querySelectorAll(s));
    try {
        /*
          ---- 第 0 组:整体挂上了吗 ----
          结构与类名不在这里断言(那是 *.test.ts 的活),这里只确认"页面真的长出来了",
          这样真出问题时是一条"没挂上",而不是下面十几条连带的看不懂的报错.
        */
        ok('骨架挂上了(header + main)', q('header.site-header') !== null && q('main .tab-content') !== null);
        ok('六个标签页窗格都在', ['home','calendar','oled','rbt','ieee754','setting'].every((id) => q('#' + id)));
        /*
          LED 时钟从 HOME 首屏底部搬到了 Calendario 标签页顶部:首屏底部只剩风格按钮宿主,
          时钟宿主必须长在日历页的正文里,而且是正文的第一个子节点(见 src/calendar/).
        */
        ok('首屏底部只剩风格按钮宿主(时钟已搬走)',
            q('#hero .hero__bottom > #metro-styles') !== null &&
            q('#hero .hero__bottom > #app_led_clock') === null &&
            q('#hero #app_led_clock') === null);
        const calendarBody = q('#calendar .ui-panel-body');
        ok('LED 时钟宿主在日历页顶部(.ui-panel-body 的第一个子节点)',
            calendarBody !== null && calendarBody.firstElementChild === q('#app_led_clock'),
            calendarBody === null ? '没有 .ui-panel-body' : calendarBody.firstElementChild?.id);

        /*
          ---- 第 1 组:宿主交回 + 组件接管(真集成) ----
          骨架按 MOUNT_IDS 建宿主并把引用交给 main.ts,这里验证地铁车窗组件真的
          把四块标记长进了那些宿主(修饰类由组件补,面板由组件生成).
        */
        ok('车窗舞台宿主拿到了组件的修饰类', q('#metro-window')?.classList.contains('metro-window--stage') === true);
        ok('风格按钮长进了首屏宿主(3 颗 data-style)', qa('#metro-styles > .style-row button[data-style]').length === 3);
        // 库的 createSlider 给成员控件挂了定位类名(.slider-field-range),按它选;
        // 行数即滑块条数.
        const sliderRanges = qa('#metro-params .slider-field-range');
        ok('控制台长进了 SETTING 页给的设置组(fieldset.setting-group + 7 条滑块)',
            q('#metro-params') !== null && q('#metro-params').tagName === 'FIELDSET' &&
            q('#metro-params').classList.contains('setting-group') && sliderRanges.length === 7,
            sliderRanges.length + ' 条');
        // 滑块的重置按钮由 UI 库的 createSlider 生成:条数与滑块一致(每条行末一颗).
        ok('每条滑块都带库的重置按钮',
            qa('#metro-params button.slider-field-reset').length === 7,
            qa('#metro-params button.slider-field-reset').length + ' 颗');
        ok('上传面板四层各一个 file input', qa('#metro-uploads input[type=file]').length === 4);
        /*
          播放与暂停合成了一颗开关:控制条里只该有"开关 + 重置"两颗按钮,
          点一下文案在"暂停 / 播放"之间切(见 config.ts 的 TRANSPORT_BUTTONS /
          TRANSPORT_TOGGLE_LABEL).这里点两次,回到原状态.
        */
        const transportButtons = qa('#metro-params .controls button');
        const transportToggle = q('#playPauseBtn');
        const toggledTransport = (() => {
            if (!transportToggle) return { before: '没有开关', after: '', back: '' };
            // headless 里没有 GPU,boot 失败后面板仍是 disabled(按钮点不动),
            // 所以这里临时把 fieldset 解开再点 -- 只改 disabled,不动别的状态,
            // 点完还原.booted 为假时点击只切文案,不会碰 wasm.
            const panel = q('#metro-params');
            const wasDisabled = panel ? panel.disabled : false;
            if (panel) panel.disabled = false;
            const before = transportToggle.textContent;
            transportToggle.click();
            const after = transportToggle.textContent;
            transportToggle.click();
            const back = transportToggle.textContent;
            if (panel) panel.disabled = wasDisabled;
            return { before, after, back };
        })();
        ok('播放控制只剩"播放-暂停开关 + 重置"两颗',
            transportButtons.length === 2 && transportButtons[0].id === 'playPauseBtn' &&
            transportButtons[1].id === 'resetBtn' && q('#startBtn') === null && q('#pauseBtn') === null,
            transportButtons.map((b) => b.id).join(' / '));
        ok('开关文案点一下就换("暂停" -> "播放" -> "暂停")',
            toggledTransport.before === '暂停' && toggledTransport.after === '播放' &&
            toggledTransport.back === '暂停',
            toggledTransport.before + ' -> ' + toggledTransport.after + ' -> ' + toggledTransport.back);
        /*
          全站可见文本里不允许出现 emoji(导航 / 首屏 / 六个窗格的全部文本节点;
          隐藏窗格也在 DOM 里,一并过一遍).这条守着"不用图标做提示"的约定 --
          以后谁再往按钮或提示里塞 emoji,真机验收会当场失败.
        */
        const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{FE0F}]/u;
        const emojiHits = [];
        const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (textWalker.nextNode()) {
            const node = textWalker.currentNode;
            const text = (node.nodeValue || '').trim();
            if (text && EMOJI.test(text)) {
                emojiHits.push((node.parentElement ? node.parentElement.tagName : '?') + ':' + text.slice(0, 30));
            }
        }
        ok('页面上没有任何 emoji(全部可见文本过一遍)',
            emojiHits.length === 0, emojiHits.slice(0, 3).join(' / '));

        /*
          ---- 第 2 组:必须真渲染才成立的事 ----
        */
        // 时钟:2D 画布真的点出像素了
        const clock = q('#time_canvas');
        let clockPixels = -1;
        try {
            const d = clock.getContext('2d').getImageData(0, 0, clock.width, clock.height).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) { if (d[i] > 0 || d[i + 1] > 0 || d[i + 2] > 0) n++; }
            clockPixels = n;
        } catch (e) { clockPixels = -1; }
        ok('LED 时钟真的画了点阵', clockPixels > 10, clockPixels + ' 个亮点');

        /*
          日历页:三张卡的主日期行由 Intl 的历法扩展算出,挂载时就填好.这里量五件事 --
          三行都非空;农历那行没有阿拉伯数字(ICU 配对的格里高利历年已裁掉,只剩干支年 + 月 + 日);
          格里高利历那行是"年 + 两位月 + 两位日"(补零在 formatToParts 之后做,防的是引擎之间
          ICU 骨架不同);希伯来历那行按 RTL 渲染(元素上的 dir="auto" 必须让位图文字的标点
          落在正确一侧);它的副行是"转写; 汉语"(汉语月名查的是本站的表,所以要挡住
          "真浏览器里 ICU 的月名转写跟 Node 不一样 -> 查不到 -> 悄悄只剩转写").
          注:这段代码坐在一个模板字符串里,注释里不能出现反引号,正则里不能出现反斜杠
          (会被模板字符串吃掉),所以数字类用 [0-9] 写,不写简写形式.
        */
        const calendarDates = qa('#calendar .calendar-item__date');
        const hebrewDate = calendarDates[2];
        ok('日历页三张卡的主日期行都有内容(格里高利历 / 农历 / 希伯来历)',
            calendarDates.length === 3 && calendarDates.every((el) => (el.textContent || '').trim().length > 0),
            calendarDates.map((el) => (el.textContent || '').trim().slice(0, 20)).join(' | '));
        ok('农历行只剩干支年 + 月 + 日(ICU 配对的格里高利历年被裁掉了)',
            calendarDates[1] !== undefined && !/[0-9]/.test(calendarDates[1].textContent || ''),
            calendarDates[1] ? calendarDates[1].textContent : '没有第二行');
        ok('格里高利历主行是"年 + 两位月 + 两位日"(月 / 日 0 补齐)',
            calendarDates[0] !== undefined
                && /^[0-9]{4}年[0-9]{2}月[0-9]{2}日$/.test((calendarDates[0].textContent || '').trim()),
            calendarDates[0] ? calendarDates[0].textContent : '没有第一行');
        ok('希伯来历那行按 RTL 渲染(dir="auto" 跟着希伯来文走)',
            hebrewDate !== undefined && getComputedStyle(hebrewDate).direction === 'rtl',
            hebrewDate === undefined ? '没有第三行' : getComputedStyle(hebrewDate).direction);
        const hebrewLatin = qa('#calendar .calendar-item__latin')[2];
        ok('希伯来历副行是"转写; 汉语"(真浏览器里月名也查得到汉译,日补零)',
            hebrewLatin !== undefined
                && /^[0-9]+ [A-Za-z].*; [0-9]+年.*月[0-9]{2}日$/.test((hebrewLatin.textContent || '').trim()),
            hebrewLatin ? hebrewLatin.textContent : '没有第三行的副行');

        /*
          可见文案契约:这一页的导航项叫 Calendario,三张卡的名字里第一张是"格里高利历"
          (不写"公历").文案是界面本身,只能在真页面里量.
          注:这段代码坐在一个模板字符串里,注释里不能出现反引号.
        */
        const navLabels = qa('.site-header .nav-tabs .nav-link').map((a) => (a.textContent || '').trim());
        ok('导航项文案是 HOME / Calendario / OLED / RBT / IEEE754 / SETTING',
            navLabels.join(' / ') === 'HOME / Calendario / OLED / RBT / IEEE754 / SETTING',
            navLabels.join(' / '));
        const cardLabels = qa('#calendar .calendar-item__label').map((el) => (el.textContent || '').trim());
        ok('三张卡的名字是 格里高利历 / 农历 / 希伯来历',
            cardLabels.join(' / ') === '格里高利历 / 农历 / 希伯来历', cardLabels.join(' / '));

        // OLED:构造时把画布铺成"未亮起"的中性灰 #333(证明 OLEDCanvas 真的建起来了)
        // 期望的 0x33 与 src/oled/config.ts 的 OLED_COLOR_UNLIT 同值(本脚本在浏览器里,读不到 TS 常量)
        let oledPixel = '未读到';
        let oledUnlit = false;
        try {
            const d = q('#pixelCanvas').getContext('2d').getImageData(0, 0, 1, 1).data;
            oledPixel = 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
            oledUnlit = d[0] === 0x33 && d[1] === 0x33 && d[2] === 0x33;
        } catch (e) { oledPixel = '读取失败'; }
        ok('OLED 画布已初始化(左上角未亮的中性灰 #333)', oledUnlit, oledPixel);

        // 红黑树:示例树真的被解析并画出了红节点
        const tree = q('#rbCanvas');
        let redPixels = 0;
        try {
            const d = tree.getContext('2d').getImageData(0, 0, tree.width, tree.height).data;
            for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) { redPixels++; if (redPixels > 200) break; } }
        } catch (e) { redPixels = -1; }
        ok('红黑树真的画出来了(有红色节点)', redPixels > 200, redPixels + ' 个红像素(采样到上限即停)');

        /*
          性质检查(见 rbt/rbt_tree.ts):清单是"抬头 + 每条一行",示例树是合法红黑树
          所以四条全过.这里验的是**清单真的被渲染出来了**(条数 == config 里的条数)
          与"PASS / FAIL"两种结论的类名与颜色都挂上了;具体某棵树该过哪几条由
          npm test 的 rbt_tree.test.ts 覆盖,这里不重复.
        */
        /*
          状态文案的真值只有一处(src/rbt/config.ts 的 RBT_PROPERTY_STATE_PASS / _FAIL).
          这里过去抄了两份字面量,后来 config 那句被改写成 PASS / FAIL 而脚本没跟上,
          这两条断言就直接挂了 -- 所以现在从页面上现读,不在脚本里维护第二份文案.

          坏树那一轮里,清单上只会出现两种状态文案(一条 PASS 一条 FAIL),所以
          "不是 PROPERTY_PASS 的那个"就是失败文案;这样脚本对文案本身完全免疫.
        */
        const collectStateTexts = () =>
            [...new Set([...document.querySelectorAll('#treeProperties .tree-property-state')]
                .map((state) => state.textContent))];
        const stateTextsBefore = collectStateTexts();
        const PROPERTY_PASS = stateTextsBefore[0] || '';
        const propertyRows = qa('#treeProperties .tree-property');
        const propertySummary = q('#treeProperties .tree-property-summary');
        const passStates = qa('#treeProperties .tree-property-state.is-pass');
        const failStates = qa('#treeProperties .tree-property-state.is-fail');
        /*
          颜色要换算过再比:令牌里写的是 #4ade80,getComputedStyle 给的永远是
          rgb(74, 222, 128),直接比字符串会永远不相等;而且令牌读不到时两边都是
          空串也会"相等",那种真问题正好被这条换算暴露出来.
        */
        const readColorToken = (name) =>
            getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const toRgb = (color) => {
            const hex = /^#([0-9a-f]{6})$/i.exec(color);
            if (!hex) return color;
            const n = parseInt(hex[1], 16);
            return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')';
        };
        ok('红黑树性质清单渲染出来了(示例树四条全过)',
            q('#treeProperties') !== null && q('#treeProperties').hidden === false &&
            propertyRows.length === 4 && passStates.length === 4 && failStates.length === 0 &&
            propertySummary !== null &&
            propertyRows.every((row) => row.textContent.indexOf(PROPERTY_PASS) !== -1) &&
            (passStates[0] ? getComputedStyle(passStates[0]).color : '') ===
                toRgb(readColorToken('--rbt-pass-color')) &&
            (propertySummary ? propertySummary.textContent : '').indexOf('4 条中 0 条') !== -1,
            '行数 ' + propertyRows.length + ' / PASS ' + passStates.length + ' / 抬头 ' +
                (propertySummary ? propertySummary.textContent : '没有抬头'));

        /*
          往输入框里喂一棵坏树(根是红的 + 左子树里塞了更小的值),看清单会不会跟着变:
          这一下同时走"input 事件 -> 重新解析 -> 性质检查 -> 重建清单"整条链路,
          单测各自只覆盖其中一段.
        */
        const treeInput = q('#treeInput');
        if (treeInput) {
            treeInput.value = '10R(5B(3B,7B),40B(2B,50B))';
            treeInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const failAfterBad = qa('#treeProperties .tree-property-state.is-fail');
        const badRows = qa('#treeProperties .tree-property');
        const stateTextsAfter = collectStateTexts();
        const PROPERTY_FAIL = stateTextsAfter.find((text) => text !== PROPERTY_PASS) || '';
        const failRowTexts = badRows.filter((row) => row.textContent.indexOf(PROPERTY_FAIL) !== -1)
            .map((row) => row.textContent);
        ok('喂一棵坏树:清单跟着报 FAIL(根红 + 值乱序两条)',
            failAfterBad.length === 2 && failRowTexts.length === 2 &&
            (failAfterBad[0] ? getComputedStyle(failAfterBad[0]).color : '') ===
                toRgb(readColorToken('--rbt-fail-color')),
            'FAIL ' + failAfterBad.length + ' 条: ' + failRowTexts.join(' / '));
        // 还原成一条合法红黑树,免得后面几条"页面状态"的断言读到被改过的输入
        if (treeInput) {
            treeInput.value = '15B(7R(3B,11B),23R(19B,27B))';
            treeInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        ok('改回合法树:清单回到四条全过',
            qa('#treeProperties .tree-property-state.is-fail').length === 0 &&
            qa('#treeProperties .tree-property-state.is-pass').length === 4);

        // IEEE754:初始那次渲染真的跑完了(位图 64 格 + KaTeX 公式 + 特殊值表)
        ok('IEEE754 初始渲染跑完(位图 64 格 + KaTeX + 特殊值表)',
            qa('#ieee-bits .ieee-bit').length === 64 && q('#ieee-formula .katex') !== null &&
            qa('#ieee-special .ieee-special-table tbody tr').length > 0);

        /*
          ---- 第 3 组:布局与 CSS 级联(进程内 DOM 没有布局,只能在这里验) ----
        */
        /*
          背景区与车窗那两块面板**同构**:SETTING 面板体的直接子节点就是**三颗设置组
          fieldset.setting-group**(宿主 = 那颗组本身,由 src/setting/setting_page.ts
          建),每颗的内容由各自的模块长进去(背景见 setting/background_section.ts 的
          mountBackgroundSection).背景组里那条 flex 行是 .bgrow:两颗按钮并排,行高
          必须包住它们 -- 老写法里浮动项会让行高塌成 0,压住下面的控制台,所以那时
          验的是 .bgul 的 flow-root;现在行是 flex 容器,直接验"行真的摊开 +
          两块 tile 并排 + 行高包住它们".

          量之前要先把 SETTING 窗格临时点亮:此刻它还是 .fade:not(.show) 底下的
          display: none,隐藏子树的 offset / rect 一律是 0(量不出布局,只会得到
          "行高 0" 这种假失败).临时加一次 .active 量完就撤,不动类名契约,
          也不给用户看见(整个表达式在浏览器里同步跑完,中间没有渲染帧).
          注:这段代码本身坐在一个模板字符串里,注释里不能出现反引号或美元花括号.
        */
        const settingBody = q('#setting .ui-panel-body');
        const bgGroup = q('#setting-bg');
        const bgRow = q('.bgrow');
        // 面板体的直接子节点 = 三颗设置组(没有 div 包 fieldset 的空壳)
        const settingGroups = settingBody ? [...settingBody.children] : [];
        ok('SETTING 面板体正好三颗设置组 fieldset.setting-group(没有多余的包裹层)',
            settingBody !== null && settingGroups.length === 3 &&
            settingGroups.every((el) => el.tagName === 'FIELDSET' && el.classList.contains('setting-group')) &&
            qa('#setting .ui-panel-body > fieldset.setting-group').length === 3 &&
            settingGroups[0] === bgGroup,
            settingGroups.map((el) => el.tagName + (el.id ? '#' + el.id : '')).join(' / '));
        const bgLayout = (() => {
            const pane = q('#setting');
            if (!bgGroup || !bgRow || !pane) return null;
            // 隐藏子树里量不到布局:先点亮 SETTING,量完立刻撤(同一次同步执行,不出帧)
            pane.classList.add('active');
            const tiles = qa('.bgrow .bgbtn');
            // 行里第三块是"页面透明度"滑块(库的 .slider-field,见 src/setting/page_opacity.ts):
            // 它也是行的内容,宽度必须算进去,否则下面那条"行盒贴着内容"会假失败
            const opacityField = q('.bgrow .opacity-field');
            const gap = parseFloat(getComputedStyle(bgRow).columnGap) || 0;
            const children = [...bgRow.children];
            const measured = {
                height: bgRow.offsetHeight,
                // 行盒应该正好是"所有子项 + 子项之间的 gap":多出来的宽度就是行上的死区
                width: bgRow.offsetWidth,
                contentWidth: tiles.reduce((sum, tile) => sum + tile.offsetWidth, 0) +
                    (opacityField ? opacityField.offsetWidth : 0) +
                    gap * Math.max(0, children.length - 1),
                tiles: tiles.map((tile) => ({
                    width: tile.offsetWidth,
                    height: tile.offsetHeight,
                    left: tile.offsetLeft,
                })),
            };
            pane.classList.remove('active');
            return measured;
        })();
        const bgTilesSideBySide = bgLayout !== null && bgLayout.tiles.length === 2 &&
            bgLayout.tiles.every((tile) => tile.width > 0 && tile.height > 0) &&
            bgLayout.tiles[1].left >= bgLayout.tiles[0].left + bgLayout.tiles[0].width;
        ok('背景缩略图行真的摊开且被两块 tile(与行里那条滑块)撑出高度(.bgrow 的 flex + gap 生效)',
            bgRow !== null && getComputedStyle(bgRow).display === 'flex' &&
            getComputedStyle(bgRow).columnGap ===
                getComputedStyle(document.documentElement).getPropertyValue('--setting-row-gap').trim() &&
            bgTilesSideBySide && bgLayout.height > 0 &&
            // 行盒贴着按钮(width: fit-content):按钮右边不留"点了没反应"的死区
            Math.abs(bgLayout.width - bgLayout.contentWidth) < 1,
            bgRow && bgLayout ? 'display:' + getComputedStyle(bgRow).display +
                ' gap:' + getComputedStyle(bgRow).columnGap + ' height:' + bgLayout.height + 'px' +
                ' row:' + bgLayout.width + 'px(内容 ' + bgLayout.contentWidth + 'px)' +
                ' tiles:' + bgLayout.tiles.map((t) => t.width + 'x' + t.height).join(' / ') : '没有背景行');
        /*
          设置组的框体归公共样式 .setting-group(src/setting/setting.css):背景组与车窗
          那两块设置组必须拿到同一套底色 / 描边 / 内边距 / legend 观感.这条只有
          真级联才验得出来 -- 类名对了而规则掉了的表现是"背景组没有框体"(不报错).
        */
        const bgLegend = q('#setting-bg > legend');
        const paramFieldset = q('#metro-params');
        const paramLegend = q('#metro-params > legend');
        const uploadFieldset = q('#metro-uploads');
        const bgFrame = bgGroup ? getComputedStyle(bgGroup) : null;
        const paramFrame = paramFieldset ? getComputedStyle(paramFieldset) : null;
        ok('三块设置组共用一套框体(.setting-group:底色 / 描边 / 内边距 / legend 颜色一致)',
            bgGroup !== null && bgLegend !== null && bgLegend.textContent === '背景' &&
            [bgGroup, paramFieldset, uploadFieldset].every((el) => el !== null && el.classList.contains('setting-group')) &&
            bgFrame !== null && paramFrame !== null &&
            bgFrame.backgroundColor !== 'rgba(0, 0, 0, 0)' && bgFrame.borderTopStyle === 'solid' &&
            bgFrame.paddingTop !== '0px' &&
            bgFrame.backgroundColor === paramFrame.backgroundColor &&
            bgFrame.borderTopColor === paramFrame.borderTopColor &&
            bgFrame.paddingTop === paramFrame.paddingTop &&
            uploadFieldset !== null &&
            getComputedStyle(uploadFieldset).backgroundColor === bgFrame.backgroundColor &&
            paramLegend !== null && getComputedStyle(bgLegend).color === getComputedStyle(paramLegend).color,
            bgFrame ? '底色:' + bgFrame.backgroundColor + ' 描边:' + bgFrame.borderTopColor +
                ' 内边距:' + bgFrame.paddingTop +
                ' legend:' + (bgLegend ? getComputedStyle(bgLegend).color : '没有 legend') : '没有背景组');
        /*
          **这一页里所有滑块必须是同一副长相**:控件的观感(底色 / 圆角 / 字体 /
          标签色 / 滑杆强调色 / 数值框)只由 src/setting/setting.css 里
          ".setting-group .slider-field*" 一份定义,作用域是"设置组",不是某一颗宿主.
          这条只有在真级联里才验得出来:少了作用域前缀,背景组那条滑块会静默退回
          UI 库的默认主题(浅蓝强调 + 白 2% 底),看着"也是滑块",但和旁边那七条不是一个东西.
        */
        const metroSlider = q('#metro-params .slider-field');
        const opacitySliderField = q('.bgrow .opacity-field');
        const controlLook = (field) => {
            if (!field) return null;
            const cs = getComputedStyle(field);
            const range = getComputedStyle(field.querySelector('.slider-field-range'));
            const value = getComputedStyle(field.querySelector('.slider-field-value'));
            const label = getComputedStyle(field.querySelector('.slider-field-label'));
            return [cs.backgroundColor, cs.borderTopLeftRadius, cs.fontFamily,
                range.accentColor, value.backgroundColor, value.borderTopColor, value.color,
                label.color].join(' | ');
        };
        const metroLook = controlLook(metroSlider);
        const opacityLook = controlLook(opacitySliderField);
        ok('设置组里的滑块只有一副长相(背景组那条与车窗面板里的配色 / 字体 / 强调色完全一致)',
            metroLook !== null && opacityLook !== null && metroLook === opacityLook &&
            getComputedStyle(opacitySliderField).fontFamily.indexOf('consolas') === -1,
            '车窗: ' + metroLook + '  <=>  背景: ' + opacityLook);
        /*
          背景缩略图项整块是库的按钮(见 src/setting/background_section.ts).两件事只有
          在真级联里才验得出来:本站的 .bgbtn 盖住了库基线的块排布 / 内边距,而"按钮
          该有的部分"(指针 / 描边 / 悬停 / 焦点)仍由库基线供着 -- 本站样式表或库样式
          表少引入一份,这两边就会各塌一半,进程内 DOM 看不出来.
        */
        const bgButton = q('.bgrow button.bgbtn');
        const bgStyle = bgButton ? getComputedStyle(bgButton) : null;
        const bgPaddingToken = getComputedStyle(document.documentElement)
            .getPropertyValue('--setting-item-padding').trim();
        ok('背景缩略图项是库的按钮(块排布归本站,指针与描边归库)',
            bgStyle !== null && bgStyle.display === 'block' && bgStyle.cursor === 'pointer' &&
            bgStyle.borderTopStyle === 'solid' && bgStyle.padding === bgPaddingToken,
            bgStyle ? 'display:' + bgStyle.display + ' cursor:' + bgStyle.cursor +
                ' padding:' + bgStyle.padding + ' border:' + bgStyle.borderTopWidth : '没有按钮');
        /*
          委托按**按钮**命中,再从按钮里取图:所以点按钮自己(文案 / 内边距 / 描边)
          这一下也要真的换背景 -- 只认 <img> 的话这里会静默失效.点完再切回默认那张
          (第二项 CODE 与 tokens.css 的 --bg-image-default 是同一张),免得后面几条
          "底色 / 导航条"的断言读到被换过的页面状态.
        */
        const bgBefore = getComputedStyle(document.body).backgroundImage;
        if (bgButton) bgButton.click();
        const bgAfter = getComputedStyle(document.body).backgroundImage;
        ok('点按钮本身(文案 / 内边距)就能换整站背景',
            bgAfter !== bgBefore && bgAfter.indexOf('bgstar') !== -1,
            bgBefore.split('/').pop() + ' -> ' + bgAfter.split('/').pop());
        qa('.bgrow button.bgbtn')[1]?.click();
        ok('导航条是脱离文档流的固定条(position: fixed)',
            getComputedStyle(q('header.site-header')).position === 'fixed');
        ok('首屏铺满视口高度(hero 的 100dvh 令牌生效)',
            q('#hero').getBoundingClientRect().height > 200,
            Math.round(q('#hero').getBoundingClientRect().height) + 'px');
        // 令牌 --oled-button-margin 若写错名字,var() 会退化成 gap:normal(不报错),
        // 所以这里验真值.它是工具区那一排(七颗按钮 + 分段选择器)唯一的间距来源:
        // 复制 / 导入 / 折叠三颗按钮也住在 .tools 里.
        const toolsGap = getComputedStyle(q('#oled .tools')).columnGap;
        ok('OLED 工具区的间距真的吃到了令牌(--oled-button-margin)',
            toolsGap !== '0px' && toolsGap !== '' && toolsGap !== 'normal', toolsGap);
        /*
          SETTING 整页面板与 OLED 面板都用库的同一个 .ui-panel 框体,所以两边必须
          拿到同一个底色 -- 库的 widgets.css 没被引进来的话,这里就会出现"一张没
          底色的面板"(进程内 DOM 没有级联与布局,只能在这里验).
        */
        const settingPanel = q('#setting > .ui-panel');
        const settingHeader = settingPanel?.querySelector(':scope > .ui-panel-header');
        ok('SETTING 页是一张面板(.ui-panel-header 里是"设置",底色与 OLED 面板一致)',
            settingPanel !== null && settingHeader?.textContent === '设置' &&
            getComputedStyle(settingPanel).backgroundColor === getComputedStyle(q('#oled .ui-panel')).backgroundColor,
            settingPanel ? getComputedStyle(settingPanel).backgroundColor : '没有面板');
        /*
          十进制输入框的圆角归 miko_ui 主题(站点 .ieee-input 引 --radius-sm,库默认
          0px);菜单主文案的 <code> 继承所在元素颜色而不是浏览器默认的链接色 --
          后者要在真级联里才验得出来(进程内 DOM 不算样式).
        */
        const inputRadius = getComputedStyle(q('#ieee-input')).borderTopLeftRadius;
        ok('十进制输入框圆角归 miko_ui 主题(.ieee-input 引 --radius-sm = 0px)',
            inputRadius === '0px', inputRadius);
        const codeEl = q('.menu-anchor .menu-item code');
        const codeColor = codeEl ? getComputedStyle(codeEl).color : '没有 <code>';
        const itemColor = codeEl ? getComputedStyle(codeEl.closest('.menu-item')).color : '';
        ok('精度菜单主文案的 <code> 继承菜单项文字色(站点 code 规则生效)',
            codeEl !== null && codeColor === itemColor, codeColor);

        /*
          ---- 第 4 组:index.css 的**文档基线** ----
          这几条全是元素级规则,特异性高过站点的 '*' 重置,所以只有它们能盖住重置.
          它们**不会**以任何形式报错,只会静默地让版式变样(六个窗格堆叠 /
          导航栏竖排 / 盒模型反转 / 整页露白底),所以只能靠真浏览器里的
          computed style 与几何把它们钉住.
        */
        // 盒模型:全站 border-box(少了它,所有"定宽 + 内边距"的盒子一起溢出)
        ok('全站盒模型是 border-box(文档基线生效)',
            getComputedStyle(q('main')).boxSizing === 'border-box' &&
            getComputedStyle(q('#output-button')).boxSizing === 'border-box',
            getComputedStyle(q('main')).boxSizing);
        // 深色配色方案:UA 的滚动条 / 表单控件 / 画布底色都按它走
        ok('配色方案是 dark(滚动条与表单控件按深色渲染)',
            getComputedStyle(document.documentElement).colorScheme === 'dark',
            getComputedStyle(document.documentElement).colorScheme);
        // 页面底色来自本站令牌 --bg-page(不是浏览器默认的白)
        const bodyBg = getComputedStyle(document.body).backgroundColor;
        ok('页面底色来自本站令牌 --bg-page(不是浏览器默认的白)',
            bodyBg === 'rgb(33, 37, 41)', bodyBg);
        // 正文基准字号是绝对长度:通用等宽族(monospace)不再被 Chrome 拉成 13px
        ok('正文基准字号是 1rem = 16px(等宽族的坐标读数不再掉成 13px)',
            getComputedStyle(document.body).fontSize === '16px' &&
            getComputedStyle(q('#coordsDisplay')).fontSize === '16px',
            getComputedStyle(q('#coordsDisplay')).fontSize);
        // 标签栏的布局:display:flex + 无项目符号(少了它导航栏塌成竖排列表)
        const navList = q('ul.nav-tabs');
        ok('标签栏是横向 flex 且没有项目符号(文档基线里的标签栏规则生效)',
            getComputedStyle(navList).display === 'flex' &&
            getComputedStyle(navList).listStyleType === 'none',
            getComputedStyle(navList).display + ' / ' + getComputedStyle(navList).listStyleType);
        // 标签自身是块盒:行内盒的上下内边距不参与行高,导航条会塌
        ok('标签是块盒且带上下内边距(导航条高度靠它撑)',
            getComputedStyle(q('a.nav-link')).display === 'block' &&
            getComputedStyle(q('a.nav-link')).paddingTop !== '0px',
            getComputedStyle(q('a.nav-link')).paddingTop);
        /*
          窗格显隐:**最容易被静默改坏的一条**.'.tab-content > .tab-pane' 的
          display:none 与 '> .active' 的 display:block 是六个窗格"一次只显示一个"
          的全部依据,少了它们六个会同时纵向堆叠在首屏下面(页面还是"能打开"的).
          这里逐个数一遍:除当前项外,其余五个窗口的 display 必须是 none.
          注:这段代码本身坐在一个模板字符串里,注释里不能出现反引号.
        */
        const panes = ['home', 'calendar', 'oled', 'rbt', 'ieee754', 'setting'];
        const shown = panes.filter((id) => getComputedStyle(q('#' + id)).display !== 'none');
        ok('六个窗格里只有一个可见(窗格显隐规则生效)',
            shown.length === 1 && shown[0] === 'home', '可见: ' + JSON.stringify(shown));
        /*
          窗格的不透明档位不再是写死的 1:它由令牌 --tab-pane-opacity(默认 0.9)给,
          可见窗格必须正好落在这一档上 -- 既不能停在 0(.fade:not(.show) 误伤当前项),
          也不能被内联样式顶掉令牌.
        */
        const paneOpacityToken = () => Number(
            getComputedStyle(document.documentElement).getPropertyValue('--tab-pane-opacity'));
        ok('可见窗格的 opacity 就是令牌 --tab-pane-opacity(.fade:not(.show) 的 opacity: 0 没有误伤当前项)',
            Math.abs(Number(getComputedStyle(q('#home')).opacity) - paneOpacityToken()) < 1e-6,
            getComputedStyle(q('#home')).opacity + ' / 令牌 ' + paneOpacityToken());
        /*
          页面透明度滑块(SETTING 背景行里那条):拖它写文档根的 --tab-pane-opacity 令牌,
          窗格的规则消费它.这两件事都只有真级联才算数 -- 进程内 DOM 不解析 var(),
          令牌名写错的表现是"拖了没反应".量完点重置回到声明值,后面标签页交互那几条
          断言还读 opacity.
        */
        const opacitySlider = q('.bgrow .opacity-field input[type=range]');
        const opacityPane = q('#home');
        /*
          滑块那一格是定宽的(.opacity-field 的 --setting-opacity-field-width):本站
          给的宽度够不够放下"名称 + 数值框 + reset"要看真布局,所以顺手量一次溢出 --
          scrollWidth 大过 clientWidth 就是名字/按钮被挤出格子了(窗口窄时会换行 / 叠字,
          但不会报错).
        */
        const opacityFieldEl = q('.bgrow .opacity-field');
        const opacityMetaEl = q('.bgrow .opacity-field .slider-field-meta');
        const opacityFits = opacityFieldEl !== null && opacityMetaEl !== null &&
            opacityFieldEl.scrollWidth <= opacityFieldEl.clientWidth + 1 &&
            opacityMetaEl.scrollWidth <= opacityMetaEl.clientWidth + 1;
        /*
          窗格的 opacity 挂着 150ms 的过渡(标签页切换的淡入,见 index.css 的
          .tab-pane.fade):不关掉它,改完令牌读到的还是过渡起点.这里临时内联一条
          transition: none 把过渡停掉(压过类里的那条),量完撤掉 -- 不动类名契约,
          也不给用户看见(整段在浏览器里同步跑完,中间没有渲染帧).
          注:这段代码坐在一个模板字符串里,注释里不能出现反引号.
        */
        opacityPane.style.transition = 'none';
        const opacityBefore = getComputedStyle(opacityPane).opacity;
        const tokenBefore = paneOpacityToken();
        /*
          拖到区间中点而不是写死 0.5:区间(0.5 ~ 1.0)是声明里的可调参数,写死的数
          在区间改了之后会变成"越界值",这条断言就会以看不懂的方式红掉.
        */
        const opacityTarget = opacitySlider
            ? ((Number(opacitySlider.min) + Number(opacitySlider.max)) / 2).toFixed(2)
            : null;
        if (opacitySlider) {
            opacitySlider.value = opacityTarget;
            opacitySlider.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const tokenDragged = paneOpacityToken();
        const opacityDragged = getComputedStyle(opacityPane).opacity;
        q('.bgrow .opacity-field .slider-field-reset')?.click();
        const opacityReset = getComputedStyle(opacityPane).opacity;
        opacityPane.style.transition = '';
        ok('背景行里那条滑块改的是窗格透明度(--tab-pane-opacity 被 .tab-pane 吃到:默认档 -> 拖到区间中点 -> 重置回默认档)',
            opacitySlider !== null && opacityFits &&
            getComputedStyle(q('.bgrow .opacity-field')).width !== '0px' &&
            opacityDragged === opacityTarget &&
            Math.abs(Number(opacityReset) - paneOpacityToken()) < 1e-6,
            'width:' + (opacityFieldEl ? getComputedStyle(opacityFieldEl).width : '没有滑块') +
            ' 溢出:' + (opacityFieldEl ? opacityFieldEl.scrollWidth - opacityFieldEl.clientWidth : '?') +
            '/' + (opacityMetaEl ? opacityMetaEl.scrollWidth - opacityMetaEl.clientWidth : '?') +
            'px 令牌:' + tokenBefore + ' -> ' + tokenDragged +
            ' pane:' + opacityBefore + ' -> ' + opacityDragged + ' -> ' + opacityReset);
        // 标签是自定义观感的链接:不能还带着浏览器默认的下划线
        ok('标签栏的链接没有下划线(文档基线里的 a 规则接住了)',
            getComputedStyle(q('a.nav-link')).textDecorationLine === 'none',
            getComputedStyle(q('a.nav-link')).textDecorationLine);

        return out;
    } catch (e) {
        out.push({ name: '断言脚本自身异常: ' + (e && e.message), pass: false,
            extra: String((e && e.stack) || '').split('\\n').slice(0, 3).join(' | ') });
        return out;
    }
})()`);

if (!Array.isArray(report) || (report && report.__err)) {
    console.error('页面内断言脚本自己失败了:', JSON.stringify(report, null, 2));
    console.error('mounted =', mounted);
    console.error('页面 console:', cdp.logs.slice(0, 20));
    console.error('未捕获异常:', cdp.errors.slice(0, 5));
    chrome.kill('SIGKILL');
    srv.close();
    process.exit(1);
}

// ---- 交互:站点自己的标签页控制器认不认这排触发器(点一次再切回来) ----
// 这里读的是**计算样式**,不只是类名:窗格的 display 由站点的"文档基线"提供,
// 类名对了而 CSS 掉了的话,面板会全部堆叠 -- 那正是这一条要抓的.
const tabSwitch = await cdp.eval(`(async () => {
    const click = (href) => document.querySelector('a[href="' + href + '"]').click();
    // 等淡入走完(.show 是下一帧才补上的),否则读到 opacity 还停在 0
    const settle = () => new Promise((r) => setTimeout(() => requestAnimationFrame(() => r()), 350));
    const pane = (id) => {
      const el = document.querySelector('#' + id);
      const cs = getComputedStyle(el);
      return { active: el.classList.contains('active'), show: el.classList.contains('show'),
               display: cs.display, opacity: cs.opacity };
    };
    const active = (href) => document.querySelector('a[href="' + href + '"]').classList.contains('active');
    // OLED 数据区在真引擎里的样子:合并之后只有一颗库编辑器,高度由本站令牌定,
    // 复制 / 导入 / 折叠三颗按钮住在工具区那一排(这几件事进程内单测只能验类名与
    // 结构,"定高真的落地了""展开后真的放得下 70 行"要真级联 + 真布局才算数).
    const editorFacts = () => {
      const editor = document.querySelector('#oled .code-editor');
      const textarea = editor ? editor.querySelector('textarea') : null;
      const cs = textarea ? getComputedStyle(textarea) : null;
      // 可见正文行数 = (textarea 内容盒高度) / 行高;clientHeight 含上下 padding
      const content = textarea && cs
        ? textarea.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
        : 0;
      return {
        height: editor ? getComputedStyle(editor).height : '没有编辑器',
        minHeight: editor ? getComputedStyle(editor).minHeight : '没有编辑器',
        lines: cs ? Math.round(content / parseFloat(cs.lineHeight)) : 0,
      };
    };
    const oledData = () => {
      const editors = [...document.querySelectorAll('#oled .code-editor')];
      const tools = document.querySelector('#oled .tools');
      const toggle = document.querySelector('#editor-toggle-btn');
      const collapsed = editorFacts();
      toggle.click();
      const expanded = editorFacts();
      const expandedText = toggle.textContent;
      const expandedAria = toggle.getAttribute('aria-expanded');
      toggle.click();
      const backToCollapsed = editorFacts();
      return {
        editors: editors.length,
        textareas: document.querySelectorAll('#oled .code-editor textarea').length,
        copyInTools: tools.contains(document.querySelector('#output-button')),
        importInTools: tools.contains(document.querySelector('#import-btn')),
        toggleInTools: tools.contains(toggle),
        collapsed,
        expanded,
        backToCollapsed,
        expandedText,
        expandedAria,
        collapsedText: toggle.textContent,
        collapsedAria: toggle.getAttribute('aria-expanded'),
      };
    };

    click('#oled');
    await settle();
    const afterOled = { oled: pane('oled'), home: pane('home'), link: active('#oled'), data: oledData() };
    click('#home');
    await settle();
    const afterHome = { home: pane('home'), oled: pane('oled') };
    return { afterOled, afterHome };
})()`);

// ---- 交互:导航条的"隐形 / 实底"(非 HOME 顶端隐形,滚动后实底;HOME 顶端隐形) ----
// 类的加减是进程内单测抓不到的那一半:IO 的 rootMargin,scroll 事件,以及"切标签页后
// 首屏隐藏,由 scrollY 那条判据接管"都只有在真引擎里跑一遍才算数.
const headerState = await cdp.eval(`(async () => {
    const header = document.querySelector('header.site-header');
    const click = (href) => document.querySelector('a[href="' + href + '"]').click();
    // 等两帧:class 的切换发生在 IO 回调 / scroll 回调里,写进去之后要等一次重绘
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // behavior: 'instant' 必须写:站点样式里没有 smooth 了,但用默认行为滚动仍可能被
    // 浏览器/扩展的偏好接管,读到的会是动画刚起步的那一两个像素.
    const scrollTo = (y) => window.scrollTo({ top: y, behavior: 'instant' });
    const over = () => header.classList.contains('is-over-hero');
    click('#setting');
    scrollTo(0);
    await nextFrame();
    const settingTop = over();
    scrollTo(400);
    await nextFrame();
    const settingScrolled = over();
    click('#home');
    scrollTo(0);
    await nextFrame();
    const homeTop = over();
    return { settingTop, settingScrolled, homeTop };
})()`);

// ---- 交互:IEEE754 的精度菜单(库的折叠菜单,不再是 <select>) ----
// 开合靠库的 Popover(类名 + display 两条都要真渲染),选中要能改当前项 / 触发按钮
// 文案 / 位图位数,点外部要能收起来 -- 这几件事进程内 DOM 都验不了.
const formatMenu = await cdp.eval(`(async () => {
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const click = (href) => document.querySelector('a[href="' + href + '"]').click();
    click('#ieee754');
    await nextFrame();
    const trigger = document.querySelector('#ieee-format');
    const panel = document.querySelector('.menu-anchor .menu-popover');
    const items = [...document.querySelectorAll('.menu-anchor .menu-item')];
    const bits = () => document.querySelectorAll('#ieee-bits .ieee-bit').length;
    const activeIndex = () => items.findIndex((item) => item.classList.contains('is-active'));
    // 菜单项自己的文案(主文案 + 行右小字):触发按钮该跟着当前项走,所以拿它当基准,
    // 不在这里再抄一份 config 里的字符串
    const labels = items.map((item) => item.querySelector('code')?.textContent);
    const hints = items.map((item) => item.querySelector('.menu-item-hint')?.textContent);
    const before = { text: trigger.textContent, bits: bits(), expanded: trigger.getAttribute('aria-expanded'), active: activeIndex(), labels, hints };
    trigger.click();
    await nextFrame();
    const opened = { isOpen: panel.classList.contains('is-open'), display: getComputedStyle(panel).display };
    items[0].click(); // 选第一项(单精度):位数应从 64 变 32,当前项与按钮文案跟着走
    await nextFrame();
    const after = { text: trigger.textContent, bits: bits(), expanded: trigger.getAttribute('aria-expanded'), active: activeIndex() };
    trigger.click();
    await nextFrame();
    document.body.click(); // 点浮层外部:库的 Popover 该把它收起来
    await nextFrame();
    const outsideClosed = !panel.classList.contains('is-open');
    // 复位到默认精度(f64),后面的检查不受这次交互影响
    trigger.click();
    await nextFrame();
    items[1].click();
    await nextFrame();
    const resetBits = bits();
    click('#home');
    return { before, opened, after, outsideClosed, resetBits };
})()`);

// ---- 时钟是不是真的在走(每秒重绘) ----
const clockTick = await cdp.eval(`(async () => {
    const c = document.querySelector('#time_canvas');
    const snap = () => c.toDataURL();
    const a = snap();
    await new Promise((r) => setTimeout(r, 1300));
    return { changed: a !== snap() };
})()`);

let failed = 0;
for (const item of report) {
    if (!item.pass) failed++;
    console.log(`${item.pass ? '  ok  ' : ' FAIL '} ${item.name}${item.extra ? `  [${item.extra}]` : ''}`);
}
// 下面这几条断言跟着交互结果就地算, 不属于页面内的 report; 单独计数, 让最后的
// 总数是数出来的, 而不是把条数写死.
let adHocTotal = 0;
const adHoc = (pass) => { adHocTotal++; if (!pass) failed++; };
// 窗格的不透明档位由令牌 --tab-pane-opacity 给(SETTING 里那条滑块可改它,默认 0.9),
// 所以这里按**数**比, 不能写死 '1': 前者是"窗格真的落在令牌那一档",后者早已不是契约.
const paneOpacity = Number(await cdp.eval(
    `getComputedStyle(document.documentElement).getPropertyValue('--tab-pane-opacity')`));
// 切过去的窗格必须真的"上屏且落在令牌那一档",切走的必须真的 display: none --
// 只对类名就会漏掉"类名对了但 CSS 掉了,六个窗格一起堆叠"这种最坏的静默失效.
const shownOk = (pane) => pane?.active === true && pane?.show === true &&
    pane?.display === 'block' && Math.abs(Number(pane?.opacity) - paneOpacity) < 1e-6;
const hiddenOk = (pane) => pane?.active === false && pane?.show === false && pane?.display === 'none';
const tabOk = shownOk(tabSwitch?.afterOled?.oled) && tabSwitch?.afterOled?.link === true &&
    hiddenOk(tabSwitch?.afterOled?.home) &&
    shownOk(tabSwitch?.afterHome?.home) && hiddenOk(tabSwitch?.afterHome?.oled);
console.log(`${tabOk ? '  ok  ' : ' FAIL '} 点标签页能切窗格(站点自己的控制器认下这排触发器,` +
    `切过去的 window 真的 display: block + opacity 落在 --tab-pane-opacity 那一档,切走的 display: none)`);
adHoc(tabOk);
// OLED 数据区:一颗编辑器 + 真 textarea;折叠态 = 150px(也是最小高度),
// 点一下"展开编辑器"变 1366px(70 行,算式见 public/css/tokens.css),再点一下回到 150px;
// 复制 / 导入 / 折叠三颗按钮都在 .tools 里
const oledData = tabSwitch?.afterOled?.data;
const oledDataOk = oledData?.editors === 1 && oledData?.textareas === 1 &&
    oledData?.copyInTools === true && oledData?.importInTools === true &&
    oledData?.toggleInTools === true &&
    oledData?.collapsed?.height === '150px' && oledData?.collapsed?.minHeight === '150px' &&
    oledData?.expanded?.height === '1366px' && oledData?.expanded?.lines === 70 &&
    oledData?.backToCollapsed?.height === '150px' &&
    oledData?.expandedText === '折叠编辑器' && oledData?.expandedAria === 'true' &&
    oledData?.collapsedText === '展开编辑器' && oledData?.collapsedAria === 'false';
console.log(`${oledDataOk ? '  ok  ' : ' FAIL '} OLED 数据区只有一颗编辑器,可折叠 / 展开` +
    `(折叠 150px(含 min-height)= 展开 1366px / 70 行,按钮文案与 aria-expanded 跟着切;` +
    `实得 ${JSON.stringify(oledData)})`);
adHoc(oledDataOk);
const headerOk = headerState?.settingTop === true && headerState?.settingScrolled === false &&
    headerState?.homeTop === true;
console.log(`${headerOk ? '  ok  ' : ' FAIL '} 导航条隐形/实底正确` +
    `(非 HOME 顶端隐形,滚动后实底,HOME 顶端隐形;实得 ${JSON.stringify(headerState)})`);
adHoc(headerOk);
const formatMenuOk = formatMenu?.before?.bits === 64 && formatMenu?.before?.expanded === 'false' &&
    formatMenu?.before?.active === 1 && formatMenu?.before?.hints?.join('/') === '单精度/双精度' &&
    formatMenu?.before?.text === formatMenu?.before?.labels?.[1] &&
    formatMenu?.opened?.isOpen === true && formatMenu?.opened?.display === 'block' &&
    formatMenu?.after?.bits === 32 && formatMenu?.after?.active === 0 &&
    formatMenu?.after?.expanded === 'false' &&
    formatMenu?.after?.text === formatMenu?.before?.labels?.[0] &&
    formatMenu?.outsideClosed === true && formatMenu?.resetBits === 64;
console.log(`${formatMenuOk ? '  ok  ' : ' FAIL '} IEEE754 精度菜单可开合,可切换(64->32 位),行右小字是汉语名词,点外部关闭` +
    `(实得 ${JSON.stringify(formatMenu)})`);
adHoc(formatMenuOk);
console.log(`${clockTick?.changed ? '  ok  ' : ' FAIL '} 时钟每秒重绘`);
adHoc(clockTick?.changed);

console.log(`\n共 ${report.length + adHocTotal} 项,失败 ${failed} 项`);
console.log('(结构/类名/文案契约由 `npm test` 的 happy-dom 单测覆盖,这里不重复)');
console.log(`\n页面 console(${cdp.logs.length} 条):`);
for (const log of cdp.logs.slice(0, 12)) console.log('  ' + log);
console.log(`未捕获异常(${cdp.errors.length} 条):`);
for (const error of cdp.errors.slice(0, 5)) console.log('  ' + error);

chrome.kill('SIGKILL');
srv.close();
process.exit(failed === 0 && cdp.errors.length === 0 ? 0 : 1);
