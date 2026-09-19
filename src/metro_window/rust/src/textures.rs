/*
纹理工具与程序化生成
材质
- fetch_bytes / decode_png / create_texture:加载并上传纹理
- generate_dirt / generate_fog / generate_interior:程序化生成玻璃材质
- value_noise / fbm:基于 random::hash01 的噪声工具(含 PPM 可视化测试)

===== 玻璃材质贴图的约定(改动前先读这一段)=====
1) 采样器约定(app.rs 的 metro-sampler):
   u = Repeat,v = ClampToEdge.程序化贴图都是"放大若干倍 + 随时间漂移"地采样,
   坐标一旦越过 [0,1]:u 会被 Repeat 折回(贴图左右边对不上就是一条竖缝),
   v 会被 ClampToEdge 把最后一行拉满整段(污渍 uv*2 => 下半屏被水平拉成竖条纹).
   所以:雾/污渍的噪声必须 **双向可平铺**,着色器里再统一用 fract 折回坐标
   (见 shaders.wgsl 的 dirtUv / fogUv).周期用 value_noise/fbm 的 period 参数给,
   取模在晶格坐标上做,逐 octave 周期翻倍.划痕那类非噪声图案(scratch_mask)
   也必须用整数系数,否则 fy 方向接不上.
2) 贴图通道语义要对齐着色器:
   - 雾 textureFog / 车厢 textureInterior:RGB = 颜色,A = 浓度;
   - 污渍 textureDirt:RGB = "乘性颜色"(接近 1 的暖灰),A = 浓度,
     着色器做 c * dirt.rgb.曾经把三种污渍的遮罩直接写进 RGB 当颜色用,
     结果 smudge 处 G/B 被乘成 0,整块玻璃被染成红棕 + 蓝点 + 绿线.
3) 已知取舍 / 可调参数(不是 bug,但想调就动这几个数):
   - 灰尘很密:贴图约 10% 像素是灰尘点,2048 宽画布上约上万颗.嫌多就抬
     generate_dirt 里的 dust 阈值 0.78 或降低权重 0.6;
   - 划痕走样:line = (1-|...|)^18 在 256px 贴图里是亚像素细线,取整后
     变成规则的斜向点阵(渲染里测不到明显周期峰,但贴图本身不干净);
   - 次正规数陷阱:权重可以小到 4e-45,直接拿它做除数会把颜色算成乱值
     (出现过 RGB=(170,255,255)),所以 generate_dirt 里有 MIN_WEIGHT 下限.
*/
use crate::random::hash01;
use crate::render_params::{RENDER_TARGET_FORMAT, RGBA_BYTES_PER_PIXEL};
use crate::texture_params::{dirt, fog, interior, noise, CHANNEL_MAX};
use wasm_bindgen::JsCast;
use web_sys::window;

/*
读取内容返回为 byte数组
*/
pub(crate) async fn fetch_bytes(url: &str) -> Result<Vec<u8>, String> {
    let win: web_sys::Window = window().ok_or("没有 window")?;
    let promise: js_sys::Promise = win.fetch_with_str(url);
    let resp_value: wasm_bindgen::prelude::JsValue = wasm_bindgen_futures::JsFuture::from(promise)
        .await
        .map_err(|e| format!("加载 {url} 失败: {e:?}"))?;
    let resp: web_sys::Response = resp_value
        .dyn_into()
        .map_err(|_| format!("{url} 不是有效的响应"))?;
    if !resp.ok() {
        return Err(format!("加载 {url} 失败: HTTP {}", resp.status()));
    }
    let buffer_promise: js_sys::Promise = resp
        .array_buffer()
        .map_err(|e| format!("读取 {url} 失败: {e:?}"))?;
    let buffer: wasm_bindgen::prelude::JsValue =
        wasm_bindgen_futures::JsFuture::from(buffer_promise)
            .await
            .map_err(|e| format!("读取 {url} 失败: {e:?}"))?;
    let bytes: Vec<u8> = js_sys::Uint8Array::new(&buffer).to_vec();
    Ok(bytes)
}

/*
decode PNG image
return width,height,(32bit)RGBA
*/
pub fn decode_png(data: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let decoder: png::Decoder<std::io::Cursor<&[u8]>> =
        png::Decoder::new(std::io::Cursor::new(data));
    let mut reader: png::Reader<std::io::Cursor<&[u8]>> = decoder
        .read_info()
        .map_err(|e| format!("PNG 解码失败: {e}"))?;
    let mut raw: Vec<u8> =
        vec![0u8; reader.output_buffer_size().expect("PNG 缓冲大小计算失败")];
    let info: png::OutputInfo = reader
        .next_frame(&mut raw)
        .map_err(|e| format!("PNG 解码失败: {e}"))?;
    // PNG 宽度和高度
    let (w, h) = (info.width, info.height);
    let channels: usize = match info.color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::Rgb => 3,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Grayscale => 1,
        _ => return Err("不支持的 PNG 颜色类型".into()),
    };
    let bytes_per_channel = match info.bit_depth {
        png::BitDepth::Eight => 1,
        png::BitDepth::Sixteen => 2,
        _ => return Err("不支持的 PNG 位深".into()),
    };
    let raw_len: usize = w as usize * h as usize * channels * bytes_per_channel;
    let raw: &[u8] = &raw[..raw_len];
    let mut rgba: Vec<u8> = Vec::with_capacity(w as usize * h as usize * 4);
    match (info.color_type, info.bit_depth) {
        (png::ColorType::Rgba, png::BitDepth::Eight) => rgba.extend_from_slice(raw),
        (png::ColorType::Rgb, png::BitDepth::Eight) => {
            for px in raw.as_chunks::<3>().0 {
                rgba.extend_from_slice(&[px[0], px[1], px[2], 255]);
            }
        }
        (png::ColorType::Grayscale, png::BitDepth::Eight) => {
            for &v in raw {
                rgba.extend_from_slice(&[v, v, v, 255]);
            }
        }
        (png::ColorType::GrayscaleAlpha, png::BitDepth::Eight) => {
            for px in raw.as_chunks::<2>().0 {
                rgba.extend_from_slice(&[px[0], px[0], px[0], px[1]]);
            }
        }
        (png::ColorType::Rgba, png::BitDepth::Sixteen) => {
            for px in raw.as_chunks::<8>().0 {
                rgba.extend_from_slice(&[px[0], px[2], px[4], px[6]]);
            }
        }
        (png::ColorType::Rgb, png::BitDepth::Sixteen) => {
            for px in raw.as_chunks::<6>().0 {
                rgba.extend_from_slice(&[px[0], px[2], px[4], 255]);
            }
        }
        _ => return Err("不支持的 PNG 像素格式".into()),
    }
    Ok((w, h, rgba))
}

/// 只写 level 0 的公共部分(建纹理 + 上传像素).
fn create_texture_with_levels(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    label: &str,
    width: u32,
    height: u32,
    rgba: &[u8],
    mip_level_count: u32,
) -> wgpu::Texture {
    let size = wgpu::Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    };
    // 只有多级 mip 的纹理才需要当渲染目标(逐级 blit 生成,见 mipmaps.rs):
    // 单级的材质贴图(污渍/雾气/车厢)不该多要这个 usage,免得 wgpu 分配额外内存.
    let mut usage = wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST;
    if mip_level_count > 1 {
        usage |= wgpu::TextureUsages::RENDER_ATTACHMENT;
    }
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size,
        mip_level_count,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: RENDER_TARGET_FORMAT,
        usage,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        rgba,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(RGBA_BYTES_PER_PIXEL * width),
            rows_per_image: Some(height),
        },
        size,
    );
    texture
}

pub fn create_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    label: &str,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> wgpu::Texture {
    create_texture_with_levels(device, queue, label, width, height, rgba, 1)
}

/// 完整 mip 链的级数:`floor(log2(max(w, h))) + 1`.
///
/// 例:1920x1080 => 11 级(1024 <= 1920 < 2048);1x1 => 1 级.
/// 生成 mip 的逐级 blit 见 src/mipmaps.rs,这里的级数只决定纹理要分多少层.
pub fn mip_level_count_for(width: u32, height: u32) -> u32 {
    // leading_zeros 版本的整数 log2:先把 0 兜成 1(wgpu 不允许 0 尺寸),
    // 于是 32 - leading_zeros 正好是 floor(log2(n)) + 1.
    32 - width.max(height).max(1).leading_zeros()
}

/// 预乘 alpha:把颜色乘上自己的 alpha,就地改写 RGBA8 像素.
///
/// 为什么城市远景/中景/近景必须预乘:生成 mip 时逐级做的是**算术平均**,而这批
/// PNG 的透明像素是 (0,0,0,0)(实测 city_far / city_mid / city_near 的透明区全是纯黑).
/// 直乘 alpha 的图在边缘平均后颜色会被"拉黑",放大到 LOD 4 就是建筑轮廓外一圈黑边;
/// 预乘之后平均才有意义(颜色按覆盖率加权).
///
/// 合成侧对应的是 `c = c * (1 - a) + rgb`(见 shaders.wgsl 的 fs_main):
/// 在 LOD 0(a 非 0 即 1)上它与直乘 alpha 的 `mix(c, rgb, a)` 逐位等价,
/// 所以这次预乘不改变未模糊时的画面.
pub fn premultiply_alpha(rgba: &mut [u8]) {
    // 通道满值(u8 的定义值,不是可调参数)与四舍五入项 255/2:
    // 整数除法直接截断会把透明边缘越乘越暗,加半个满值再除才是四舍五入.
    const CHANNEL_FULL: u32 = u8::MAX as u32;
    const ROUNDING: u32 = CHANNEL_FULL / 2;
    // 每像素 RGBA 四个通道;用 as_chunks_mut 而不是按 4 取模下标:
    // 缓冲区长度不是 4 的倍数时尾部会被忽略,不会越界.
    for px in rgba.as_chunks_mut::<4>().0 {
        let a: u32 = px[3] as u32;
        for channel in px.iter_mut().take(3) {
            *channel = ((*channel as u32 * a + ROUNDING) / CHANNEL_FULL) as u8;
        }
    }
}

/// 建一张带完整 mip 链的城市层纹理.
///
/// `premultiply` 只对**有 alpha 的城市层**为 true:污渍/雾气/车厢那三张的 RGB 语义
/// 不是"颜色"(污渍 RGB 是乘性颜色,雾气 RGB 是颜色而 A 是浓度),预乘会把它们改坏.
/// mip 也只给城市层生成:其余三张的采样坐标都被 fract 折回后放大,不需要缩小过滤.
pub fn create_texture_mipped(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    label: &str,
    width: u32,
    height: u32,
    rgba: &[u8],
    premultiply: bool,
) -> wgpu::Texture {
    let levels: u32 = mip_level_count_for(width, height);
    let pixels: std::borrow::Cow<'_, [u8]> = if premultiply {
        let mut owned: Vec<u8> = rgba.to_vec();
        premultiply_alpha(&mut owned);
        std::borrow::Cow::Owned(owned)
    } else {
        std::borrow::Cow::Borrowed(rgba)
    };
    create_texture_with_levels(device, queue, label, width, height, &pixels, levels)
}

/// 读取 PNG 并建成带 mip 链的纹理(mip 的**生成**由调用方 submit,见 mipmaps.rs).
pub(crate) async fn create_png_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    label: &str,
    url: &str,
    premultiply: bool,
) -> Result<wgpu::Texture, String> {
    // get PNG
    let bytes: Vec<u8> = fetch_bytes(url).await?;
    // PNG decode
    let (w, h, rgba) = decode_png(&bytes)?;
    Ok(create_texture_mipped(
        device,
        queue,
        label,
        w,
        h,
        &rgba,
        premultiply,
    ))
}

/**
三次平滑(Cubic Smooth)
t [0,1]
`f(t) = 3*t^2 - 2*t^3`
数学特性:
端点无缝衔接:f(0)=0, f(1)=1.
导数为0: f'(0)=0, f'(1)=0.
完美对称: f(1-t)=1-f(t), 关于点(0.5,0.5)中心对称
*/
fn smooth(t: f32) -> f32 {
    t * t * (noise::SMOOTH_CUBIC - noise::SMOOTH_QUADRATIC * t)
}

/*
值噪声
period:晶格周期(0 = 不平铺),x 和 y 一起取模.
取模后 f(x) == f(x + period) 且 f(y) == f(y + period):两个方向都首尾相接,
这样无论采样器是 Repeat 还是着色器里 fract 折回,接缝处都不会出现突变.
*/
fn value_noise(x: f32, y: f32, seed: u32, period: u32) -> f32 {
    // 定位网格(晶格):找到当前点所在的单位方格
    // floor:返回小于或等于自身的最大整数
    let xi: i32 = x.floor() as i32;
    let yi: i32 = y.floor() as i32;
    // 计算局部坐标
    let tx: f32 = smooth(x - x.floor());
    let ty: f32 = smooth(y - y.floor());
    // 周期性:把晶格编号折回 [0, period),让首尾共用同一条晶格
    let wrap = |v: i32| -> i32 {
        if period == 0 {
            v
        } else {
            v.rem_euclid(period as i32)
        }
    };
    let (x0, x1): (i32, i32) = (wrap(xi), wrap(xi + 1));
    let (y0, y1): (i32, i32) = (wrap(yi), wrap(yi + 1));
    // 方格四个顶点的随机高度
    let a: f32 = hash01(x0 as u32, y0 as u32 ^ seed);
    let b: f32 = hash01(x1 as u32, y0 as u32 ^ seed);
    let c: f32 = hash01(x0 as u32, y1 as u32 ^ seed);
    let d: f32 = hash01(x1 as u32, y1 as u32 ^ seed);
    // 双线性插值(Bilinear Interpolation)
    let ab: f32 = a + (b - a) * tx;
    let cd: f32 = c + (d - c) * tx;
    ab + (cd - ab) * ty
}

/*
FBM(Fractal Brownian Motion,分形布朗运动)
分形噪声
base_period 是第 0 层的晶格周期,
第 k 层频率翻倍 => 周期同样翻倍,逐层取模即可保持整条 fbm 双向平铺.
*/
fn fbm(x: f32, y: f32, seed: u32, octaves: u32, base_period: u32) -> f32 {
    let mut sum: f32 = 0.0;
    let mut amp: f32 = noise::FBM_AMP_INITIAL; // [0, 1] 自带归一化
    let mut freq: f32 = noise::FBM_FREQ_INITIAL;
    let mut period: u32 = base_period;
    let mut norm: f32 = 0.0;
    for _ in 0..octaves {
        sum += value_noise(x * freq, y * freq, seed, period) * amp;
        norm += amp;
        amp *= noise::FBM_AMP_DECAY;
        freq *= noise::FBM_FREQ_GROWTH;
        period *= noise::FBM_PERIOD_GROWTH;
    }
    sum / norm
}

/*
将一个值限制在区间[0,1]内,除非它是 NaN
if v>max return max
if v>min return min
else return v
*/
fn clamp01(v: f32) -> f32 {
    v.clamp(0.0, 1.0)
}

/*
划痕 scratch:一族平行斜线(每贴图宽 71 条,每贴图高 44 条).
系数必须都是整数:fx / fy 各加 1(平铺折回)时 diag 只会增加整数,
%1.0 之后图案才完全重合.44/71 ≈ 0.62,与原来的倾斜角一致.
已知走样:powf(18) 让线宽不到 1 个纹素,取整后更像规则点阵(见文件头说明).
*/
fn scratch_mask(fx: f32, fy: f32, grain: f32) -> f32 {
    let diag: f32 = fx * dirt::SCRATCH_LINES_X + fy * dirt::SCRATCH_LINES_Y;
    let line: f32 = (1.0 - (((diag % 1.0) - 0.5) * 2.0).abs()).powf(dirt::SCRATCH_LINE_EXPONENT);
    line * (dirt::SCRATCH_GRAIN_BASE + dirt::SCRATCH_GRAIN_SPAN * grain)
}

/*
生成玻璃污渍贴图
- RGB:污渍的"乘性颜色"(1.0 = 不改变画面,越小越暗),着色器里做 c * dirt.rgb
- A  :污渍浓度,着色器里做 mix(c, c*dirt.rgb, dirt.a * dirt_opacity)

注意 RGB 必须是颜色而不是遮罩:三种污渍(污渍/划痕/灰尘)的遮罩只决定"哪里有多脏",
颜色统一混成接近中性的暖灰,否则某个通道会被乘成 0,整块玻璃就会偏色.
*/
pub fn generate_dirt(w: u32, h: u32) -> (u32, u32, Vec<u8>) {
    // 三种污渍各自的乘性颜色与阈值 / 频率 / seed 全部集中在
    // src/texture_params.rs 的 dirt 子模块.
    let mut out: Vec<u8> = vec![0u8; (w * h * RGBA_BYTES_PER_PIXEL) as usize];
    for y in 0..h {
        for x in 0..w {
            let fx: f32 = x as f32 / w as f32;
            let fy: f32 = y as f32 / h as f32;
            // 生成污渍 smudge
            let smudge: f32 = fbm(
                fx * dirt::SMUDGE_FREQ + dirt::SMUDGE_OFFSET_X,
                fy * dirt::SMUDGE_FREQ + dirt::SMUDGE_OFFSET_Y,
                dirt::SMUDGE_SEED,
                dirt::SMUDGE_OCTAVES,
                dirt::SMUDGE_PERIOD,
            );
            let smudge_a: f32 = clamp01((smudge - dirt::SMUDGE_THRESHOLD) * dirt::SMUDGE_GAIN)
                * dirt::SMUDGE_STRENGTH;
            // 生成划痕 scratch
            // 已知走样:71 条斜线摊在 256px 贴图上,每条不到 1 个纹素宽,
            // powf(18) 取整后变成规则的斜向点阵而不是自然的划痕.
            // 要修的话把频率调低(例如 71 -> 24)或降低 powf 指数,让线宽 >= 1 纹素.
            let scratch: f32 = scratch_mask(
                fx,
                fy,
                value_noise(
                    fx * dirt::SCRATCH_NOISE_FREQ,
                    fy * dirt::SCRATCH_NOISE_FREQ,
                    dirt::SCRATCH_NOISE_SEED,
                    dirt::SCRATCH_NOISE_PERIOD,
                ),
            );
            // 生成灰尘 dust
            // 密度偏高:阈值 0.78 在 90x90 晶格上留下约 0.8 颗/格,贴图 10% 的像素
            // 都是灰尘点(2048 宽画布上约上万颗).嫌脏就抬阈值或调小下面的 0.6 权重.
            let dust: f32 = value_noise(
                fx * dirt::DUST_NOISE_FREQ,
                fy * dirt::DUST_NOISE_FREQ,
                dirt::DUST_NOISE_SEED,
                dirt::DUST_NOISE_PERIOD,
            );
            let dust_a: f32 = if dust > dirt::DUST_THRESHOLD {
                (dust - dirt::DUST_THRESHOLD) * dirt::DUST_GAIN
            } else {
                0.0
            };

            // 每种污渍对画面的权重,浓度取三者最大值(叠加会糊成一片)
            let w_smudge: f32 = smudge_a;
            let w_scratch: f32 = scratch * dirt::SCRATCH_WEIGHT;
            let w_dust: f32 = dust_a * dirt::DUST_WEIGHT;
            let a: f32 = (w_smudge.max(w_scratch).max(w_dust)).min(1.0);
            // 颜色按各自权重混合:纯污渍处偏暖,纯灰尘处偏冷,划痕最浅
            // weight 极小的像素 alpha 取整后本来就是 0,直接保持中性色:
            // 既省掉一次除法,也避免次正规数(denormal)参与除法把颜色算花.
            let weight: f32 = w_smudge + w_scratch + w_dust;
            let mut rgb: [f32; 3] = dirt::NEUTRAL_TINT;
            if weight > dirt::MIN_WEIGHT {
                // 逐通道混合:用 iter_mut().enumerate() 而不是 0..3 下标循环,
                // 既避免 clippy::needless_range_loop,也不改变逐通道的计算顺序.
                for (c, channel) in rgb.iter_mut().enumerate() {
                    *channel = (dirt::SMUDGE_TINT[c] * w_smudge
                        + dirt::SCRATCH_TINT[c] * w_scratch
                        + dirt::DUST_TINT[c] * w_dust)
                        / weight;
                }
            }

            let i = ((y * w + x) * RGBA_BYTES_PER_PIXEL) as usize;
            out[i] = (rgb[0] * CHANNEL_MAX) as u8;
            out[i + 1] = (rgb[1] * CHANNEL_MAX) as u8;
            out[i + 2] = (rgb[2] * CHANNEL_MAX) as u8;
            out[i + 3] = (a * CHANNEL_MAX) as u8;
        }
    }
    (w, h, out)
}

pub fn generate_fog(w: u32, h: u32) -> (u32, u32, Vec<u8>) {
    let mut out: Vec<u8> = vec![0u8; (w * h * RGBA_BYTES_PER_PIXEL) as usize];
    for y in 0..h {
        for x in 0..w {
            let fx: f32 = x as f32 / w as f32;
            let fy: f32 = y as f32 / h as f32;
            // 采样坐标是 uv * (1.6, 1.3) 且 u 随 time 漂移:两个方向都会被推过 1,
            // 所以 fbm 必须双向可平铺(着色器里再用 fract 折回),
            // 否则 u 越界是一条竖缝,v 越界会被 ClampToEdge 拉成横条.
            // 频率 / seed / octaves / 周期见 src/texture_params.rs 的 fog 子模块.
            let n1: f32 = fbm(
                fx * fog::BASE_FREQ,
                fy * fog::BASE_FREQ,
                fog::BASE_SEED,
                fog::BASE_OCTAVES,
                fog::BASE_PERIOD,
            );
            let n2: f32 = fbm(
                fx * fog::DETAIL_FREQ + fog::DETAIL_OFFSET_X,
                fy * fog::DETAIL_FREQ + fog::DETAIL_OFFSET_Y,
                fog::DETAIL_SEED,
                fog::DETAIL_OCTAVES,
                fog::DETAIL_PERIOD,
            );
            let v: f32 = clamp01((n1 * fog::BASE_WEIGHT + n2 * fog::DETAIL_WEIGHT) * fog::GAIN);
            let i: usize = ((y * w + x) * RGBA_BYTES_PER_PIXEL) as usize;
            out[i] = (v * fog::R_SCALE) as u8;
            out[i + 1] = (v * fog::G_SCALE) as u8;
            out[i + 2] = (v * fog::B_SCALE) as u8;
            out[i + 3] = (v * fog::A_SCALE) as u8;
        }
    }
    (w, h, out)
}

/*
三次平滑步进(Cubic Smoothstep)
将`smooth`[0,1]推广到任意区间[edge0, edge1]
*/
fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    smooth(clamp01((x - edge0) / (edge1 - edge0)))
}

pub fn generate_interior(w: u32, h: u32) -> (u32, u32, Vec<u8>) {
    let mut out: Vec<u8> = vec![0u8; (w * h * RGBA_BYTES_PER_PIXEL) as usize];
    // 乘客虚影 / 灯光条 / 窗框反光的全部参数见 src/texture_params.rs 的 interior 子模块.
    for y in 0..h {
        for x in 0..w {
            let fx: f32 = x as f32 / w as f32;
            let fy: f32 = y as f32 / h as f32;
            let mut r: f32 = 0.0f32;
            let mut g: f32 = 0.0;
            let mut b: f32 = 0.0;
            let mut a: f32 = 0.0;

            // 顶部车厢灯光条
            let strip: f32 = smoothstep(interior::LIGHT_TOP_EDGE, interior::LIGHT_TOP_FULL, fy)
                * (1.0 - smoothstep(interior::LIGHT_BOTTOM_START, interior::LIGHT_BOTTOM_END, fy));
            let segments: f32 = interior::SEGMENT_BASE
                + interior::SEGMENT_AMPLITUDE
                    * (fx * interior::SEGMENT_FREQ * std::f32::consts::PI).sin();
            let warm: f32 = strip * segments;
            r += interior::LIGHT_R * warm;
            g += interior::LIGHT_G * warm;
            b += interior::LIGHT_B * warm;
            a += warm * interior::LIGHT_ALPHA;

            // 车窗框下沿的反光
            let rail: f32 = (1.0
                - clamp01(((fy - interior::RAIL_CENTER_Y) / interior::RAIL_HALF_WIDTH).abs()))
                * (interior::RAIL_BASE
                    + interior::RAIL_AMPLITUDE * (fx * interior::RAIL_FREQ).sin());
            r += interior::RAIL_R * rail;
            g += interior::RAIL_G * rail;
            b += interior::RAIL_B * rail;
            a += rail * interior::RAIL_ALPHA;

            // 乘客倒影(暗色虚影)
            for &(cx, cy, s) in &interior::PASSENGERS {
                let dx: f32 = (fx - cx) / s;
                let dy: f32 = (fy - cy) / (s * interior::HEAD_ASPECT);
                let head: f32 = (-(dx * dx + dy * dy) * interior::HEAD_FALLOFF).exp();
                let shx: f32 = (fx - cx) / (s * interior::SHOULDER_ASPECT_X);
                let shy: f32 =
                    (fy - (cy + interior::SHOULDER_OFFSET_Y)) / (s * interior::SHOULDER_ASPECT_Y);
                let shoulders: f32 = (-(shx * shx + shy * shy) * interior::SHOULDER_FALLOFF).exp();
                let ghost: f32 =
                    clamp01(head + shoulders * interior::SHOULDER_MIX) * interior::GHOST_ALPHA;
                r += interior::GHOST_R * ghost;
                g += interior::GHOST_G * ghost;
                b += interior::GHOST_B * ghost;
                a += ghost;
            }

            let i: usize = ((y * w + x) * RGBA_BYTES_PER_PIXEL) as usize;
            out[i] = (clamp01(r) * CHANNEL_MAX) as u8;
            out[i + 1] = (clamp01(g) * CHANNEL_MAX) as u8;
            out[i + 2] = (clamp01(b) * CHANNEL_MAX) as u8;
            out[i + 3] = (clamp01(a) * CHANNEL_MAX) as u8;
        }
    }
    (w, h, out)
}

/*
测试用的 ppm 可视化输出
- 统一写到本 crate 根下的 test_output/(cargo test 的 cwd 就是 crate 根,即
  src/metro_window/rust/test_output):这些图是 cargo test 的产物,拿来看生成
  结果对不对,该目录已被仓库根 .gitignore 的 /src/metro_window/rust/test_output
  忽略,不往仓库里丢生成物;
- 目录不存在时自动创建,单独跑某个测试也不会失败.
*/
#[cfg(test)]
pub(crate) fn write_ppm(name: &str, w: u32, h: u32, pixels: &[u8]) {
    // 输出目录(相对 crate 根)与 PPM(P6)文件头的最大通道值.
    const OUTPUT_DIR: &str = "test_output";
    const MAX_CHANNEL: u32 = 255;

    let dir: &std::path::Path = std::path::Path::new(OUTPUT_DIR);
    std::fs::create_dir_all(dir).expect("创建 test_output/ 失败");
    let mut header: Vec<u8> = format!("P6\n{w} {h}\n{MAX_CHANNEL}\n").into_bytes();
    header.extend_from_slice(pixels);
    let path: std::path::PathBuf = dir.join(name);
    std::fs::write(&path, header).unwrap_or_else(|e| panic!("写入 {} 失败: {e}", path.display()));
}

#[cfg(test)]
mod tests {
    use super::{fbm, generate_dirt, scratch_mask, value_noise, write_ppm};

    // 像素的 RGBA 分量数:与生成缓冲区的步长一致.
    const RGBA_COMPONENTS: usize = 4;
    // 灰度 PPM 每像素通道数(只写 R=G=B,无 alpha).
    const PPM_CHANNELS: u32 = 3;
    // 灰度量化上限:浮点 [0,1] 乘它取整得到 u8.
    const CHANNEL_SCALE: f32 = 255.0;

    /*
    mip 级数 = floor(log2(max(w, h))) + 1.
    算错的后果不报错,只是画面错:少一级则最糊的那档被夹到次一级(景深变浅),
    多一级则白建一层全无人采样的 mip.所以用几个真实尺寸把它钉住.
    */
    #[test]
    fn mip_level_count_covers_full_chain() {
        // 0 尺寸在 wgpu 里是非法的,这里只要求它不 panic 且至少 1 级.
        assert_eq!(super::mip_level_count_for(0, 0), 1);
        assert_eq!(super::mip_level_count_for(1, 1), 1);
        assert_eq!(super::mip_level_count_for(2, 1), 2);
        assert_eq!(super::mip_level_count_for(1920, 1080), 11);
        assert_eq!(super::mip_level_count_for(1920, 1200), 11);
        // 正好 2 的幂:2048 = 2^11 => 12 级(2^0 .. 2^11).
        assert_eq!(super::mip_level_count_for(2048, 1024), 12);
    }

    /*
    预乘 alpha:颜色乘自己的 alpha,alpha 通道不动.
    三条不变量:alpha = 255 原样;半透明严格按 128/255 缩放(四舍五入);
    全透明像素的颜色必须清零,否则生成 mip 时黑色会渗进不透明区.
    */
    #[test]
    fn premultiply_alpha_scales_color_by_alpha() {
        let mut pixels: Vec<u8> = vec![
            255, 128, 0, 255, // 不透明:不变
            255, 255, 255, 128, // 半透明:严格折半
            10, 20, 30, 0, // 全透明:颜色清零
        ];
        super::premultiply_alpha(&mut pixels);
        assert_eq!(&pixels[0..4], &[255, 128, 0, 255]);
        assert_eq!(&pixels[4..8], &[128, 128, 128, 128]);
        assert_eq!(&pixels[8..12], &[0, 0, 0, 0]);
    }

    /*
    污渍贴图的 RGB 是"乘性颜色"而不是遮罩:
    一旦把某个遮罩直接写进通道(例如把 smudge 写进 R,G/B 留 0),
    着色器 c * dirt.rgb 就会把玻璃染成红棕/蓝色.这里守住"颜色必须接近中性".
    */
    #[test]
    fn dirt_color_stays_neutral() {
        // 测试贴图边长(像素),小尺寸已足以覆盖三种污渍的混合.
        const TEST_SIZE: u32 = 64;
        // 单通道下限:低于它说明污渍颜色过暗,画面会被压黑.
        const MIN_CHANNEL: i32 = 120;
        // RGB 最大允许色偏(乘性颜色必须接近中性).
        const MAX_CHANNEL_SPREAD: i32 = 50;

        let (_, _, data) = generate_dirt(TEST_SIZE, TEST_SIZE);
        for px in data.as_chunks::<RGBA_COMPONENTS>().0 {
            let (r, g, b) = (px[0] as i32, px[1] as i32, px[2] as i32);
            let (max, min) = (r.max(g).max(b), r.min(g).min(b));
            assert!(min >= MIN_CHANNEL, "污渍颜色过暗,画面会被压黑: {px:?}");
            assert!(
                max - min <= MAX_CHANNEL_SPREAD,
                "污渍偏色过大(RGB 被当成遮罩用了?): {px:?}"
            );
        }
    }

    /*
    纹理要能被平铺采样:噪声在 x(Repeat 折回)和 y(fract 折回)上都必须是周期的,
    否则雾气会出现贯穿画面的竖缝,污渍/雾气会被 ClampToEdge 把边缘拉成一片.
    */
    #[test]
    fn noise_tiles_seamlessly() {
        // 覆盖三种实际用到的 (period, seed, octaves) 组合:
        // 雾气主层 / 雾气细节层 / 污渍 smudge.
        const TILE_TEST_CASES: [(u32, u32, u32); 3] = [(3, 42, 5), (7, 43, 3), (5, 11, 4)];
        // x 方向把一个周期均分成的取样点数.
        const SAMPLES: u32 = 16;
        // 采样点相对周期起点的偏移(避开晶格边界).
        const BASE_OFFSET: f32 = 2.0;
        // y 方向固定取这几个非整数相位.
        const SAMPLE_YS: [f32; 3] = [0.25, 1.0, 2.75];
        // 浮点比较容差:周期取模后两次采样应逐位接近.
        const TILE_EPSILON: f32 = 1e-6;

        // 周期 = 第 0 层晶格周期,采样点再乘上相同的倍率就落在完全相同的晶格相位上
        for (period, seed, octaves) in TILE_TEST_CASES {
            for i in 0..SAMPLES {
                let t: f32 = i as f32 / SAMPLES as f32;
                let base: f32 = t * period as f32 + BASE_OFFSET;
                for v in SAMPLE_YS {
                    let here: f32 = fbm(base, v, seed, octaves, period);
                    let next_x: f32 = fbm(base + period as f32, v, seed, octaves, period);
                    let next_y: f32 = fbm(base, v + period as f32, seed, octaves, period);
                    assert!(
                        (here - next_x).abs() < TILE_EPSILON,
                        "x 方向不平铺: period={period} t={t} v={v} {here} != {next_x}"
                    );
                    assert!(
                        (here - next_y).abs() < TILE_EPSILON,
                        "y 方向不平铺: period={period} t={t} v={v} {here} != {next_y}"
                    );
                }
            }
        }
    }

    /*
    划痕是非噪声图案,同样要双向平铺:系数必须是整数(71 / 44),
    一旦写成 (fx + fy * 0.62) * 71 这种,y 方向折回时图案会错位(44.02 不是整数).
    */
    #[test]
    fn scratch_mask_tiles_in_both_axes() {
        // 取样点数 / y 相位步长 / 测试用 grain.
        const SAMPLES: u32 = 16;
        const SAMPLE_Y_STRIDE: u32 = 5;
        const TEST_GRAIN: f32 = 0.7;
        // 浮点比较容差.
        const TILE_EPSILON: f32 = 1e-6;

        for i in 0..SAMPLES {
            let fx: f32 = i as f32 / SAMPLES as f32;
            let fy: f32 = ((i * SAMPLE_Y_STRIDE) % SAMPLES) as f32 / SAMPLES as f32;
            let here: f32 = scratch_mask(fx, fy, TEST_GRAIN);
            assert!(
                (here - scratch_mask(fx + 1.0, fy, TEST_GRAIN)).abs() < TILE_EPSILON,
                "划痕 x 方向不平铺: fx={fx} fy={fy}"
            );
            assert!(
                (here - scratch_mask(fx, fy + 1.0, TEST_GRAIN)).abs() < TILE_EPSILON,
                "划痕 y 方向不平铺: fx={fx} fy={fy}"
            );
        }
    }

    /*
    生成一整64x64的灰度图片
    */
    #[test]
    fn dump_value_noise_ppm() {
        // 输出分辨率(像素),单通道 seed 与文件名.
        const TEST_SIZE: u32 = 64;
        const TEST_SEED: u32 = 114;
        const TEST_PPM_NAME: &str = "value_noise_64x64.ppm";

        let mut pixels: Vec<u8> =
            Vec::with_capacity((TEST_SIZE * TEST_SIZE * PPM_CHANNELS) as usize);
        for y in 0..TEST_SIZE {
            for x in 0..TEST_SIZE {
                // seed=0 时,异或 yi ^ 0 = yi
                // value_noise(x, y, 0) == hash01(x, y)
                let v: u8 =
                    (value_noise(x as f32, y as f32, TEST_SEED, 0) * CHANNEL_SCALE).round() as u8;
                pixels.extend_from_slice(&[v, v, v]);
            }
        }

        write_ppm(TEST_PPM_NAME, TEST_SIZE, TEST_SIZE, &pixels);
    }

    /*
    更多过渡
    */
    #[test]
    fn dump_value_noise_smooth_ppm() {
        // 放大分辨率看得更清楚.
        const TEST_SIZE: u32 = 512;
        const TEST_PPM_NAME: &str = "value_noise_512x512.ppm";

        let mut pixels: Vec<u8> =
            Vec::with_capacity((TEST_SIZE * TEST_SIZE * PPM_CHANNELS) as usize);
        for y in 0..TEST_SIZE {
            for x in 0..TEST_SIZE {
                // 关键改动:把 0..512 映射到 0..8 的浮点数范围
                // 这样会让采样点落在网格内部,触发插值
                let fx: f32 = x as f32;
                let fy: f32 = y as f32;
                let v: u8 = (value_noise(fx, fy, 0, 0) * CHANNEL_SCALE).round() as u8;
                pixels.extend_from_slice(&[v, v, v]);
            }
        }
        // 文件名按真实分辨率命名:以前这里和上面那个测试都写 value_noise_64x64.ppm,
        // 两个测试并行跑会互相覆盖,谁最后写完谁说了算.
        write_ppm(TEST_PPM_NAME, TEST_SIZE, TEST_SIZE, &pixels);
    }

    /*
    更多过渡:采样点落在网格内部,触发插值
    */
    #[test]
    fn dump_fbm_smooth_ppm() {
        // 放大分辨率看得更清楚.
        const TEST_SIZE: u32 = 512;
        // 把 0..512 映射到 0..8 的浮点数范围的除数.
        const SAMPLE_SCALE: f32 = 64.0;
        // FBM 层数(周期性由 base_period=0 关闭,只用于可视化).
        const FBM_OCTAVES: u32 = 6;
        const TEST_PPM_NAME: &str = "fbm_512x512.ppm";

        let mut pixels: Vec<u8> =
            Vec::with_capacity((TEST_SIZE * TEST_SIZE * PPM_CHANNELS) as usize);
        for y in 0..TEST_SIZE {
            for x in 0..TEST_SIZE {
                // 把 0..512 映射到 0..8 的浮点数范围
                // 这样会让采样点落在网格内部,触发插值
                let fx: f32 = x as f32 / SAMPLE_SCALE; // 范围 0.0 ~ 7.98
                let fy: f32 = y as f32 / SAMPLE_SCALE; // 范围 0.0 ~ 7.98
                let v: u8 = (fbm(fx, fy, 0, FBM_OCTAVES, 0) * CHANNEL_SCALE).round() as u8;
                pixels.extend_from_slice(&[v, v, v]);
            }
        }
        write_ppm(TEST_PPM_NAME, TEST_SIZE, TEST_SIZE, &pixels);
    }
}
