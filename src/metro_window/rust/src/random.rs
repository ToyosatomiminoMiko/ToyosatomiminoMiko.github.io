/*
白噪声哈希工具
hash01: 纯函数,相同坐标输出相同
- f(x,y)不导不连续
- 值域 [0.0, 1.0)
- 生成白噪声(White Noise)
- 全部哈希常量见 src/random_params.rs
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
    use crate::textures::write_ppm;

    /*
    生成一整64x64的灰度图片
    */
    #[test]
    fn dump_hash01_ppm() {
        // 测试输出图边长(像素)与文件名;与 src/textures.rs 的 PPM 测试同一套约定.
        const TEST_IMAGE_SIZE: u32 = 64;
        // 灰度图每像素通道数(只写 R=G=B,无 alpha).
        const TEST_CHANNELS: u32 = 3;
        // 灰度量化上限:浮点 [0,1] 乘它取整得到 u8.
        const TEST_CHANNEL_MAX: f32 = 255.0;
        // 输出文件名(写在 test_output/ 下).
        const TEST_PPM_NAME: &str = "hash01_64x64.ppm";

        let mut pixels: Vec<u8> =
            Vec::with_capacity((TEST_IMAGE_SIZE * TEST_IMAGE_SIZE * TEST_CHANNELS) as usize);
        for y in 0..TEST_IMAGE_SIZE {
            for x in 0..TEST_IMAGE_SIZE {
                let v: u8 = (hash01(x, y) * TEST_CHANNEL_MAX).round() as u8;
                pixels.extend_from_slice(&[v, v, v]);
            }
        }

        write_ppm(TEST_PPM_NAME, TEST_IMAGE_SIZE, TEST_IMAGE_SIZE, &pixels);
    }
}
