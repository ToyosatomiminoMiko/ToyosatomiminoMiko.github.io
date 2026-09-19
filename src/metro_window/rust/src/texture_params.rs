/*
程序化贴图参数配置模块
- generate_dirt / generate_fog / generate_interior 以及底层 value_noise / fbm /
  scratch_mask 的全部生成参数(频率,octaves,seed,颜色,阈值,权重)集中于此.
- 采样器约定回顾:u = Repeat / v = ClampToEdge,程序化贴图会被"放大 + 漂移"地采样,
  所以噪声必须双向可平铺 -- `*_PERIOD` 是第 0 层晶格周期,必须与对应频率相同,
  逐 octave 周期翻倍(见 src/textures.rs 的 value_noise / fbm).
- 数值与原字面量逐位一致,纯等价替换,不改变任何贴图输出;
  各字段的含义,单位与调参影响见注释,公式直接写在参数旁边.
- 通道语义:雾 / 车厢 RGB = 颜色,A = 浓度;污渍 RGB = 乘性颜色(接近 1 的暖灰),
  A = 浓度(见 src/textures.rs 文件头).
*/

/// 污渍贴图分辨率(像素):宽 × 高.
///
/// 越大越细腻,但生成时间与显存占用按面积增长.
pub const DIRT_TEXTURE_SIZE: (u32, u32) = (256, 256);

/// 雾气贴图分辨率(像素):宽 × 高.
pub const FOG_TEXTURE_SIZE: (u32, u32) = (256, 256);

/// 车厢倒影贴图分辨率(像素):宽 × 高.
///
/// 偏宽:着色器里按 uv 拉伸采样,横向细节更值得保留.
pub const INTERIOR_TEXTURE_SIZE: (u32, u32) = (512, 256);

/// 8bit 通道量化上限:浮点 [0,1] 乘它再取整得到 u8 像素值.
pub(crate) const CHANNEL_MAX: f32 = 255.0;

/// 值噪声 / FBM(Fractal Brownian Motion)的公共参数.
pub(crate) mod noise {
    /// 三次平滑 `f(t) = t²(3 - 2t)` 的三次项系数.
    ///
    /// 公式:`f(t) = t * t * (SMOOTH_CUBIC - SMOOTH_QUADRATIC * t)`.
    /// 数学特性:端点无缝 `f(0)=0, f(1)=1`,端点导数为 0,关于 (0.5, 0.5) 对称.
    pub(crate) const SMOOTH_CUBIC: f32 = 3.0;
    /// 三次平滑公式的二次项系数.
    pub(crate) const SMOOTH_QUADRATIC: f32 = 2.0;

    /// FBM 第 0 层振幅(起点).
    ///
    /// 每层累加 `noise * amp` 后 `norm += amp`,最后 `sum / norm` 归一化到 [0,1],
    /// 所以起点取 0.5 只是习惯;真正决定频谱的是 [`FBM_AMP_DECAY`].
    pub(crate) const FBM_AMP_INITIAL: f32 = 0.5;
    /// FBM 振幅逐层衰减系数(0.5 = 每层减半,形成 1/f 频谱).
    ///
    /// 调大 => 高频细节更明显(更"糙");调小 => 更平滑.
    pub(crate) const FBM_AMP_DECAY: f32 = 0.5;
    /// FBM 频率逐层放大系数(2.0 = 每层翻倍).
    pub(crate) const FBM_FREQ_GROWTH: f32 = 2.0;
    /// FBM 第 0 层频率倍率(采样坐标先乘它).
    pub(crate) const FBM_FREQ_INITIAL: f32 = 1.0;
    /// FBM 晶格周期逐层放大倍数(整数).
    ///
    /// 必须与频率翻倍同步,`f(x) == f(x + period)` 才能在每一层都成立(双向平铺).
    pub(crate) const FBM_PERIOD_GROWTH: u32 = 2;
}

/// 污渍贴图(dirt)生成参数.
///
/// 三种污渍:污渍 smudge / 划痕 scratch / 灰尘 dust,
/// 浓度取三者最大值,颜色按各自权重混合(见 generate_dirt).
pub(crate) mod dirt {
    // ===== 三种污渍的乘性颜色(数值越小该通道压得越暗)=====
    /// 污渍 smudge:暖灰褐,像玻璃上的水渍 / 油膜.
    pub(crate) const SMUDGE_TINT: [f32; 3] = [0.62, 0.58, 0.52];
    /// 划痕 scratch:比周围干净一点的中性发丝线.
    pub(crate) const SCRATCH_TINT: [f32; 3] = [0.82, 0.84, 0.90];
    /// 灰尘 dust:中性偏冷的小颗粒.
    pub(crate) const DUST_TINT: [f32; 3] = [0.60, 0.62, 0.68];
    /// 权重过小时的兜底乘性颜色(纯白 = 不改变画面).
    ///
    /// 避免次正规数参与颜色除法(曾经把颜色算成乱值),见 [`MIN_WEIGHT`].
    pub(crate) const NEUTRAL_TINT: [f32; 3] = [1.0, 1.0, 1.0];

    // ===== 污渍 smudge =====
    /// smudge 噪声频率(每 uv 单位的晶格数).
    pub(crate) const SMUDGE_FREQ: f32 = 5.0;
    /// smudge 采样坐标 x 偏移(打散晶格对齐,避免规则纹理).
    pub(crate) const SMUDGE_OFFSET_X: f32 = 3.7;
    /// smudge 采样坐标 y 偏移.
    pub(crate) const SMUDGE_OFFSET_Y: f32 = 1.2;
    /// smudge 噪声 seed:不同层用不同值,避免各通道相关.
    pub(crate) const SMUDGE_SEED: u32 = 11;
    /// smudge FBM 叠加层数:越大细节越丰富,生成越慢.
    pub(crate) const SMUDGE_OCTAVES: u32 = 4;
    /// smudge 第 0 层晶格周期(必须等于 [`SMUDGE_FREQ`] 才能双向平铺).
    pub(crate) const SMUDGE_PERIOD: u32 = 5;
    /// smudge 阈值:低于它视为干净.
    pub(crate) const SMUDGE_THRESHOLD: f32 = 0.42;
    /// smudge 阈值以上的增益(斜率).
    ///
    /// 公式:`smudge_a = clamp01((smudge - SMUDGE_THRESHOLD) * SMUDGE_GAIN) * SMUDGE_STRENGTH`.
    pub(crate) const SMUDGE_GAIN: f32 = 4.0;
    /// smudge 浓度上限(alpha).
    pub(crate) const SMUDGE_STRENGTH: f32 = 0.55;

    // ===== 划痕 scratch =====
    /// 划痕噪声频率(决定线宽 / 亮度的随机抖动).
    pub(crate) const SCRATCH_NOISE_FREQ: f32 = 30.0;
    /// 划痕噪声 seed.
    pub(crate) const SCRATCH_NOISE_SEED: u32 = 7;
    /// 划痕噪声第 0 层晶格周期(必须等于 [`SCRATCH_NOISE_FREQ`] 才能双向平铺).
    pub(crate) const SCRATCH_NOISE_PERIOD: u32 = 30;
    /// 每贴图宽方向的对角线系数(必须为整数,否则 y 方向折回时图案错位).
    ///
    /// 与 [`SCRATCH_LINES_Y`] 的比值 44/71 ≈ 0.62 决定倾斜角.
    pub(crate) const SCRATCH_LINES_X: f32 = 71.0;
    /// 每贴图高方向的对角线系数(必须为整数).
    pub(crate) const SCRATCH_LINES_Y: f32 = 44.0;
    /// 划痕线宽指数:`line = (1 - |((diag % 1) - 0.5) * 2|) ^ SCRATCH_LINE_EXPONENT`.
    ///
    /// 指数越大线越细;18 在 256px 贴图里不足 1 个纹素宽,取整后会呈规则点阵
    /// (已知走样,想修就调低频率或指数).
    pub(crate) const SCRATCH_LINE_EXPONENT: f32 = 18.0;
    /// 划痕亮度基值:`line * (BASE + SPAN * grain)`.
    pub(crate) const SCRATCH_GRAIN_BASE: f32 = 0.25;
    /// 划痕亮度随 grain 摆动的跨度.
    pub(crate) const SCRATCH_GRAIN_SPAN: f32 = 0.75;
    /// 划痕在总浓度里的权重.
    pub(crate) const SCRATCH_WEIGHT: f32 = 0.25;

    // ===== 灰尘 dust =====
    /// 灰尘噪声频率.
    ///
    /// 阈值 0.78 在 90×90 晶格上约 0.8 颗/格,贴图约 10% 像素是灰尘点
    /// (2048 宽画布上约上万颗).嫌脏就抬 [`DUST_THRESHOLD`] 或调小 [`DUST_WEIGHT`].
    pub(crate) const DUST_NOISE_FREQ: f32 = 90.0;
    /// 灰尘噪声 seed.
    pub(crate) const DUST_NOISE_SEED: u32 = 23;
    /// 灰尘噪声第 0 层晶格周期(必须等于 [`DUST_NOISE_FREQ`] 才能双向平铺).
    pub(crate) const DUST_NOISE_PERIOD: u32 = 90;
    /// 灰尘阈值:高于它才算灰尘点.
    pub(crate) const DUST_THRESHOLD: f32 = 0.78;
    /// 灰尘阈值以上的增益.
    pub(crate) const DUST_GAIN: f32 = 3.0;
    /// 灰尘在总浓度里的权重.
    pub(crate) const DUST_WEIGHT: f32 = 0.6;

    /// 判定"权重过小"的下限.
    ///
    /// 权重可以小到 4e-45,直接拿它做除数会把颜色算成乱值,所以低于该值时
    /// 直接保留 [`NEUTRAL_TINT`].
    pub(crate) const MIN_WEIGHT: f32 = 1.0e-3;
}

/// 雾气贴图(fog)生成参数.
pub(crate) mod fog {
    /// 主层噪声频率.
    pub(crate) const BASE_FREQ: f32 = 3.0;
    /// 主层噪声 seed.
    pub(crate) const BASE_SEED: u32 = 42;
    /// 主层 FBM 叠加层数.
    pub(crate) const BASE_OCTAVES: u32 = 5;
    /// 主层第 0 层晶格周期(必须等于 [`BASE_FREQ`] 才能双向平铺).
    pub(crate) const BASE_PERIOD: u32 = 3;

    /// 细节层噪声频率.
    pub(crate) const DETAIL_FREQ: f32 = 7.0;
    /// 细节层采样坐标 x 偏移(打散与主层的对齐).
    pub(crate) const DETAIL_OFFSET_X: f32 = 2.0;
    /// 细节层采样坐标 y 偏移.
    pub(crate) const DETAIL_OFFSET_Y: f32 = 1.0;
    /// 细节层噪声 seed.
    pub(crate) const DETAIL_SEED: u32 = 43;
    /// 细节层 FBM 叠加层数.
    pub(crate) const DETAIL_OCTAVES: u32 = 3;
    /// 细节层第 0 层晶格周期(必须等于 [`DETAIL_FREQ`] 才能双向平铺).
    pub(crate) const DETAIL_PERIOD: u32 = 7;

    /// 主层混合权重.
    pub(crate) const BASE_WEIGHT: f32 = 0.7;
    /// 细节层混合权重(与 [`BASE_WEIGHT`] 之和为 1).
    pub(crate) const DETAIL_WEIGHT: f32 = 0.3;
    /// 混合后的整体增益:大于 1 让雾气更浓.
    ///
    /// 公式:`v = clamp01((n1 * BASE_WEIGHT + n2 * DETAIL_WEIGHT) * GAIN)`.
    pub(crate) const GAIN: f32 = 1.2;

    /// 各通道量化系数:`out = (v * SCALE) as u8`.
    ///
    /// RGB 带轻微冷色调偏置(R/G/B 系数不同),A 为浓度.
    pub(crate) const R_SCALE: f32 = 255.0;
    pub(crate) const G_SCALE: f32 = 235.0;
    pub(crate) const B_SCALE: f32 = 245.0;
    pub(crate) const A_SCALE: f32 = 255.0;
}

/// 车厢倒影贴图(interior)生成参数.
pub(crate) mod interior {
    /// 乘客倒影的 (中心 x, 中心 y, 尺寸) 列表,坐标与尺寸都是 uv ∈ [0, 1].
    ///
    /// 4 个虚影横向铺开;尺寸越大虚影越大越淡(高斯分母随 s 放大).
    pub(crate) const PASSENGERS: [(f32, f32, f32); 4] = [
        (0.18, 0.76, 0.11),
        (0.40, 0.80, 0.13),
        (0.66, 0.74, 0.10),
        (0.88, 0.82, 0.12),
    ];

    // ===== 顶部车厢灯光条 =====
    /// 灯光条纵向渐变的上沿起点(uv):从 0 开始.
    pub(crate) const LIGHT_TOP_EDGE: f32 = 0.0;
    /// 灯光条纵向渐变的上沿满值处(uv).
    pub(crate) const LIGHT_TOP_FULL: f32 = 0.03;
    /// 灯光条下沿开始衰减的 uv.
    pub(crate) const LIGHT_BOTTOM_START: f32 = 0.10;
    /// 灯光条下沿完全消失的 uv.
    pub(crate) const LIGHT_BOTTOM_END: f32 = 0.17;
    /// 沿窗宽的分段亮度基值.
    ///
    /// 公式:`segments = SEGMENT_BASE + SEGMENT_AMPLITUDE * sin(fx * SEGMENT_FREQ * π)`.
    pub(crate) const SEGMENT_BASE: f32 = 0.55;
    /// 沿窗宽的分段亮度摆幅.
    pub(crate) const SEGMENT_AMPLITUDE: f32 = 0.45;
    /// 沿窗宽的分段频率(每窗宽的半周期数).
    pub(crate) const SEGMENT_FREQ: f32 = 26.0;
    /// 灯光条红色分量系数.
    pub(crate) const LIGHT_R: f32 = 0.98;
    /// 灯光条绿色分量系数.
    pub(crate) const LIGHT_G: f32 = 0.88;
    /// 灯光条蓝色分量系数(偏暖,所以蓝色最低).
    pub(crate) const LIGHT_B: f32 = 0.70;
    /// 灯光条浓度系数(alpha).
    pub(crate) const LIGHT_ALPHA: f32 = 0.48;

    // ===== 车窗框下沿的反光 =====
    /// 反光中心线的 uv y.
    pub(crate) const RAIL_CENTER_Y: f32 = 0.38;
    /// 反光半宽(uv):越小越像一条亮线.
    pub(crate) const RAIL_HALF_WIDTH: f32 = 0.010;
    /// 沿窗宽的亮度起伏基值.
    ///
    /// 公式:`rail = (1 - clamp01(|(fy - RAIL_CENTER_Y) / RAIL_HALF_WIDTH|))
    ///              * (RAIL_BASE + RAIL_AMPLITUDE * sin(fx * RAIL_FREQ))`.
    pub(crate) const RAIL_BASE: f32 = 0.45;
    /// 沿窗宽的亮度起伏摆幅.
    pub(crate) const RAIL_AMPLITUDE: f32 = 0.15;
    /// 沿窗宽的亮度起伏频率.
    pub(crate) const RAIL_FREQ: f32 = 40.0;
    /// 反光红色分量系数.
    pub(crate) const RAIL_R: f32 = 0.55;
    /// 反光绿色分量系数.
    pub(crate) const RAIL_G: f32 = 0.60;
    /// 反光蓝色分量系数(偏冷).
    pub(crate) const RAIL_B: f32 = 0.68;
    /// 反光浓度系数(alpha).
    pub(crate) const RAIL_ALPHA: f32 = 0.16;

    // ===== 乘客倒影(暗色虚影) =====
    /// 头部椭圆纵向拉伸倍数:dy = (fy - cy) / (s * HEAD_ASPECT).
    pub(crate) const HEAD_ASPECT: f32 = 1.7;
    /// 头部高斯衰减系数:`head = exp(-(dx² + dy²) * HEAD_FALLOFF)`.
    pub(crate) const HEAD_FALLOFF: f32 = 9.0;
    /// 肩部椭圆横向拉伸倍数.
    pub(crate) const SHOULDER_ASPECT_X: f32 = 1.6;
    /// 肩部椭圆纵向拉伸倍数.
    pub(crate) const SHOULDER_ASPECT_Y: f32 = 1.15;
    /// 肩部中心相对乘客中心的向下偏移(uv).
    pub(crate) const SHOULDER_OFFSET_Y: f32 = 0.10;
    /// 肩部高斯衰减系数.
    pub(crate) const SHOULDER_FALLOFF: f32 = 6.0;
    /// 肩部相对头部的叠加比例.
    ///
    /// 公式:`ghost = clamp01(head + shoulders * SHOULDER_MIX) * GHOST_ALPHA`.
    pub(crate) const SHOULDER_MIX: f32 = 0.75;
    /// 单个虚影的浓度上限(alpha).
    pub(crate) const GHOST_ALPHA: f32 = 0.22;
    /// 虚影红色分量系数.
    pub(crate) const GHOST_R: f32 = 0.16;
    /// 虚影绿色分量系数.
    pub(crate) const GHOST_G: f32 = 0.19;
    /// 虚影蓝色分量系数(偏冷,模拟车厢暗部).
    pub(crate) const GHOST_B: f32 = 0.28;
}
