/*
地铁车窗前端配置的回归网.

测试与配置同一个目录(config.ts),因为它已经是站点 src/ 树的一部分:
vitest 的 include 覆盖 src/ 下所有单测,这里天然被收集.断言仍是纯数据
(不碰 DOM,也不需要 wasm 产物):

  - 滑块 id / setParam 参数名唯一,且参数名与 Rust 侧的清单一一对应
    (Rust 的 app_params.rs 有自己的镜像单测,两边同时改才不漂移);
  - 每个滑块的范围合法(min < max,初始值在区间内,step > 0);
  - 风格编号连续,且默认风格是已登记的编号;
  - 上传图层的槽位号 / 名字与 Rust 侧清单一致,且指向 resource/ 下的同名 PNG.
*/
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_STYLE_INDEX,
    MAX_UPLOAD_DIMENSION,
    SLIDER_GROUPS,
    STYLE_PRESETS,
    UPLOAD_ACCEPT,
    UPLOAD_LAYERS,
    UPLOAD_MIME_TYPE,
    type SliderGroupSpec,
    type SliderSpec,
} from './config';

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
    'elongation_max',
    'blur_max_lod',
    'blur_min_lod',
    'droplet_clear',
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

/*
 上传清单的契约测试.

 这一份是 Rust 侧 src/metro_window/rust/src/app_params.rs 的 UPLOADABLE_LAYERS
 的镜像:两侧各有一份写死的清单,同时改才不漂移(和上面的 EXPECTED_PARAMS
 同一个套路).槽位号决定"换的是哪张纹理",名字决定"界面上写的是哪一层",
 两者错位的后果是**静默换错层**,所以这里逐项对齐.
*/
describe('地铁车窗上传图层配置', () => {
    /** Rust 侧 UPLOADABLE_LAYERS 的名字(顺序即槽位号 0..3) */
    const EXPECTED_UPLOAD_NAMES = ['city_bg', 'city_far', 'city_mid', 'city_near'] as const;

    it('槽位号连续,名字与 Rust 侧一致', () => {
        expect(UPLOAD_LAYERS.map((layer) => layer.name)).toEqual([...EXPECTED_UPLOAD_NAMES]);
        expect(UPLOAD_LAYERS.map((layer) => layer.slot)).toEqual(UPLOAD_LAYERS.map((_, index) => index));
    });

    it('每层都指向 resource/ 下的同名 PNG', () => {
        for (const layer of UPLOAD_LAYERS) {
            // 原素材按层分开交付,文件名就是"槽位名 + .png":
            // 名字改了就说明清单和 public/metro_window/resource/ 对不上了.
            expect(layer.file, layer.name).toBe(`${layer.name}.png`);
        }
    });

    it('只收 PNG 且上限与 Rust 侧同一个值', () => {
        expect(UPLOAD_ACCEPT).toBe(UPLOAD_MIME_TYPE);
        // Rust 侧 render_params::MAX_TEXTURE_DIMENSION 也是 8192(wgpu 默认上限),
        // 前端先筛一遍是为了给出可读报错;两边不一致时用户会看到"前端放行,wasm 报错".
        expect(MAX_UPLOAD_DIMENSION).toBe(8192);
    });
});
