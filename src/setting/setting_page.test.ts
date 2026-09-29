/**
 * SETTING 页骨架的**标记契约**回归网(进程内,跑在 happy-dom 里).
 *
 * 这一页的结构只有一句要求:**面板体的直接子节点正好是三颗设置组**,每颗都是
 * `fieldset.setting-group`,顺序 = 界面上从上到下(背景 / 实时参数 / 图层贴图).
 * 样式(setting.css 的 `.setting-group`)与各模块的填充都按这个结构命中,所以
 * "多一层壳 / 少一颗组 / 顺序换了"都只表现为"样式静默失效",没有报错也没有类型
 * 错误 -- 只能靠把生成的 DOM 按 CSS 用的选择器查一遍.
 *
 * 真浏览器里的同一件事(三块组的框体与控件观感真的只有一套)由
 * `scripts/smoke_home.mjs` 兜.
 *
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
    SETTING_GROUP_CLASS,
    SETTING_GROUP_ID_LIST,
    SETTING_GROUP_IDS,
    SETTING_PANEL_TITLE,
} from '@/setting/config';
import { mountSettingPage, type SettingPageSlots } from '@/setting/setting_page';

/** 标签页窗格(骨架建的 `#setting`)与挂载结果 */
let pane: HTMLElement;
let page: SettingPageSlots;

/** 与 main.ts 的分工一致:骨架给空窗格,设置页把整张面板长进去 */
function mount(): void {
    document.body.innerHTML = '';
    pane = document.createElement('div');
    pane.id = 'setting';
    document.body.append(pane);
    page = mountSettingPage(pane);
}

beforeEach(mount);

describe('SETTING 页骨架:整页面板', () => {
    it('窗格里是一张库的面板(标题在 .ui-panel-header,只出现一次)', () => {
        expect([...pane.children]).toHaveLength(1);
        const panel = pane.firstElementChild;
        // 框体的结构与类名归 miko_ui 的 createPanel
        // (section.ui-panel > header.ui-panel-header > span.ui-panel-title + div.ui-panel-body)
        expect(panel?.tagName).toBe('SECTION');
        expect([...(panel?.classList ?? [])]).toEqual(['ui-panel']);
        expect(panel).toBe(page.panel);
        const header = panel?.querySelector(':scope > .ui-panel-header');
        expect(header?.querySelector('.ui-panel-title')?.textContent).toBe(SETTING_PANEL_TITLE);
        expect(pane.querySelectorAll('.ui-panel-title')).toHaveLength(1);
    });

    it('重复挂载不会插两张面板(整体接管窗格)', () => {
        mountSettingPage(pane);
        expect(pane.querySelectorAll('.ui-panel')).toHaveLength(1);
    });
});

describe('SETTING 页骨架:三块设置组', () => {
    it('面板体的直接子节点正好三颗 fieldset.setting-group,没有多余的包裹层', () => {
        const body = pane.querySelector('.ui-panel-body');
        const children = [...(body?.children ?? [])];
        // 宿主就是那颗 fieldset:不该再有 div 包 fieldset 的一层空壳,
        // 也不该出现"一个 id 定位宿主,另一个 id 定位框体"这种一物两名
        expect(children.map((child) => child.tagName)).toEqual(['FIELDSET', 'FIELDSET', 'FIELDSET']);
        for (const child of children) {
            expect([...child.classList], child.id).toEqual([SETTING_GROUP_CLASS]);
        }
    });

    it('三颗组的 id 与顺序来自 config.ts,且还没长过内容(等各模块来填)', () => {
        const groups = [...pane.querySelectorAll(`.ui-panel-body > .${SETTING_GROUP_CLASS}`)];
        expect(groups.map((group) => group.id)).toEqual([...SETTING_GROUP_ID_LIST]);
        // 空组:legend 与内容都由填它的模块放进来(FIELD SET 只提供框体与 id)
        for (const group of groups) {
            expect(group.children, group.id).toHaveLength(0);
        }
    });

    it('交回的三颗组就是文档里那三颗(模块往它们里面长标记)', () => {
        expect(page.backgroundGroup.id).toBe(SETTING_GROUP_IDS.background);
        expect(page.paramsGroup.id).toBe(SETTING_GROUP_IDS.params);
        expect(page.uploadsGroup.id).toBe(SETTING_GROUP_IDS.uploads);
        for (const group of [page.backgroundGroup, page.paramsGroup, page.uploadsGroup]) {
            expect(group).toBe(pane.querySelector(`#${group.id}`));
            expect(group).toBeInstanceOf(HTMLFieldSetElement);
        }
    });

    it('三颗组都不带组件的作用域类(那是组件自己往宿主上补的)', () => {
        for (const group of [page.backgroundGroup, page.paramsGroup, page.uploadsGroup]) {
            expect([...group.classList], group.id).not.toContain('metro-window');
        }
    });
});
