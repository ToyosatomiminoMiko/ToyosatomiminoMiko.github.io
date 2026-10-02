/**
 * 418 样式契约单测(纯 node, 不需要浏览器):
 * 把"TS 不再写会被简写覆盖的样式"和"CSS 里真的存在对应规则/令牌"钉住,
 * 因为这两处都只有真级联/真渲染才看得出问题, 浏览器冒烟覆盖不到.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLASS_PANEL_FLASH, CLASS_TOAST_COFFEE, CLASS_TOAST_TEA } from './teapot/config';

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

const css = read('./418.css');
const tokens = read('./418_tokens.css');
const runtime = read('./teapot/index.ts');
const config = read('./teapot/config.ts');

describe('418 蒸汽动画', () => {
    it('三根蒸汽柱各自带延迟, 动画本体来自令牌', () => {
        expect(tokens).toContain('--teapot-steam-animation: steamFloat 2.5s infinite ease-in-out');
        expect(css).toContain('animation: var(--teapot-steam-animation)');
        expect(css).toMatch(/\.steam span:nth-child\(2\)\s*\{[^}]*animation-delay:\s*var\(--teapot-steam-second-delay\)/s);
        expect(css).toMatch(/\.steam span:nth-child\(3\)\s*\{[^}]*animation-delay:\s*var\(--teapot-steam-third-delay\)/s);
    });

    it('增强只改 animation-name / animation-duration, 绝不写 animation 简写', () => {
        // animation 简写会把上面两条 delay 重置成 0s, 从此三根同步.
        expect(runtime).not.toMatch(/style\.animation\s*=/);
        expect(runtime).toContain('span.style.animationName');
        expect(runtime).toContain('span.style.animationDuration');
    });
});

describe('418 临时样式只走类名', () => {
    it('toast 变体类名在 TS 与 CSS 两边对得上', () => {
        expect(css).toContain(`.toast-message.${CLASS_TOAST_TEA} .icon`);
        expect(css).toContain(`.toast-message.${CLASS_TOAST_COFFEE} .icon`);
    });

    it('计数面板闪烁类名在 CSS 里有规则, 且过渡常驻在基类上', () => {
        expect(css).toContain(`.counter-panel.${CLASS_PANEL_FLASH}`);
        // 过渡若只写在闪烁类里, 去类那一帧回退会变瞬切.
        expect(css).toMatch(/\.counter-panel\s*\{[^}]*transition:\s*background-color var\(--teapot-duration-fast\)/s);
    });

    it('动态图标不再拼行内样式, 值只来自令牌', () => {
        expect(config).not.toContain('margin-right:6px');
        expect(config).not.toContain('color:#b34e4e');
        expect(css).toContain('margin-right: var(--teapot-counter-icon-gap)');
        expect(css).toContain('color: var(--teapot-ban-icon-alert-color)');
        expect(tokens).toContain('--teapot-counter-icon-gap: 6px');
        expect(tokens).toContain('--teapot-ban-icon-alert-color: #b34e4e');
        expect(tokens).toContain('--teapot-counter-flash-bg: #f0cdb0');
        expect(tokens).toContain('--teapot-counter-bg: #eedbcb');
    });
});
