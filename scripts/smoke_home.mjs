/**
 * 首页的**真浏览器**验收(端到端,只做进程内单测做不到的那部分).
 *
 * 分工(两边不重叠):
 *
 *   - **标记长什么样** -> `src/**\/*.test.ts`(vitest + happy-dom,进程内,`npm test` 里跑):
 *     标签名 / 类名 / id / data-* 属性 / 文案 / 结构与 CSS 选择器是否对得上.
 *     那层覆盖了骨架与四块面板的全部结构契约(含 data-bs-toggle 这类属性写法).
 *   - **在真浏览器里能不能用** -> 本脚本:canvas 真的画出来了吗,bootstrap 真的认这排
 *     标签吗,`getComputedStyle` 下布局对不对,生成出来的宿主与地铁车窗组件是否接上了.
 *
 * 为什么要留下这一层:进程内 DOM 没有像素,没有布局,没有真实 CSS 级联与 bootstrap 的
 * 事件委托,happy-dom 里 `getContext('2d')` 也是空的 -- 上面那几件事只有在真引擎里才成立.
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
        ok('五个标签页窗格都在', ['home','oled','rbt','ieee754','setting'].every((id) => q('#' + id)));
        ok('首屏与首屏底部的两个宿主都在', q('#hero .hero__bottom > #app_led_clock') !== null && q('#hero .hero__bottom > #metro-styles') !== null);

        /*
          ---- 第 1 组:宿主交回 + 组件接管(真集成) ----
          骨架按 MOUNT_IDS 建宿主并把引用交给 main.ts,这里验证地铁车窗组件真的
          把四块标记长进了那些宿主(修饰类由组件补,面板由组件生成).
        */
        ok('车窗舞台宿主拿到了组件的修饰类', q('#metro-window')?.classList.contains('metro-window--stage') === true);
        ok('风格按钮长进了首屏宿主(3 颗 data-style)', qa('#metro-styles > .style-row button[data-style]').length === 3);
        ok('控制台长进了 SETTING 宿主(fieldset + 7 条滑块)',
            q('#metro-params > fieldset.sliders') !== null && qa('#metro-params input.slider-range').length === 7,
            qa('#metro-params input.slider-range').length + ' 条');
        ok('上传面板四层各一个 file input', qa('#metro-uploads input[type=file]').length === 4);

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

        // OLED:构造时把画布铺成白色底(证明 OLEDCanvas 真的建起来了)
        let oledWhite = -1;
        try {
            const d = q('#pixelCanvas').getContext('2d').getImageData(0, 0, 1, 1).data;
            oledWhite = d[0] + d[1] + d[2];
        } catch (e) { oledWhite = -1; }
        ok('OLED 画布已初始化(左上角白底)', oledWhite === 765, oledWhite);

        // 红黑树:示例树真的被解析并画出了红节点
        const tree = q('#rbCanvas');
        let redPixels = 0;
        try {
            const d = tree.getContext('2d').getImageData(0, 0, tree.width, tree.height).data;
            for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) { redPixels++; if (redPixels > 200) break; } }
        } catch (e) { redPixels = -1; }
        ok('红黑树真的画出来了(有红色节点)', redPixels > 200, redPixels + ' 个红像素(采样到上限即停)');

        // IEEE754:初始那次渲染真的跑完了(位图 64 格 + KaTeX 公式 + 特殊值表)
        ok('IEEE754 初始渲染跑完(位图 64 格 + KaTeX + 特殊值表)',
            qa('#ieee-bits .ieee-bit').length === 64 && q('#ieee-formula .katex') !== null &&
            qa('#ieee-special .ieee-special-table tbody tr').length > 0);

        /*
          ---- 第 3 组:布局与 CSS 级联(进程内 DOM 没有布局,只能在这里验) ----
        */
        ok('背景列表真的包住了浮动子项(.bgul 的 flow-root 生效,不再压住下面的控制台)',
            getComputedStyle(q('ul.bgul')).display === 'flow-root');
        ok('导航条是脱离文档流的固定条(position: fixed)',
            getComputedStyle(q('header.site-header')).position === 'fixed');
        ok('首屏铺满视口高度(hero 的 100dvh 令牌生效)',
            q('#hero').getBoundingClientRect().height > 200,
            Math.round(q('#hero').getBoundingClientRect().height) + 'px');

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

// ---- 交互:bootstrap 的 data-api 认不认生成的标签栏(点一次再点回来) ----
const tabSwitch = await cdp.eval(`(() => {
    const click = (href) => document.querySelector('a[href="' + href + '"]').click();
    click('#oled');
    const afterOled = { oled: document.querySelector('#oled').classList.contains('active'),
                        home: document.querySelector('#home').classList.contains('active'),
                        link: document.querySelector('a[href="#oled"]').classList.contains('active') };
    click('#home');
    const afterHome = { home: document.querySelector('#home').classList.contains('active'),
                        oled: document.querySelector('#oled').classList.contains('active') };
    return { afterOled, afterHome };
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
const tabOk = tabSwitch?.afterOled?.oled && tabSwitch?.afterOled?.link && !tabSwitch?.afterOled?.home &&
    tabSwitch?.afterHome?.home && !tabSwitch?.afterHome?.oled;
console.log(`${tabOk ? '  ok  ' : ' FAIL '} 点标签页能切窗格(生成的标签栏被 bootstrap 认下,再切回来也对)`);
if (!tabOk) failed++;
console.log(`${clockTick?.changed ? '  ok  ' : ' FAIL '} 时钟每秒重绘`);
if (!clockTick?.changed) failed++;

console.log(`\n共 ${report.length + 2} 项,失败 ${failed} 项`);
console.log('(结构/类名/文案契约由 `npm test` 的 happy-dom 单测覆盖,这里不重复)');
console.log(`\n页面 console(${cdp.logs.length} 条):`);
for (const log of cdp.logs.slice(0, 12)) console.log('  ' + log);
console.log(`未捕获异常(${cdp.errors.length} 条):`);
for (const error of cdp.errors.slice(0, 5)) console.log('  ' + error);

chrome.kill('SIGKILL');
srv.close();
process.exit(failed === 0 && cdp.errors.length === 0 ? 0 : 1);
