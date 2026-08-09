/*
剔除所有包含 NaN z 值的三角形

原理:任何包含 NaN 顶点的三角形,其面法线为 NaN,
Three.js 的 computeVertexNormals 会把 NaN 通过顶点平均
扩散到相邻的正常三角形,导致高光/阴影异常.

修复:遍历所有三角形,只保留三个顶点 z 值均有限的三角形.

- `z_values[i*3+2]` 对应的 z 值(注意: 实际我们只需要 z 分量, 可以只传 z 数组)

参数:
- `full_indices`: 完整三角形的顶点索引(每 3 个一组)
- `z_values`: 所有顶点的 z 坐标, NaN 表示无效顶点

返回: 过滤后的索引数组, 长度是 3 的倍数
*/
pub fn filter_nan_triangles(full_indices: &[u32], z_values: &[f64]) -> Vec<u32> {
    // 预分配容量(最多等于原始长度)
    let mut filtered = Vec::with_capacity(full_indices.len());

    for chunk in full_indices.chunks_exact(3) {
        let a = chunk[0] as usize;
        let b = chunk[1] as usize;
        let c = chunk[2] as usize;

        // 安全边界检查(Rust 会自动 panic, 但我们可以用 get 避免崩溃)
        if let (Some(&za), Some(&zb), Some(&zc)) =
            (z_values.get(a), z_values.get(b), z_values.get(c))
        {
            if za.is_finite() && zb.is_finite() && zc.is_finite() {
                filtered.extend_from_slice(chunk);
            }
        }
    }
    filtered
}
