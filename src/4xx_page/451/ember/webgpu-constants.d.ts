/**
 * WebGPU 常量命名空间 -- 补 lib.dom 的缺口.
 *
 * TypeScript 7 的 lib.dom 已经带了 WebGPU 的全部接口 (GPUDevice / GPUQueue /
 * GPUBindGroupLayout ...),唯独没有 IDL 里的这几个常量对象.这里按 WebGPU 规范
 * 把**本项目用到的成员**补齐,于是不必为了类型引入 @webgpu/types 依赖.
 *
 * 只声明用得到的成员: 规范里同组的其它名字(INDEX / STORAGE_BINDING / MAP_WRITE /
 * GPUColorWrite ...)真要用时照抄同样形状加一行即可.
 *
 * 下面的值只是规范固定值的文档化说明,运行时取的是浏览器提供的真实对象.
 * 一旦 lib.dom 自己补全了这些名字,直接删掉本文件即可(重复声明会报类型冲突).
 */

declare var GPUBufferUsage: {
    readonly COPY_SRC: GPUBufferUsageFlags;
    readonly COPY_DST: GPUBufferUsageFlags;
    readonly UNIFORM: GPUBufferUsageFlags;
    readonly STORAGE: GPUBufferUsageFlags;
    /** GPU 计时: timestamp query 的解析目标 */
    readonly QUERY_RESOLVE: GPUBufferUsageFlags;
    readonly MAP_READ: GPUBufferUsageFlags;
};

declare var GPUMapMode: {
    readonly READ: GPUMapModeFlags;
};

declare var GPUShaderStage: {
    readonly VERTEX: GPUShaderStageFlags;
    readonly FRAGMENT: GPUShaderStageFlags;
    readonly COMPUTE: GPUShaderStageFlags;
};

declare var GPUTextureUsage: {
    readonly COPY_SRC: GPUTextureUsageFlags;
    readonly TEXTURE_BINDING: GPUTextureUsageFlags;
    readonly RENDER_ATTACHMENT: GPUTextureUsageFlags;
};

/**
 * lib.dom 的 GPUCommandEncoder 还缺 writeTimestamp
 * (规范里是 timestamp-query 打开后才可用的方法,类型表暂时没跟上).
 * 只在 GPU 计时里用到,补一个最小签名.
 */
interface GPUCommandEncoder {
    writeTimestamp(querySet: GPUQuerySet, queryIndex: number): void;
}
