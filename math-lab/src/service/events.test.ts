import { describe, expectTypeOf, it } from 'vitest';
import type { MathLabEvents } from './events';

/**
 * MathLabEvents 的最小类型映射测试.
 *
 * 新问题/局限:
 * - `expectTypeOf` 是编译期断言,不会检测哪些事件在运行时真正被 emit.
 *   因此删除或新增事件键时,仍必须手工同步这里的期望,并保证键有真实 emit 点.
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
});
