/**
 * 451 页的性能测试台.
 *
 * 起一个静态服务器指向 dist/, 再用 headless Chromium + CDP 采样, 输出三块数据:
 *
 *   A) 页内 rAF 帧间隔(FPS / p50 / p95) -- 用户能感知的流畅度
 *   B) 整棵 Chromium 进程树的 CPU 秒 / 帧  -- 直接对应"风扇转速", 与帧率高低无关
 *   C) Tracing 自耗时(按进程 x 事件名)    -- 光栅/合成到底花在哪
 *
 * 为什么不用 Page.getMetrics 的 ScriptDuration 下结论:
 * 451 的粒子和合成都跑在 GPU 上, 主线程本来就该是空的; 页面发烫时它依然只有百分之几.
 * 真正要盯的是 B 和 C -- 这个脚本存在的理由就是当初那个误导性的 18ms.
 *
 * 用法:
 *   npm run build          # 必须先有 dist/
 *   node scripts/perf/451.mjs [场景...]        # 缺省跑全部场景
 *   WIN=420,300 node scripts/perf/451.mjs       # 换窗口尺寸
 *
 * 环境要求(Linux): chromium 可执行文件 + 能用的软件 Vulkan(swiftshader / lavapipe).
 * 没有真实 GPU 也能跑 -- 页面上层全是 CSS 与合成, 归因依然成立, 只是绝对值偏大.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DIST = join(ROOT, 'dist');
const PROFILE = join(ROOT, '.scratch-451perf-profile');

const PORT = 8781;
const CDP_PORT = 9711;
const WALL_MS = 6000;
const TRACE_MS = 3000;
const [WIN_W, WIN_H] = (process.env.WIN ?? '800,600').split(',').map(Number);
const PAGE_URL = `http://127.0.0.1:${PORT}/4xx_page/451.html`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

/** 场景 = 在页面里再注入一段 JS(用来成对地关掉某个嫌疑项, 做 A/B) */
const SCENARIOS = {
  baseline: { desc: '原样', js: `return 'as-is';` },
  uncapped: {
    desc: '解除帧率上限(高刷屏上才有区别)',
    js: `if (!window.__ember) return 'no engine'; window.__ember.maxFps = 0; return 'ok';`,
  },
  'no-canvas': {
    desc: '停掉粒子画布, 其余 CSS 动画保留',
    js: `try { window.__ember && window.__ember.dispose({ keepCanvas: true }); } catch (e) {}
         const c = document.getElementById('emberCanvas'); if (c) c.style.display = 'none';
         return 'ok';`,
  },
  'no-backdrop': {
    desc: '禁全部 backdrop-filter',
    js: `const s = document.createElement('style');
         s.textContent = '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}';
         document.head.appendChild(s); return 'ok';`,
  },
  'no-anim': {
    desc: '禁全部 CSS animation',
    js: `const s = document.createElement('style'); s.textContent = '*{animation:none!important}';
         document.head.appendChild(s); return 'ok';`,
  },
  static: {
    desc: '停画布 + 禁动画 + 禁 backdrop(近静态页)',
    js: `try { window.__ember && window.__ember.dispose({ keepCanvas: true }); } catch (e) {}
         const c = document.getElementById('emberCanvas'); if (c) c.style.display = 'none';
         const s = document.createElement('style');
         s.textContent = '*{backdrop-filter:none!important;animation:none!important;transition:none!important}';
         document.head.appendChild(s); return 'ok';`,
  },
  blank: { desc: 'about:blank(噪声地板)', url: 'about:blank', js: `return 'n/a';` },
};

function serve() {
  const srv = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = join(DIST, normalize(p).replace(/^(\.\.[/\\])+/, ''));
      let ok = existsSync(file);
      if (ok) {
        // 目录不能直接 readFile
        try { readFileSync(file); } catch { ok = false; }
      }
      if (!ok) {
        if (!res.headersSent) res.writeHead(404).end('not found');
        return;
      }
      const body = await readFile(file);
      if (res.headersSent) return;
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      if (!res.headersSent) { try { res.writeHead(500).end('error'); } catch { /* ignore */ } }
    }
  });
  return new Promise((r) => srv.listen(PORT, '127.0.0.1', () => r(srv)));
}

// ------------------------------------------------------- 进程树 CPU 采样
function chromePids() {
  const pids = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8');
      if (cmd.includes(PROFILE) || cmd.includes(`remote-debugging-port=${CDP_PORT}`)) pids.push(d);
    } catch { /* 进程已退出 */ }
  }
  return pids;
}

/** 整棵进程树的 CPU 秒(utime + stime, 含已回收子进程) */
function cpuSeconds(pids) {
  let ticks = 0;
  for (const pid of pids) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      ticks += Number(rest[11]) + Number(rest[12]) + Number(rest[13]) + Number(rest[14]);
    } catch { /* 退出 */ }
  }
  return ticks / 100; // USER_HZ
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.waiters = new Map(); this.onLog = null;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); }
      else if (msg.method) {
        if (this.onLog && msg.method === 'Runtime.consoleAPICalled') {
          this.onLog(`console: ${msg.params.args.map((x) => x.value ?? x.description ?? x.type).join(' ')}`);
        }
        const w = this.waiters.get(msg.method);
        if (w?.length) w.shift()(msg.params);
      }
    });
  }
  once(method) {
    return new Promise((res) => {
      if (!this.waiters.has(method)) this.waiters.set(method, []);
      this.waiters.get(method).push(res);
    });
  }
  send(method, params = {}) {
    return new Promise((res) => {
      const id = ++this.id;
      this.pending.set(id, res);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return `ERR:${r.result.exceptionDetails.text}`;
    return r.result?.result?.value;
  }
}

async function connect(port) {
  for (let i = 0; i < 80; i++) {
    try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(250); }
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  return new Cdp(ws);
}

/** 按 (pid,tid) 先算事件自耗时(= dur - 子事件 dur 之和), 再按 进程名 x 事件名 聚合 */
function selfTimes(events) {
  const procName = new Map();
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'process_name') procName.set(e.pid, e.args?.name ?? `pid${e.pid}`);
  }
  const byThread = new Map();
  for (const e of events) {
    if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
    const key = `${e.pid}:${e.tid}`;
    if (!byThread.has(key)) byThread.set(key, []);
    byThread.get(key).push(e);
  }
  const out = new Map();
  for (const [key, list] of byThread) {
    list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    const stack = [];
    for (const e of list) {
      while (stack.length && e.ts >= stack[stack.length - 1].ts + stack[stack.length - 1].dur) {
        const d = stack.pop(); d.self = d.dur - d.child;
      }
      for (const p of stack) p.child += e.dur;
      e.child = 0; stack.push(e);
    }
    while (stack.length) { const d = stack.pop(); d.self = d.dur - d.child; }
    for (const e of list) {
      const k = `${procName.get(Number(key.split(':')[0])) ?? 'pid'} · ${e.name}`;
      const cur = out.get(k) ?? { self: 0, count: 0 };
      cur.self += e.self; cur.count++;
      out.set(k, cur);
    }
  }
  return out;
}

/** 这些是"容器型"事件, 自耗时里的绝大部分属于子事件, 混进排行只会挤掉有用的行 */
const NOISE = /^(Profile|ProfileChunk|TracingStartedInBrowser|thread_name|process_name|MessageLoop::RunTask|RunTask|ThreadControllerImpl::RunTask|ThreadPool_RunTask|TaskQueueManager::ProcessTask|SequenceManager::PerformTasks|Scheduler::RunTask)$/;

function reportTracing(events, windowMs) {
  return [...selfTimes(events).entries()]
    .filter(([n, v]) => !NOISE.test(n.split(' · ')[1]) && v.self > windowMs * 1000 * 0.006)
    .sort((a, b) => b[1].self - a[1].self)
    .slice(0, 16)
    .map(([n, v]) => ({
      name: n,
      self_ms: +(v.self / 1000).toFixed(1),
      'cpu%': +((v.self / 1000 / windowMs) * 100).toFixed(1),
      n: v.count,
    }));
}

// ------------------------------------------------------------------- 主流程
const wanted = process.argv.slice(2).filter((a) => SCENARIOS[a]);
const scenarios = wanted.length ? wanted : Object.keys(SCENARIOS);

if (!existsSync(join(DIST, '4xx_page', '451.html'))) {
  console.error('dist/4xx_page/451.html 不存在, 先跑 npm run build');
  process.exit(1);
}

const srv = await serve();
rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn('chromium-browser', [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*',
  '--no-sandbox', '--disable-dev-shm-usage', `--user-data-dir=${PROFILE}`, '--no-first-run',
  '--disable-gpu-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan',
  '--use-angle=vulkan', '--use-vulkan=swiftshader',
  `--window-size=${WIN_W},${WIN_H}`, '--force-device-scale-factor=1', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });

const cdp = await connect(CDP_PORT);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Performance.enable');

/** 打开页面并等 data-ember 上报; 软件适配器首次编译管线很慢, 所以必须先热身一次 */
async function loadAndWait(url) {
  await cdp.send('Page.navigate', { url });
  await sleep(1200);
  let status = 'n/a';
  for (let i = 0; i < 120; i++) {
    status = await cdp.eval(`document.documentElement.dataset.ember ?? 'n/a'`);
    if (status !== 'n/a') break;
    await sleep(500);
  }
  return status;
}

console.log(`窗口 ${WIN_W}x${WIN_H} | 场景: ${scenarios.join(', ')}`);
console.log('热身(让着色器缓存落地, 否则第一轮必然 init-timeout):', await loadAndWait(PAGE_URL));

const results = [];
for (const name of scenarios) {
  const sc = SCENARIOS[name];
  const logs = [];
  cdp.onLog = (m) => logs.push(m);

  let status = '(非 451 页)';
  if (sc.url) {
    await cdp.send('Page.navigate', { url: sc.url });
    await sleep(1500);
  } else {
    status = await loadAndWait(PAGE_URL);
  }
  console.log(`\n===== ${name} (${sc.desc}) =====`);
  console.log('data-ember:', status, '| 页面日志:', logs.slice(0, 3).join(' / ') || '(无)');

  console.log('注入:', await cdp.eval(`(() => { ${sc.js} })()`));
  await sleep(1000);
  await cdp.eval(`
    window.__probe = { frames: [], last: performance.now(), longTasks: [] };
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__probe.longTasks.push(e.duration); })
        .observe({ entryTypes: ['longtask'] });
    } catch (e) {}
    window.__probe.raf = (t) => {
      window.__probe.frames.push(t - window.__probe.last);
      window.__probe.last = t;
      window.__probe.id = requestAnimationFrame(window.__probe.raf);
    };
    window.__probe.id = requestAnimationFrame(window.__probe.raf);
    'ok'
  `);

  // ---- 阶段 A: 不开 tracing, 量帧率 + 进程树 CPU ----
  const pids = chromePids();
  const cpu0 = cpuSeconds(pids);
  const m0 = (await cdp.send('Performance.getMetrics')).result.metrics;
  await sleep(WALL_MS);
  const m1 = (await cdp.send('Performance.getMetrics')).result.metrics;
  const cpu1 = cpuSeconds(pids);

  const stats = await cdp.eval(`(() => {
    cancelAnimationFrame(window.__probe.id);
    const f = window.__probe.frames.slice(3);
    if (!f.length) return { fps: 0, frames: 0 };
    const sorted = [...f].sort((a, b) => a - b);
    const sum = f.reduce((a, b) => a + b, 0);
    const lt = window.__probe.longTasks;
    return {
      fps: +(1000 / (sum / f.length)).toFixed(1),
      p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1),
      p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      frames: f.length,
      longTaskMs: +lt.reduce((a, b) => a + b, 0).toFixed(1),
    };
  })()`);

  const wall = WALL_MS / 1000;
  const pick = (m, k) => m.find((x) => x.name === k)?.value ?? 0;
  const perf = {
    cpu_pct: +(((cpu1 - cpu0) / wall) * 100).toFixed(0),
    // 关键归一化指标: 每产出 1 帧要烧多少 CPU 秒(与帧率高低无关)
    cpu_per_frame: stats.frames ? +((cpu1 - cpu0) / stats.frames).toFixed(2) : 0,
    task_pct: +(((pick(m1, 'TaskDuration') - pick(m0, 'TaskDuration')) / wall) * 100).toFixed(1),
    script_pct: +(((pick(m1, 'ScriptDuration') - pick(m0, 'ScriptDuration')) / wall) * 100).toFixed(1),
  };
  console.log('帧:', JSON.stringify(stats));
  console.log('CPU:', JSON.stringify(perf));

  // ---- 阶段 B: tracing 归因 ----
  const tracingDone = cdp.once('Tracing.tracingComplete');
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,blink,cc,viz,gpu,benchmark,disabled-by-default-devtools.timeline',
    transferMode: 'ReturnAsStream',
  });
  await sleep(TRACE_MS);
  await cdp.send('Tracing.end');
  const { stream } = await tracingDone;
  const chunks = [];
  for (;;) {
    const r = await cdp.send('IO.read', { handle: stream, size: 16 * 1024 * 1024 });
    chunks.push(r.result.data);
    if (r.result.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  const rows = reportTracing(JSON.parse(chunks.join('')).traceEvents, TRACE_MS);
  console.log('Tracing Top:');
  console.table(rows);

  results.push({ name, desc: sc.desc, ember: status, stats, perf, trace: rows });
}

console.log('\n\n########## 汇总 ##########');
console.table(results.map((r) => ({
  场景: r.name,
  ember: r.ember,
  frames: r.stats.frames,
  fps: r.stats.fps,
  'p50_ms': r.stats.p50,
  'p95_ms': r.stats.p95,
  'CPU%': r.perf.cpu_pct,
  'CPU秒/帧': r.perf.cpu_per_frame,
  '主线程task%': r.perf.task_pct,
  'script%': r.perf.script_pct,
})));
console.log('\n判读: 主线程 task%/script% 很小而 CPU秒/帧 很大 ⇒ 瓶颈在 GPU/合成器, 别去优化 JS.');

cdp.ws.close();
chrome.kill('SIGKILL');
srv.close();
process.exit(0);
