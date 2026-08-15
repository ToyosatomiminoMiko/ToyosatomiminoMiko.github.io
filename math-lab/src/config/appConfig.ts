// ============================================================
// 应用配置(纯数据,不包含类定义)
// ============================================================

export const APP_CONFIG = {
    camera: {
        defaultMode: 'perspective' as const,
        frustumSize: 14,
        initViewTarget: [0, 0, 0] as readonly number[],
    },
} as const;
