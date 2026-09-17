// ============================================================
// compute.wgsl -- 粒子仿真 (在 GPU 上更新, CPU 完全不参与)
// 单位: 逻辑像素 + 秒
// ============================================================

@group(0) @binding(0) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(1) var<uniform> sim : SimUniforms;

// 超出边界判定: 向上飘出顶部 / 左右飘出 / 沉到屏幕外, 或者寿命耗尽
fn outOfBounds(p : Particle, w : f32, h : f32) -> bool {
    if (p.pos.y + p.size < -60.0) { return true; }
    if (p.pos.y - p.size > h + 140.0) { return true; }
    if (p.pos.x + p.size < -80.0) { return true; }
    if (p.pos.x - p.size > w + 80.0) { return true; }
    return p.age >= p.life;
}

@compute @workgroup_size(64)
fn update(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= arrayLength(&particles)) { return; }

    var p = particles[idx];
    let dt = sim.dt;

    // ---------- 指针风向扰动 (原 mousemove 交互的 GPU 版) ----------
    let pointer = vec2<f32>(sim.pointerX, sim.pointerY);
    let toPointer = pointer - p.pos;
    let dist = max(length(toPointer), 1.0);
    let influence = clamp(1.0 - dist / (min(sim.width, sim.height) * 0.45), 0.0, 1.0);
    var wind = vec2<f32>(0.0, 0.0);
    if (influence > 0.0) {
        // 被指针"推开": 距离越近推力越大, 上限防止粒子被吹飞
        wind = -(toPointer / dist) * influence * 190.0 * sim.windScale;
    } else {
        // 远处保留一点随机水平漂移. 幅度从 14 提到 36: 寿命拉长之后,
        // 原来的幅度只够让火星几乎笔直上升, 看着像一根根竖线
        wind.x = (hash11(p.seed + floor(sim.time * 1.7) + p.flick) - 0.5) * 36.0;
    }

    // ---------- 积分 ----------
    var vel = p.vel + wind * dt;
    // 横向: 阻尼照旧, 让侧向漂移自然收敛
    vel.x = vel.x * (1.0 - clamp(2.6 * dt, 0.0, 1.0));
    // 纵向: 只留很轻的阻尼. 以前纵向也用 2.6, 初速几百毫秒就被拖光, 稳态只剩
    // ~23px/s, 再乘 1.6~3.8s 的寿命, 一生只升几十像素 -- 这正是"粒子全挤在
    // 画面最底下一条"的根因.
    vel.y = vel.y * (1.0 - clamp(0.8 * dt, 0.0, 1.0));
    // 兜底: 收敛到这颗自己的巡航速度, 不会被阻力拖停
    if (vel.y > -p.rise) { vel.y = mix(vel.y, -p.rise, 0.10); }

    p.pos = p.pos + vel * dt;
    p.vel = vel;
    p.age = p.age + dt;

    // ---------- 死亡重生 ----------
    if (outOfBounds(p, sim.width, sim.height)) {
        p = respawn(p.seed, sim.time, sim.width, sim.height);
    }

    particles[idx] = p;
}
