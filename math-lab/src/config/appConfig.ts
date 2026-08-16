// ============================================================
// 应用配置(纯数据,不包含类定义)
// ============================================================

export const APP_CONFIG = {
    camera: {
        defaultMode: 'perspective' as const,
        frustumSize: 14,
        initViewTarget: [0, 0, 0] as readonly number[],
        defaultPosition: [12, 8, 12] as readonly number[],
        defaultHome: 'isometric' as const,
        viewDistance: 20,
        perspFov: 45,
        near: 0.1,
        far: 200,
    },
} as const;
