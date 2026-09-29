/*
SETTING 页声明式模型的回归网.

与 config.ts 同一个目录,断言基本是**纯数据**(不碰 DOM,也不需要 wasm 产物):

  - 三块设置组的 id:非空 / 唯一 / 合法,而且不与标签页 id 或骨架宿主 id 撞车
    -- 同一份文档里两个元素共用一个 id 不会报错,只会让 CSS 与自动化定位指到
    "另一个"元素上,是最难查的一类静默失效;
  - 背景清单:非空,地址都落在站点静态资源根 public/ 下(URL 与目录同构的那条
    不变量),名字非空;
  - 页面透明度的区间与步长自洽(初值在区间内,步长正数),
    且初值真的等于 public/css/tokens.css 里那条令牌(唯一一处读文件:这条是
    CSS 与 TS 的跨语言契约,两边不一致不会报错,只会"一拖滑块就跳值").

页面**结构**本身不在这里断言:那是 setting_page.ts 的事,这里只保证它读到的数据合法.
*/
import { describe, expect, it } from 'vitest';

import { HERO_ID, NAV_ITEMS, SITE_HOST_IDS, SITE_ROOT_ID } from '@/common/site.config';

import {
    BACKGROUND_IMAGE_VARIABLE,
    BACKGROUND_PRESETS,
    PAGE_OPACITY_DEFAULT,
    PAGE_OPACITY_MAX,
    PAGE_OPACITY_MIN,
    PAGE_OPACITY_STEP,
    PAGE_OPACITY_VARIABLE,
    SETTING_GROUP_CLASS,
    SETTING_GROUP_ID_LIST,
    SETTING_PANEL_TITLE,
} from './config';

describe('SETTING 页:三块设置组', () => {
    it('id 都非空,唯一,且是合法的 id 字面量', () => {
        for (const id of SETTING_GROUP_ID_LIST) {
            expect(id.length).toBeGreaterThan(0);
            expect(id, id).toMatch(/^[A-Za-z][\w-]*$/);
        }
        expect(new Set(SETTING_GROUP_ID_LIST).size).toBe(SETTING_GROUP_ID_LIST.length);
    });

    it('id 不与标签页 id / 骨架宿主 id 撞车', () => {
        // 撞车的后果是**静默**的:document.getElementById 只会命中先出现的那个,
        // 于是某个模块的内容长进了别人的容器,界面看着"少了点什么"却不报错.
        const reserved = new Set<string>([
            SITE_ROOT_ID,
            HERO_ID,
            ...NAV_ITEMS.map((item) => item.pane),
            ...Object.values(SITE_HOST_IDS),
        ]);
        for (const id of SETTING_GROUP_ID_LIST) {
            expect(reserved.has(id), id).toBe(false);
        }
    });

    it('组类名与面板标题非空(两者都是样式与文案的契约)', () => {
        expect(SETTING_GROUP_CLASS.length).toBeGreaterThan(0);
        expect(SETTING_PANEL_TITLE.length).toBeGreaterThan(0);
    });
});

describe('SETTING 页:背景缩略图清单', () => {
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

    it('承载"当前生效背景图"的令牌名非空(TS 与 CSS 的跨语言契约)', () => {
        expect(BACKGROUND_IMAGE_VARIABLE).toMatch(/^--[\w-]+$/);
    });
});

describe('SETTING 页:页面透明度口径', () => {
    it('区间 / 初值 / 步长自洽', () => {
        expect(PAGE_OPACITY_MIN).toBeLessThan(PAGE_OPACITY_MAX);
        expect(PAGE_OPACITY_STEP).toBeGreaterThan(0);
        expect(PAGE_OPACITY_DEFAULT).toBeGreaterThanOrEqual(PAGE_OPACITY_MIN);
        expect(PAGE_OPACITY_DEFAULT).toBeLessThanOrEqual(PAGE_OPACITY_MAX);
    });

    it('令牌名非空,且默认值必须与 public/css/tokens.css 的声明相等', async () => {
        // 这条是"不报错的静默失配"唯一的机械防线:CSS 那份是初值,JS 这份是重置目标,
        // 两边不一致的表现是"刚打开 0.9,拖一下滑块跳成另一个初值".
        expect(PAGE_OPACITY_VARIABLE).toMatch(/^--[\w-]+$/);
        const { readFile } = await import('node:fs/promises');
        const css = await readFile(
            new URL('../../public/css/tokens.css', import.meta.url),
            'utf8',
        );
        const declared = css.match(new RegExp(`${PAGE_OPACITY_VARIABLE}\\s*:\\s*([\\d.]+)`));
        expect(declared?.[1], 'public/css/tokens.css 里没有这条令牌').toBeDefined();
        expect(Number(declared?.[1])).toBe(PAGE_OPACITY_DEFAULT);
    });
});
