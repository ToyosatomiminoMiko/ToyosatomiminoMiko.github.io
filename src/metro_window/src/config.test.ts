/*
 地铁车窗前端配置的回归网.

 测试与配置同一个目录(config.ts),因为它已经是站点 src/ 树的一部分:
 vitest 的 include 覆盖 src/ 下所有单测,这里天然被收集.断言仍是纯数据
 (不碰 DOM,也不需要 wasm 产物):

   - 滑块 id / 参数名唯一,范围合法(min < max,初始值在区间内,step > 0);
   - 风格编号连续,且默认风格是赛博朋克(index 1);
   - 上传图层槽位号连续,level 编号由近到远,文件同名;
   - **启动配置是对上面这些声明的投影**:`RUNTIME_CONFIG` 里的每一项都必须来自
     `SLIDER_GROUPS` / `STYLE_PRESETS` / `UPLOAD_LAYERS` / 各自的常量,不许另
     写一份数字(TS 是唯一数据来源,见 config.ts 末尾那段说明).

 跨语言那一侧不再由镜像清单守着:wasm 启动时读同一份对象并校验(层数与着色器
 实现不一致,滑块名没有对应字段都会在启动时报错),调用链路由
 metro_window.test.ts 用 mock wasm 钉住.
*/
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_STYLE_INDEX,
    MAX_UPLOAD_DIMENSION,
    RESOURCE_BASE,
    RUNTIME_CONFIG,
    SLIDER_GROUPS,
    STYLE_PRESETS,
    UPLOAD_ACCEPT,
    UPLOAD_LAYERS,
    UPLOAD_MIME_TYPE,
    type SliderGroupSpec,
    type SliderSpec,
} from './config';

// SLIDER_GROUPS 用 `as const` 收窄过,每个分组的 sliders 是各自的元组类型;
// 这里按统一的 SliderSpec 摊平,顺便断言"每个条目都能当 SliderSpec 用".
const sliders: readonly SliderSpec[] = SLIDER_GROUPS.flatMap(
    (group: SliderGroupSpec) => group.sliders,
);

describe('地铁车窗滑块配置', () => {
    it('滑块的 id 与参数名唯一', () => {
        expect(new Set(sliders.map((slider) => slider.id)).size).toBe(sliders.length);
        expect(new Set(sliders.map((slider) => slider.param)).size).toBe(sliders.length);
    });

    it('每个滑块的范围与初始值合法', () => {
        for (const slider of sliders) {
            expect(slider.min, slider.id).toBeLessThan(slider.max);
            expect(slider.step, slider.id).toBeGreaterThan(0);
            expect(slider.value, slider.id).toBeGreaterThanOrEqual(slider.min);
            expect(slider.value, slider.id).toBeLessThanOrEqual(slider.max);
        }
    });
});

describe('地铁车窗风格配置', () => {
    it('风格编号从 0 连续递增', () => {
        expect(STYLE_PRESETS.map((preset) => preset.index)).toEqual(STYLE_PRESETS.map((_, index) => index));
    });

    it('默认风格是赛博朋克(index 1)', () => {
        // DEFAULT_STYLE_INDEX 是默认风格的唯一来源:既决定初始点亮哪颗按钮,
        // 也经 RUNTIME_CONFIG 成为 wasm 的初始风格.这里钉住"它指向赛博朋克",
        // 调用侧那条链路由 metro_window.test.ts 钉.
        const preset = STYLE_PRESETS.find((item) => item.index === DEFAULT_STYLE_INDEX);
        expect(preset).toEqual({ index: 1, label: '赛博朋克' });
    });
});

describe('地铁车窗上传图层配置', () => {
    it('槽位号等于它在清单里的位置', () => {
        // wasm 侧按"清单顺序 = 材质槽位号"建纹理,顺序错了就是换错层(静默).
        expect(UPLOAD_LAYERS.map((layer) => layer.slot)).toEqual(UPLOAD_LAYERS.map((_, index) => index));
    });

    it('每层都指向 resource/ 下的同名 PNG', () => {
        for (const layer of UPLOAD_LAYERS) {
            // 原素材按层分开交付,文件名就是"槽位名 + .png":
            // 名字改了就说明清单和 public/metro_window/resource/ 对不上了.
            expect(layer.file, layer.name).toBe(`${layer.name}.png`);
        }
    });

    it('level 编号由近到远:level_0 最近,level_3 最远', () => {
        // 编号方向写反(level_0 当成最远的背景)会让上传面板张冠李戴,这里钉死两件事:
        // 编号与"层名"的对应,以及编号与 slot 的相反关系.
        expect(UPLOAD_LAYERS.map((layer) => layer.label)).toEqual([
            '城市背景',
            '城市远景',
            '城市中景',
            '城市近景',
        ]);
        for (const layer of UPLOAD_LAYERS) {
            expect(layer.name, layer.label).toBe(`level_${UPLOAD_LAYERS.length - 1 - layer.slot}`);
        }
    });

    it('最底层是全屏实景(不透明),其余层带透明通道需要预乘', () => {
        // `opaque` 会随配置传给 wasm,决定要不要预乘 alpha:
        // 标错的表现是画面正常但远景渗出黑边,或者反过来多乘一次导致边缘发暗.
        expect(UPLOAD_LAYERS[0]?.opaque).toBe(true);
        expect(UPLOAD_LAYERS.slice(1).every((layer) => !layer.opaque)).toBe(true);
    });

    it('只收 PNG', () => {
        expect(UPLOAD_ACCEPT).toBe(UPLOAD_MIME_TYPE);
    });
});

describe('地铁车窗启动配置(RUNTIME_CONFIG)', () => {
    it('风格 / 资源 / 上限都取自各自的声明,不另写数字', () => {
        expect(RUNTIME_CONFIG.styleIndex).toBe(DEFAULT_STYLE_INDEX);
        expect(RUNTIME_CONFIG.styleCount).toBe(STYLE_PRESETS.length);
        expect(RUNTIME_CONFIG.resourceBase).toBe(RESOURCE_BASE);
        expect(RUNTIME_CONFIG.uploadMaxDimension).toBe(MAX_UPLOAD_DIMENSION);
    });

    it('图层清单逐字段来自 UPLOAD_LAYERS', () => {
        expect(RUNTIME_CONFIG.layers).toEqual(
            UPLOAD_LAYERS.map((layer) => ({
                slot: layer.slot,
                name: layer.name,
                file: layer.file,
                opaque: layer.opaque,
            })),
        );
    });

    it('滑块清单逐字段来自 SLIDER_GROUPS', () => {
        expect(RUNTIME_CONFIG.params).toEqual(
            sliders.map((slider) => ({
                name: slider.param,
                min: slider.min,
                max: slider.max,
            })),
        );
    });
});
