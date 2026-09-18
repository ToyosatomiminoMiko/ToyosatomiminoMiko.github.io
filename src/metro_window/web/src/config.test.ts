/*
地铁车窗前端配置的回归网.

配置集中在 metro_window/web/src/config.ts,但 vitest 的 include 只有站点侧的
src/**,所以这份测试放在这里,import 子项目的配置模块做纯数据断言(不碰 DOM,
也不需要 wasm 产物):

  - 滑块 id / setParam 参数名唯一,且参数名与 Rust 侧的清单一一对应
    (Rust 的 app_params.rs 有自己的镜像单测,两边同时改才不漂移);
  - 每个滑块的范围合法(min < max,初始值在区间内,step > 0);
  - 风格编号连续,且默认风格是已登记的编号.
*/
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_STYLE_INDEX,
    SLIDER_GROUPS,
    STYLE_PRESETS,
    type SliderGroupSpec,
    type SliderSpec,
} from '../metro_window/web/src/config';

/** Rust 侧 app_params.rs 单测里的同一份参数名清单(跨语言契约). */
const EXPECTED_PARAMS = [
    'vehicle_speed',
    'far_distance',
    'mid_distance',
    'near_distance',
    'droplet_size',
    'wind_backward_factor',
    'wind_sway_scale',
    'gravity_scale',
    'refraction_scale',
    'dirt_opacity',
    'fog_opacity',
    'interior_opacity',
] as const;

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

    it('参数名与 Rust 侧清单一致', () => {
        expect(sliders.map((slider) => slider.param)).toEqual(EXPECTED_PARAMS);
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

    it('默认风格是已登记的编号', () => {
        expect(STYLE_PRESETS.some((preset) => preset.index === DEFAULT_STYLE_INDEX)).toBe(true);
    });
});
