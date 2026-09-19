/*
水滴模块
- DROPLET_COUNT:水滴总数,必须与 src/shaders.wgsl 保持一致
- Droplet:位置 / 速度 / 半径 / 强度的紧凑布局,对应 WGSL struct
- make_droplets:按 DropletParams 生成一组随机初始水滴,写入 storage buffer
*/
use crate::droplet_params::DropletParams;
use rand::Rng;

// 水滴总数 N = 64.
// - 决定单帧要计算/绘制的循环规模:越多越密/越耗 GPU.
// - 必须与 src/shaders.wgsl 的 array<Droplet, 64>/cs_main 与
//   cs_refraction 里的 64u 保持一致.
// - cs_main 的 @workgroup_size(64) 恰好一次处理 64 颗水滴.
pub const DROPLET_COUNT: u32 = 64;

/// 初始随机数区间下限(含):每个 r_k 都是该区间内的独立均匀随机数.
const RANDOM_UNIT_MIN: f32 = 0.0;
/// 初始随机数区间上限(不含).
const RANDOM_UNIT_MAX: f32 = 1.0;
/// 横向初速度的随机项中心:`(r3 - VELOCITY_MIDPOINT)` 把 [0,1) 映射到 [-0.5, 0.5).
const VELOCITY_MIDPOINT: f32 = 0.5;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Droplet {
    pos_vel: [f32; 4],
    radius_strength: [f32; 4],
}

pub fn make_droplets(params: &DropletParams) -> Vec<Droplet> {
    // 随机源:rand crate 的线程局部 RNG,每次启动都不同(每次刷新页面都换一批水滴).
    let mut rng = rand::rng();
    make_droplets_with(params, &mut rng)
}

/// 确定性版本:同一个 seed 一定得到同一批水滴.
///
/// 给离线预览用(examples/preview.rs).粒子系统的初值是随机的,改一个参数再跑一次
/// 时如果连水滴位置都变了,两张图就没法并排比较 -- 分不清差异来自参数还是来自初值.
/// 线上仍然走 `make_droplets`(随机源),保持"每次刷新不一样".
pub fn make_droplets_seeded(params: &DropletParams, seed: u64) -> Vec<Droplet> {
    use rand::SeedableRng;
    let mut rng: rand::rngs::StdRng = rand::rngs::StdRng::seed_from_u64(seed);
    make_droplets_with(params, &mut rng)
}

/// 两个入口共用的生成逻辑(随机源由调用方给,便于换成确定性种子).
///
/// 每颗水滴按同一组插值公式初始化:
///   x  = spawn_x_min + r1 * spawn_x_span
///   y  = spawn_y_min + r2 * spawn_y_span
///   vx = (r3 - 0.5) * velocity_x_span - vehicle_speed * wind_backward_factor
///   vy = velocity_y_min + r4 * velocity_y_span
///   r  = radius_min + r5 * radius_span
///   s  = strength_min + r6 * strength_span
/// 以上数值全部来自 DropletParams,WGSL 出界重置使用同一份参数,
/// 由 src/droplet_params.rs 统一维护.
fn make_droplets_with<R: Rng>(params: &DropletParams, rng: &mut R) -> Vec<Droplet> {
    (0..DROPLET_COUNT)
        .map(|_| {
            // 每个 r_k 都是独立均匀随机数 ∈ [0, 1).
            let r1: f32 = rng.random_range(RANDOM_UNIT_MIN..RANDOM_UNIT_MAX); // 用于初始 x
            let r2: f32 = rng.random_range(RANDOM_UNIT_MIN..RANDOM_UNIT_MAX); // 用于初始 y
            let r3: f32 = rng.random_range(RANDOM_UNIT_MIN..RANDOM_UNIT_MAX); // 用于初始 vx
            let r4: f32 = rng.random_range(RANDOM_UNIT_MIN..RANDOM_UNIT_MAX); // 用于初始 vy
            let r5: f32 = rng.random_range(RANDOM_UNIT_MIN..RANDOM_UNIT_MAX); // 用于初始半径
            let r6: f32 = rng.random_range(RANDOM_UNIT_MIN..RANDOM_UNIT_MAX); // 用于初始强度
            Droplet {
                pos_vel: [
                    params.spawn_x_min + r1 * params.spawn_x_span,
                    params.spawn_y_min + r2 * params.spawn_y_span,
                    (r3 - VELOCITY_MIDPOINT) * params.velocity_x_span
                        - params.vehicle_speed * params.wind_backward_factor,
                    params.velocity_y_min + r4 * params.velocity_y_span,
                ],
                radius_strength: [
                    params.radius_min + r5 * params.radius_span,
                    params.strength_min + r6 * params.strength_span,
                    // 后两个分量保留给未来扩展,当前始终为 0.
                    0.0,
                    0.0,
                ],
            }
        })
        .collect()
}
