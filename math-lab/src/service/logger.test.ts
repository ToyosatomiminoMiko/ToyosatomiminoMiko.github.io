import { afterEach, describe, expect, it, vi } from 'vitest';
import { logError, logWarning } from './logger';

describe('logger', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('logWarning 使用统一前缀输出', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        logWarning('Test', 'message', 42);

        expect(spy).toHaveBeenCalledWith('[Test]', 'message', 42);
    });

    it('logError 使用统一前缀输出', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

        logError('Test', new Error('boom'));

        expect(spy).toHaveBeenCalledWith('[Test]', expect.any(Error));
    });
});
