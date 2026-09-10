import { afterEach, describe, expect, it, vi } from 'vitest';
import { GridTicksController } from './GridTicksController';
import { EventBus } from '../../service/EventBus';
import type { MathLabEvents } from '../../types';
import { RENDER_CONFIG } from '../../config/renderConfig';

/**
 * GridTicksController 只通过 document.getElementById 读取输入框,
 * 这里用最小假 DOM 覆盖它:不启动浏览器也能验证 π 单位开关的接线.
 */
interface FakeInput {
    checked: boolean;
    value: string;
    listeners: Map<string, Array<() => void>>;
    addEventListener(type: string, listener: () => void): void;
    dispatch(type: string): void;
}

function fakeInput(): FakeInput {
    const listeners = new Map<string, Array<() => void>>();
    return {
        checked: false,
        value: '',
        listeners,
        addEventListener(type, listener) {
            const bucket = listeners.get(type) ?? [];
            bucket.push(listener);
            listeners.set(type, bucket);
        },
        dispatch(type) {
            for (const listener of listeners.get(type) ?? []) listener();
        },
    };
}

const INPUT_IDS = [
    'gridVisibleXZ',
    'gridVisibleXY',
    'gridVisibleYZ',
    'axisTicksVisible',
    'axisTicksPiUnit',
    'gridMajorWidth',
    'gridMinorWidth',
] as const;

function stubDom(): Record<string, FakeInput> {
    const elements: Record<string, FakeInput> = {};
    for (const id of INPUT_IDS) elements[id] = fakeInput();
    vi.stubGlobal('document', {
        getElementById: (id: string) => elements[id] ?? null,
    });
    return elements;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('GridTicksController', () => {
    it('初始状态与配置一致,切换开关后广播 piUnit', () => {
        const elements = stubDom();
        const eventBus = new EventBus<MathLabEvents>();
        const received: Array<MathLabEvents['grid:changed']> = [];
        eventBus.on('grid:changed', (payload) => received.push(payload));

        const controller = new GridTicksController(eventBus);

        const initial = received[received.length - 1];
        expect(initial.piUnit).toBe(RENDER_CONFIG.scene.axisTicks.piUnit);
        expect(elements.axisTicksPiUnit.checked).toBe(RENDER_CONFIG.scene.axisTicks.piUnit);

        elements.axisTicksPiUnit.checked = true;
        elements.axisTicksPiUnit.dispatch('change');

        const toggled = received[received.length - 1];
        expect(toggled.piUnit).toBe(true);
        expect(received).toHaveLength(2);

        controller.dispose();
    });

    it('切换 π 单位不影响网格/刻度可见性与线宽', () => {
        const elements = stubDom();
        const eventBus = new EventBus<MathLabEvents>();
        const received: Array<MathLabEvents['grid:changed']> = [];
        eventBus.on('grid:changed', (payload) => received.push(payload));

        const controller = new GridTicksController(eventBus);
        const before = received[received.length - 1];

        elements.axisTicksPiUnit.checked = true;
        elements.axisTicksPiUnit.dispatch('change');

        const after = received[received.length - 1];
        expect(after.piUnit).toBe(true);
        expect(after.ticksVisible).toBe(before.ticksVisible);
        expect(after.xzVisible).toBe(before.xzVisible);
        expect(after.majorWidth).toBe(before.majorWidth);
        expect(after.minorWidth).toBe(before.minorWidth);

        controller.dispose();
    });
});
