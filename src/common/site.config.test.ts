/*
站点骨架声明式模型的回归网.

与 site.config.ts 同一个目录,断言全是**纯数据**(不碰 DOM,也不需要 wasm 产物):

  - 导航项:窗格 id 唯一(它们同时是标签 href 的锚点,窗格 id,以及三个模块的宿主),
    默认激活项必须在清单里;
  - 宿主 id:全部唯一,且不与任何标签页 id 撞车 -- 同一份文档里两个元素共用一个 id
    不会报错,只会让 CSS 与自动化定位指到"另一个"元素上,是最难查的一类静默失效;
  - 背景清单:非空,地址都落在站点静态资源根 public/ 下(URL 与目录同构的那条不变量).

骨架**结构**本身不在这里断言:那是 site_shell.ts 的事,这里只保证它读到的数据合法.
*/
import { describe, expect, it } from 'vitest';

import {
    BACKGROUND_PRESETS,
    DEFAULT_NAV_PANE,
    HERO_ID,
    NAV_HEIGHT_FALLBACK,
    NAV_ITEMS,
    SITE_BRAND_TEXT,
    SITE_HOST_IDS,
    SITE_ROOT_ID,
} from './site.config';

describe('站点骨架:导航项', () => {
    it('窗格 id 与文案都非空,且 id 唯一', () => {
        const panes = NAV_ITEMS.map((item) => item.pane);
        expect(new Set(panes).size).toBe(panes.length);
        for (const item of NAV_ITEMS) {
            // id 会被写进 href="#<pane>",带空格 / # 的 id 会把锚点切坏
            expect(item.pane, item.pane).toMatch(/^[A-Za-z][\w-]*$/);
            expect(item.label.length, item.pane).toBeGreaterThan(0);
        }
    });

    it('默认激活项是清单里的某一项', () => {
        expect(NAV_ITEMS.some((item) => item.pane === DEFAULT_NAV_PANE)).toBe(true);
    });

    it('站名非空(它压在首屏画面上时是唯一的站点身份)', () => {
        expect(SITE_BRAND_TEXT.length).toBeGreaterThan(0);
    });
});

describe('站点骨架:宿主 id', () => {
    const hostIds = Object.values(SITE_HOST_IDS);

    it('宿主 id 都非空且唯一', () => {
        for (const id of hostIds) {
            expect(id.length).toBeGreaterThan(0);
        }
        expect(new Set(hostIds).size).toBe(hostIds.length);
    });

    it('宿主 id 不与标签页 id / 骨架宿主 id 撞车', () => {
        // 撞车的后果是**静默**的:CSS 与 document.getElementById 会命中先出现的那个,
        // 于是某个模块的标记长进了别人的宿主,界面看着"少了点什么"却不报错.
        const reserved = new Set<string>([
            SITE_ROOT_ID,
            HERO_ID,
            ...NAV_ITEMS.map((item) => item.pane),
        ]);
        for (const id of hostIds) {
            expect(reserved.has(id), id).toBe(false);
        }
    });
});

describe('站点骨架:背景缩略图清单', () => {
    it('非空,名字非空,地址唯一且都在 /images/bgimg/ 下', () => {
        expect(BACKGROUND_PRESETS.length).toBeGreaterThan(0);
        const sources = BACKGROUND_PRESETS.map((preset) => preset.src);
        expect(new Set(sources).size).toBe(sources.length);
        for (const preset of BACKGROUND_PRESETS) {
            // 站点只有一个静态资源根 public/ 且"目录层级 == 线上 URL",
            // 所以背景图必须是 /images/bgimg/ 下的绝对路径.
            expect(preset.src, preset.label).toMatch(/^\/images\/bgimg\/[\w.-]+$/);
            expect(preset.label.length, preset.src).toBeGreaterThan(0);
        }
    });
});

describe('站点骨架:导航条高度回退值', () => {
    it('是正数(读不到 --nav-height 令牌时它要能算出 rootMargin)', () => {
        expect(NAV_HEIGHT_FALLBACK).toBeGreaterThan(0);
    });
});
