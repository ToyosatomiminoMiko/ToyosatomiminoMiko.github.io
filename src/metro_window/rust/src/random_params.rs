/*
白噪声哈希参数配置模块
- hash01(x, y) 使用的全部整数哈希常量集中于此.
- 这些常量不是可调渲染参数:任何改动都会整体改变噪声图案,进而改变程序化贴图
  与 test_output/ 下的 PPM 基准图,非必要不要调整.
- 哈希算法本身(乘加与异或右移的步骤)写在 src/random.rs 的 hash01 里.
*/

/// x 坐标乘子(大素数,打散低位相关性).
pub(crate) const HASH_X_MUL: u32 = 374_761_393;
/// y 坐标乘子(大素数).
pub(crate) const HASH_Y_MUL: u32 = 668_265_263;
/// 黄金比例常数偏移(0x9e3779b9):避免 (0, 0) 处退化.
pub(crate) const HASH_BASE_ADD: u32 = 0x9e37_79b9;
/// 第一轮乘法的尾乘子(混淆高低位).
pub(crate) const HASH_TAIL_MUL: u32 = 974_711;
/// 第一次异或右移的位数.
pub(crate) const HASH_SHIFT_1: u32 = 13;
/// 第二轮乘法的乘子.
pub(crate) const HASH_FINAL_MUL: u32 = 1_274_126_177;
/// 第二次异或右移的位数.
pub(crate) const HASH_SHIFT_2: u32 = 16;
/// 输出位掩码:取低 24 位(0x00ff_ffff).
pub(crate) const HASH_OUTPUT_MASK: u32 = 0x00ff_ffff;
/// 输出归一化除数:2^24,把 24 位整数映射到 [0, 1).
pub(crate) const HASH_OUTPUT_DIVISOR: f32 = 16_777_216.0;
