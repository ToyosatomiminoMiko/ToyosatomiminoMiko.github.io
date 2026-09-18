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

pub fn create_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    label: &str,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> wgpu::Texture {
    let size = wgpu::Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
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
            bytes_per_row: Some(4 * width),
            rows_per_image: Some(height),
        },
        size,
    );
    texture
}

pub(crate) async fn create_png_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    label: &str,
    url: &str,
) -> Result<wgpu::Texture, String> {
    // get PNG
    let bytes: Vec<u8> = fetch_bytes(url).await?;
    // PNG decode
    let (w, h, rgba) = decode_png(&bytes)?;
    Ok(create_texture(device, queue, label, w, h, &rgba))
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
    t * t * (3.0 - 2.0 * t)
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
    let mut amp: f32 = 0.5; // [0, 1] 自带归一化
    let mut freq: f32 = 1.0;
    let mut period: u32 = base_period;
    let mut norm: f32 = 0.0;
    for _ in 0..octaves {
        sum += value_noise(x * freq, y * freq, seed, period) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
        period *= 2;
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
    let diag: f32 = fx * 71.0 + fy * 44.0;
    let line: f32 = (1.0 - (((diag % 1.0) - 0.5) * 2.0).abs()).powf(18.0);
    line * (0.25 + 0.75 * grain)
}

/*
生成玻璃污渍贴图
- RGB:污渍的"乘性颜色"(1.0 = 不改变画面,越小越暗),着色器里做 c * dirt.rgb
- A  :污渍浓度,着色器里做 mix(c, c*dirt.rgb, dirt.a * dirt_opacity)

注意 RGB 必须是颜色而不是遮罩:三种污渍(污渍/划痕/灰尘)的遮罩只决定"哪里有多脏",
颜色统一混成接近中性的暖灰,否则某个通道会被乘成 0,整块玻璃就会偏色.
*/
pub fn generate_dirt(w: u32, h: u32) -> (u32, u32, Vec<u8>) {
    // 三种污渍各自的乘性颜色(数值越小该通道压得越暗)
    //   污渍 smudge :暖灰褐,像玻璃上的水渍/油膜
    //   划痕 scratch:比周围干净一点的中性发丝线
    //   灰尘 dust   :中性偏冷的小颗粒
    const SMUDGE_TINT: [f32; 3] = [0.62, 0.58, 0.52];
    const SCRATCH_TINT: [f32; 3] = [0.82, 0.84, 0.90];
    const DUST_TINT: [f32; 3] = [0.60, 0.62, 0.68];

    let mut out: Vec<u8> = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let fx: f32 = x as f32 / w as f32;
            let fy: f32 = y as f32 / h as f32;
            // 生成污渍 smudge
            let smudge: f32 = fbm(fx * 5.0 + 3.7, fy * 5.0 + 1.2, 11, 4, 5);
            let smudge_a: f32 = clamp01((smudge - 0.42) * 4.0) * 0.55;
            // 生成划痕 scratch
            // 已知走样:71 条斜线摊在 256px 贴图上,每条不到 1 个纹素宽,
            // powf(18) 取整后变成规则的斜向点阵而不是自然的划痕.
            // 要修的话把频率调低(例如 71 -> 24)或降低 powf 指数,让线宽 >= 1 纹素.
            let scratch: f32 = scratch_mask(fx, fy, value_noise(fx * 30.0, fy * 30.0, 7, 30));
            // 生成灰尘 dust
            // 密度偏高:阈值 0.78 在 90x90 晶格上留下约 0.8 颗/格,贴图 10% 的像素
            // 都是灰尘点(2048 宽画布上约上万颗).嫌脏就抬阈值或调小下面的 0.6 权重.
            let dust: f32 = value_noise(fx * 90.0, fy * 90.0, 23, 90);
            let dust_a: f32 = if dust > 0.78 {
                (dust - 0.78) * 3.0
            } else {
                0.0
            };

            // 每种污渍对画面的权重,浓度取三者最大值(叠加会糊成一片)
            let w_smudge: f32 = smudge_a;
            let w_scratch: f32 = scratch * 0.25;
            let w_dust: f32 = dust_a * 0.6;
            let a: f32 = (w_smudge.max(w_scratch).max(w_dust)).min(1.0);
            // 颜色按各自权重混合:纯污渍处偏暖,纯灰尘处偏冷,划痕最浅
            // weight 极小的像素 alpha 取整后本来就是 0,直接保持 1.0:
            // 既省掉一次除法,也避免次正规数(denormal)参与除法把颜色算花.
            const MIN_WEIGHT: f32 = 1.0e-3;
            let weight: f32 = w_smudge + w_scratch + w_dust;
            let mut rgb: [f32; 3] = [1.0, 1.0, 1.0];
            if weight > MIN_WEIGHT {
                for c in 0..3 {
                    rgb[c] = (SMUDGE_TINT[c] * w_smudge
                        + SCRATCH_TINT[c] * w_scratch
                        + DUST_TINT[c] * w_dust)
                        / weight;
                }
            }

            let i = ((y * w + x) * 4) as usize;
            out[i] = (rgb[0] * 255.0) as u8;
            out[i + 1] = (rgb[1] * 255.0) as u8;
            out[i + 2] = (rgb[2] * 255.0) as u8;
            out[i + 3] = (a * 255.0) as u8;
        }
    }
    (w, h, out)
}

pub fn generate_fog(w: u32, h: u32) -> (u32, u32, Vec<u8>) {
    let mut out: Vec<u8> = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let fx: f32 = x as f32 / w as f32;
            let fy: f32 = y as f32 / h as f32;
            // 采样坐标是 uv * (1.6, 1.3) 且 u 随 time 漂移:两个方向都会被推过 1,
            // 所以 fbm 必须双向可平铺(着色器里再用 fract 折回),
            // 否则 u 越界是一条竖缝,v 越界会被 ClampToEdge 拉成横条.
            let n1: f32 = fbm(fx * 3.0, fy * 3.0, 42, 5, 3);
            let n2: f32 = fbm(fx * 7.0 + 2.0, fy * 7.0 + 1.0, 43, 3, 7);
            let v: f32 = clamp01((n1 * 0.7 + n2 * 0.3) * 1.2);
            let i: usize = ((y * w + x) * 4) as usize;
            out[i] = (v * 255.0) as u8;
            out[i + 1] = (v * 235.0) as u8;
            out[i + 2] = (v * 245.0) as u8;
            out[i + 3] = (v * 255.0) as u8;
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
    let mut out: Vec<u8> = vec![0u8; (w * h * 4) as usize];
    let passengers: [(f32, f32, f32); 4] = [
        (0.18f32, 0.76f32, 0.11f32),
        (0.40, 0.80, 0.13),
        (0.66, 0.74, 0.10),
        (0.88, 0.82, 0.12),
    ];
    for y in 0..h {
        for x in 0..w {
            let fx: f32 = x as f32 / w as f32;
            let fy: f32 = y as f32 / h as f32;
            let mut r: f32 = 0.0f32;
            let mut g: f32 = 0.0;
            let mut b: f32 = 0.0;
            let mut a: f32 = 0.0;

            // 顶部车厢灯光条
            let strip: f32 = smoothstep(0.0, 0.03, fy) * (1.0 - smoothstep(0.10, 0.17, fy));
            let segments: f32 = 0.55 + 0.45 * (fx * 26.0 * std::f32::consts::PI).sin();
            let warm: f32 = strip * segments;
            r += 0.98 * warm;
            g += 0.88 * warm;
            b += 0.70 * warm;
            a += warm * 0.48;

            // 车窗框下沿的反光
            let rail: f32 =
                (1.0 - clamp01(((fy - 0.38) / 0.010).abs())) * (0.45 + 0.15 * (fx * 40.0).sin());
            r += 0.55 * rail;
            g += 0.60 * rail;
            b += 0.68 * rail;
            a += rail * 0.16;

            // 乘客倒影(暗色虚影)
            for &(cx, cy, s) in &passengers {
                let dx: f32 = (fx - cx) / s;
                let dy: f32 = (fy - cy) / (s * 1.7);
                let head: f32 = (-(dx * dx + dy * dy) * 9.0).exp();
                let shx: f32 = (fx - cx) / (s * 1.6);
                let shy: f32 = (fy - (cy + 0.10)) / (s * 1.15);
                let shoulders: f32 = (-(shx * shx + shy * shy) * 6.0).exp();
                let ghost: f32 = clamp01(head + shoulders * 0.75) * 0.22;
                r += 0.16 * ghost;
                g += 0.19 * ghost;
                b += 0.28 * ghost;
                a += ghost;
            }

            let i: usize = ((y * w + x) * 4) as usize;
            out[i] = (clamp01(r) * 255.0) as u8;
            out[i + 1] = (clamp01(g) * 255.0) as u8;
            out[i + 2] = (clamp01(b) * 255.0) as u8;
            out[i + 3] = (clamp01(a) * 255.0) as u8;
        }
    }
    (w, h, out)
}

/*
测试用的 ppm 可视化输出
- 统一写到本 crate 根下的 prompt/(cargo test 的 cwd 就是 crate 根,即
  metro_window/prompt):这些图是给 prompt 当素材看的,该目录已被仓库根
  .gitignore 的 /metro_window/prompt 忽略,不往仓库里丢生成物;
- 目录不存在时自动创建,单独跑某个测试也不会失败.
*/
#[cfg(test)]
pub(crate) fn write_ppm(name: &str, w: u32, h: u32, pixels: &[u8]) {
    let dir: &std::path::Path = std::path::Path::new("prompt");
    std::fs::create_dir_all(dir).expect("创建 prompt/ 失败");
    let mut header: Vec<u8> = format!("P6\n{w} {h}\n255\n").into_bytes();
    header.extend_from_slice(pixels);
    let path: std::path::PathBuf = dir.join(name);
    std::fs::write(&path, header).unwrap_or_else(|e| panic!("写入 {} 失败: {e}", path.display()));
}

#[cfg(test)]
mod tests {
    use super::{fbm, generate_dirt, scratch_mask, value_noise, write_ppm};

    /*
    污渍贴图的 RGB 是"乘性颜色"而不是遮罩:
    一旦把某个遮罩直接写进通道(例如把 smudge 写进 R,G/B 留 0),
    着色器 c * dirt.rgb 就会把玻璃染成红棕/蓝色.这里守住"颜色必须接近中性".
    */
    #[test]
    fn dirt_color_stays_neutral() {
        let (_, _, data) = generate_dirt(64, 64);
        for px in data.as_chunks::<4>().0 {
            let (r, g, b) = (px[0] as i32, px[1] as i32, px[2] as i32);
            let (max, min) = (r.max(g).max(b), r.min(g).min(b));
            assert!(min >= 120, "污渍颜色过暗,画面会被压黑: {px:?}");
            assert!(max - min <= 50, "污渍偏色过大(RGB 被当成遮罩用了?): {px:?}");
        }
    }

    /*
    纹理要能被平铺采样:噪声在 x(Repeat 折回)和 y(fract 折回)上都必须是周期的,
    否则雾气会出现贯穿画面的竖缝,污渍/雾气会被 ClampToEdge 把边缘拉成一片.
    */
    #[test]
    fn noise_tiles_seamlessly() {
        // 周期 = 第 0 层晶格周期,采样点再乘上相同的倍率就落在完全相同的晶格相位上
        for (period, seed, octaves) in [(3u32, 42u32, 5u32), (7, 43, 3), (5, 11, 4)] {
            for i in 0..16 {
                let t: f32 = i as f32 / 16.0;
                let base: f32 = t * period as f32 + 2.0;
                for v in [0.25f32, 1.0, 2.75] {
                    let here: f32 = fbm(base, v, seed, octaves, period);
                    let next_x: f32 = fbm(base + period as f32, v, seed, octaves, period);
                    let next_y: f32 = fbm(base, v + period as f32, seed, octaves, period);
                    assert!(
                        (here - next_x).abs() < 1e-6,
                        "x 方向不平铺: period={period} t={t} v={v} {here} != {next_x}"
                    );
                    assert!(
                        (here - next_y).abs() < 1e-6,
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
        for i in 0..16 {
            let fx: f32 = i as f32 / 16.0;
            let fy: f32 = ((i * 5) % 16) as f32 / 16.0;
            let here: f32 = scratch_mask(fx, fy, 0.7);
            assert!(
                (here - scratch_mask(fx + 1.0, fy, 0.7)).abs() < 1e-6,
                "划痕 x 方向不平铺: fx={fx} fy={fy}"
            );
            assert!(
                (here - scratch_mask(fx, fy + 1.0, 0.7)).abs() < 1e-6,
                "划痕 y 方向不平铺: fx={fx} fy={fy}"
            );
        }
    }

    /*
    生成一整64x64的灰度图片
    */
    #[test]
    fn dump_value_noise_ppm() {
        const W: u32 = 64;
        const H: u32 = 64;

        let mut pixels: Vec<u8> = Vec::with_capacity((W * H * 3) as usize);
        for y in 0..H {
            for x in 0..W {
                // seed=0 时,异或 yi ^ 0 = yi
                // value_noise(x, y, 0) == hash01(x, y)
                let v: u8 = (value_noise(x as f32, y as f32, 114, 0) * 255.0).round() as u8;
                pixels.extend_from_slice(&[v, v, v]);
            }
        }

        write_ppm("value_noise_64x64.ppm", W, H, &pixels);
    }

    /*
    更多过渡
    */
    #[test]
    fn dump_value_noise_smooth_ppm() {
        const W: u32 = 512; // 放大分辨率看得更清楚
        const H: u32 = 512;

        let mut pixels: Vec<u8> = Vec::with_capacity((W * H * 3) as usize);
        for y in 0..H {
            for x in 0..W {
                // 关键改动:把 0..512 映射到 0..8 的浮点数范围
                // 这样会让采样点落在网格内部,触发插值
                let fx: f32 = x as f32;
                let fy: f32 = y as f32;
                let v: u8 = (value_noise(fx, fy, 0, 0) * 255.0).round() as u8;
                pixels.extend_from_slice(&[v, v, v]);
            }
        }
        // 文件名按真实分辨率命名:以前这里和上面那个测试都写 value_noise_64x64.ppm,
        // 两个测试并行跑会互相覆盖,谁最后写完谁说了算.
        write_ppm("value_noise_512x512.ppm", W, H, &pixels);
    }

    /*
    更多过渡:采样点落在网格内部,触发插值
    */
    #[test]
    fn dump_fbm_smooth_ppm() {
        const W: u32 = 512; // 放大分辨率看得更清楚
        const H: u32 = 512;

        let mut pixels: Vec<u8> = Vec::with_capacity((W * H * 3) as usize);
        for y in 0..H {
            for x in 0..W {
                // 把 0..512 映射到 0..8 的浮点数范围
                // 这样会让采样点落在网格内部,触发插值
                let fx: f32 = x as f32 / 64.0; // 范围 0.0 ~ 7.98
                let fy: f32 = y as f32 / 64.0; // 范围 0.0 ~ 7.98
                let v: u8 = (fbm(fx, fy, 0, 6, 0) * 255.0).round() as u8;
                pixels.extend_from_slice(&[v, v, v]);
            }
        }
        write_ppm("fbm_512x512.ppm", W, H, &pixels);
    }
}
