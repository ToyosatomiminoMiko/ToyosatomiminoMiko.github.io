import { describe, expect, it } from 'vitest';
import { CameraManager } from './CameraManager';
import { RENDER_CONFIG } from '../../config/renderConfig';

/** CameraManager 只读取容器的像素尺寸,不需要真实 DOM. */
const viewport = { clientWidth: 800, clientHeight: 600 } as HTMLElement;

/** 投影模式对应的 THREE 相机 type 字符串. */
function cameraType(mode: 'perspective' | 'orthographic'): string {
    return mode === 'perspective' ? 'PerspectiveCamera' : 'OrthographicCamera';
}

describe('CameraManager', () => {
    it('初始激活相机与配置的 defaultMode 一致', () => {
        const manager = new CameraManager(viewport);

        expect(manager.mode).toBe(RENDER_CONFIG.camera.defaultMode);
        // 关键不变式:mode 说是正交,渲染用的就必须是正交相机
        expect(manager.getCamera().type).toBe(cameraType(manager.mode));
    });

    it('切换投影模式后激活相机随之改变', () => {
        const manager = new CameraManager(viewport);
        const before = manager.getCamera();
        const next = manager.mode === 'perspective' ? 'orthographic' : 'perspective';

        manager.setCameraMode(next);

        expect(manager.getCamera()).not.toBe(before);
        expect(manager.getCamera().type).toBe(cameraType(next));
    });
});
