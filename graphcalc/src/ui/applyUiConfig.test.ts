import { describe, expect, it } from 'vitest';
import { UI_CONFIG } from '../config/uiConfig';
import { applyUiConfig, uiConfigCssVariables } from './applyUiConfig';

describe('uiConfigCssVariables', () => {
    it('把 UI_CONFIG 映射到约定好的 CSS 变量名', () => {
        const variables = uiConfigCssVariables();

        expect(variables['--code-font-family']).toBe(UI_CONFIG.editor.fontFamily);
        expect(variables['--code-font-size']).toBe(`${UI_CONFIG.editor.fontSize}px`);
        expect(variables['--code-line-height']).toBe(String(UI_CONFIG.editor.lineHeight));
        expect(variables['--code-tab-size']).toBe(String(UI_CONFIG.editor.tabSize));
        expect(variables['--katex-font-size']).toBe(
            `${UI_CONFIG.formula.katexFontSize}em`,
        );
    });

    it('只产生这五个变量,不夹带空值', () => {
        const variables = uiConfigCssVariables();

        expect(Object.keys(variables)).toHaveLength(5);
        for (const value of Object.values(variables)) {
            expect(typeof value).toBe('string');
            expect(value.length).toBeGreaterThan(0);
        }
    });
});

describe('UI_CONFIG', () => {
    it('字号与行高都是可用的正数', () => {
        expect(UI_CONFIG.editor.fontSize).toBeGreaterThan(0);
        expect(UI_CONFIG.editor.lineHeight).toBeGreaterThan(0);
        expect(UI_CONFIG.editor.tabSize).toBeGreaterThan(0);
        expect(UI_CONFIG.formula.katexFontSize).toBeGreaterThan(0);
    });
});

describe('applyUiConfig', () => {
    it('把变量写到传入的根元素上(用 stub 避免依赖 DOM 环境)', () => {
        const written = new Map<string, string>();
        const root = {
            style: {
                setProperty: (name: string, value: string): void => {
                    written.set(name, value);
                },
            },
        } as unknown as HTMLElement;

        applyUiConfig(root);

        expect(written.size).toBe(5);
        expect(written.get('--code-font-size')).toBe(`${UI_CONFIG.editor.fontSize}px`);
    });
});
