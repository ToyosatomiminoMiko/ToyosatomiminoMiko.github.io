import common from './shaders/common.wgsl?raw';
import compute from './shaders/compute.wgsl?raw';
import render from './shaders/render.wgsl?raw';
import composite from './shaders/composite.wgsl?raw';

export interface ShaderSources {
    /** 公共结构体与工具函数,会拼在各 pass 前面 */
    readonly common: string;
    readonly compute: string;
    readonly render: string;
    readonly composite: string;
}

/**
 * WGSL 源码.`?raw` 是打包器语法,刻意只让它出现在这个文件里 --
 * 管线代码因此不感知具体的构建工具.
 */
export const shaderSources: ShaderSources = { common, compute, render, composite };
