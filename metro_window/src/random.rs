/*
白噪声哈希工具
hash01: 纯函数,相同坐标输出相同
- f(x,y)不导不连续
- 值域 [0.0, 1.0)
- 生成白噪声(White Noise)
*/
pub(crate) fn hash01(x: u32, y: u32) -> f32 {
    let mut h: u32 = x
        .wrapping_mul(374761393)
        .wrapping_add(y.wrapping_mul(668265263))
        .wrapping_add(0x9e37_79b9)
        .wrapping_mul(974_711);
    h ^= h >> 13;
    h = h.wrapping_mul(1_274_126_177);
    h ^= h >> 16;
    (h & 0x00ff_ffff) as f32 / 16_777_216.0
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
        const W: u32 = 64;
        const H: u32 = 64;

        let mut pixels: Vec<u8> = Vec::with_capacity((W * H * 3) as usize);
        for y in 0..H {
            for x in 0..W {
                let v: u8 = (hash01(x, y) * 255.0).round() as u8;
                pixels.extend_from_slice(&[v, v, v]);
            }
        }

        write_ppm("hash01_64x64.ppm", W, H, &pixels);
    }
}
