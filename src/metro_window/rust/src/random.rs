/*
白噪声(White Noise)哈希工具
hash01: 定义在整数格点上的纯函数,相同 (x, y) 永远得到相同输出;
整数哈希把坐标彻底打散,相邻格点之间没有空间相关性(即白噪声).
- 值域 [0.0, 1.0)
- 全部哈希常量见 src/random_params.rs
- 是离散整数哈希,无插值,不是连续函数(所以不谈可导/连续)
*/
use crate::random_params::{
    HASH_BASE_ADD, HASH_FINAL_MUL, HASH_OUTPUT_DIVISOR, HASH_OUTPUT_MASK, HASH_SHIFT_1,
    HASH_SHIFT_2, HASH_TAIL_MUL, HASH_X_MUL, HASH_Y_MUL,
};

pub(crate) fn hash01(x: u32, y: u32) -> f32 {
    let mut h: u32 = x
        .wrapping_mul(HASH_X_MUL)
        .wrapping_add(y.wrapping_mul(HASH_Y_MUL))
        .wrapping_add(HASH_BASE_ADD)
        .wrapping_mul(HASH_TAIL_MUL);
    h ^= h >> HASH_SHIFT_1;
    h = h.wrapping_mul(HASH_FINAL_MUL);
    h ^= h >> HASH_SHIFT_2;
    (h & HASH_OUTPUT_MASK) as f32 / HASH_OUTPUT_DIVISOR
}

#[cfg(test)]
mod tests {
    use super::hash01;
    use crate::test_fixtures::PPM_CHANNELS;
    use crate::texture_params::CHANNEL_MAX;
    use crate::textures::write_ppm;

    /*
    把 hash01 的分布导出成灰度 PPM(test_output/hash01_64x64.ppm),供肉眼检查噪声是否均匀.
    */
    #[test]
    fn dump_hash01_ppm() {
        // 测试输出图边长(像素)与文件名;与 src/textures.rs 的 PPM 测试同一套约定.
        const TEST_IMAGE_SIZE: u32 = 64;
        // 输出文件名(写在 test_output/ 下).
        const TEST_PPM_NAME: &str = "hash01_64x64.ppm";

        let mut pixels: Vec<u8> =
            Vec::with_capacity((TEST_IMAGE_SIZE * TEST_IMAGE_SIZE * PPM_CHANNELS) as usize);
        for y in 0..TEST_IMAGE_SIZE {
            for x in 0..TEST_IMAGE_SIZE {
                let v: u8 = (hash01(x, y) * CHANNEL_MAX).round() as u8;
                pixels.extend_from_slice(&[v, v, v]);
            }
        }

        write_ppm(TEST_PPM_NAME, TEST_IMAGE_SIZE, TEST_IMAGE_SIZE, &pixels);
    }
}
