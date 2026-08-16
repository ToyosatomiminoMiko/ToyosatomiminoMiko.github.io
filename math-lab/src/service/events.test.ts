import { describe, expectTypeOf, it } from 'vitest';
import type { MathLabEvents } from './events';

/**
 * MathLabEvents 的最小类型映射测试。
 *
 * 新问题/局限：
 * - `expectTypeOf` 是编译期断言，不会检测哪些事件在运行时真正被 emit。
 *   因此删除 `mathobj:*` 或新增事件时，仍必须手工同步这里的期望。
 */
describe('MathLabEvents', () => {
    it('keeps camera event payloads strongly typed', () => {
        expectTypeOf<MathLabEvents['camera:changed']>().toEqualTypeOf<{
            camMode: 'perspective' | 'orthographic';
        }>();
        expectTypeOf<MathLabEvents['camera:view']>().toEqualTypeOf<{
            view: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'isometric';
        }>();
        expectTypeOf<MathLabEvents['camera:rotationLock']>().toEqualTypeOf<{
            locked: boolean;
        }>();
    });

    it('keeps integral result payload strongly typed', () => {
        expectTypeOf<MathLabEvents['integral:calculated']>().toEqualTypeOf<{
            results: { id: number; value: number }[];
            total: number;
        }>();
    });
});
