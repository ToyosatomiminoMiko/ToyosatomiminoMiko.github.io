/**
 * 真浏览器脚本共用的基础设施:静态服务器 + headless Chromium 启动 + 极简 CDP 客户端.
 *
 * 为什么单独一层:`scripts/smoke_home.mjs`(首页验收)与 `scripts/perf/451.mjs`(性能台)
 * 都要做同一条链路 -- "起一个只服务 dist/ 的静态服务器 -> 启 headless chromium ->
 * 用 CDP 驱动页面".这一套曾经在两个脚本里各写一份(serve / Cdp / chromium 开关),
 * 已经出现分叉(一处有路径穿越检查,另一处没有);抽到这里之后,两边只剩
 * "各自看什么,断言什么".
 *
 * 只用 node 自带能力(内置 http 与全局 WebSocket,node 22+),不引 npm 包.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** 静态服务器按扩展名给出的 content-type(两个脚本用到的合集) */
export const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
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
    '.txt': 'text/plain; charset=utf-8',
};

/**
 * 起一个只服务 `dist/` 的静态服务器(URL 与线上同构),返回监听中的 server.
 *
 * 三条口径:
 *   - 以 `/` 结尾的请求补 `index.html`(目录请求);
 *   - 路径归一化后必须仍在 dist 内,越界一律 403(路径穿越不能靠"读不到"兜底);
 *   - 读不到(不存在 / 是目录 / 权限不足)一律 404,不把服务器错误混进去.
 *
 * @param {{ dist: string, port: number }} options
 */
export function startStaticServer({ dist, port }) {
    const srv = createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
            let rel = decodeURIComponent(url.pathname);
            if (rel.endsWith('/')) rel += 'index.html';
            const file = join(dist, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
            if (!file.startsWith(dist)) {
                res.writeHead(403).end('forbidden');
                return;
            }
            let body;
            try {
                body = await readFile(file);
            } catch {
                if (!res.headersSent) res.writeHead(404).end('not found');
                return;
            }
            if (res.headersSent) return;
            res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
            res.end(body);
        } catch {
            if (!res.headersSent) { try { res.writeHead(404).end('not found'); } catch { /* 连接已断开 */ } }
        }
    });
    return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve(srv)));
}

/**
 * 启动 headless Chromium,交回子进程(调用方负责 kill).
 *
 * 只写两边**一样**的开关;GPU 相关的差异(首页验收要 `--disable-gpu` 走回退,
 * 451 性能台要软件 Vulkan 跑 WebGPU)由调用方用 `extraArgs` 传,不在这里熔成一份.
 *
 * @param {object} options
 * @param {number} options.cdpPort  远程调试端口
 * @param {string} options.profile  用户目录(系统临时目录下的一次性垃圾)
 * @param {string} [options.windowSize]  `宽,高`,默认 1280,900
 * @param {string[]} [options.extraArgs] 追加开关(排在公共开关之后)
 */
export function launchChromium({ cdpPort, profile, windowSize = '1280,900', extraArgs = [] }) {
    return spawn('chromium-browser', [
        '--headless=new', `--remote-debugging-port=${cdpPort}`, '--remote-allow-origins=*',
        '--no-sandbox', '--disable-dev-shm-usage', `--user-data-dir=${profile}`, '--no-first-run',
        `--window-size=${windowSize}`, '--force-device-scale-factor=1',
        ...extraArgs, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
}

/**
 * 极简 CDP 客户端:只用 node 自带的 WebSocket,不引 puppeteer 之类的依赖.
 *
 * 两处刻意的取舍:
 *   - console / 未捕获异常**总是**收集进 `logs` / `errors`(两个脚本都要看),
 *     额外的一次性回调走 `onLog`(性能台按场景收集页面日志用);
 *   - `Runtime.evaluate` 的异常有两种消费口径,所以分成两个方法:
 *     验收脚本要异常详情(`evalValue` 交回 `{ __err, description }`),
 *     性能台只要一行可读结论(`evalOrError` 交回 `'ERR:...'`).
 *     合成一个会逼其中一个改断言口径,那不是去重该付的代价.
 */
export class Cdp {
    constructor(ws) {
        this.ws = ws;
        this.id = 0;
        this.pending = new Map();
        this.waiters = new Map();
        this.logs = [];
        this.errors = [];
        this.onLog = null;
        ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && this.pending.has(msg.id)) {
                this.pending.get(msg.id)(msg);
                this.pending.delete(msg.id);
                return;
            }
            if (msg.method === 'Runtime.consoleAPICalled') {
                const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
                this.logs.push(`${msg.params.type}: ${text}`);
                this.onLog?.(`console: ${text}`);
            }
            if (msg.method === 'Runtime.exceptionThrown') {
                this.errors.push(msg.params.exceptionDetails.text + ' :: ' +
                    (msg.params.exceptionDetails.exception?.description ?? ''));
            }
            const waiting = this.waiters.get(msg.method);
            if (waiting?.length) waiting.shift()(msg.params);
        });
    }

    /** 连上已经起来的 chromium:先等调试端口,再挑一个 page 目标开 WebSocket */
    static async connect(port) {
        for (let i = 0; i < 80; i++) {
            try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(250); }
        }
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((target) => target.type === 'page');
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve) => ws.addEventListener('open', resolve));
        return new Cdp(ws);
    }

    send(method, params = {}) {
        return new Promise((resolve) => {
            const id = ++this.id;
            this.pending.set(id, resolve);
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    /** 等下一次 `method` 事件(如 `Tracing.tracingComplete`) */
    once(method) {
        return new Promise((resolve) => {
            if (!this.waiters.has(method)) this.waiters.set(method, []);
            this.waiters.get(method).push(resolve);
        });
    }

    /** 求值并交回值;页面里抛错时交回 `{ __err, description }`(不掩盖错误详情) */
    async evalValue(expression) {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        const exception = r.result?.exceptionDetails;
        if (exception) {
            return { __err: exception.text, description: exception.exception?.description ?? '' };
        }
        return r.result?.result?.value;
    }

    /** 求值并交回值;页面里抛错时交回 `'ERR:<text>'`(性能台只要一行结论) */
    async evalOrError(expression) {
        const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.result?.exceptionDetails) return `ERR:${r.result.exceptionDetails.text}`;
        return r.result?.result?.value;
    }
}
