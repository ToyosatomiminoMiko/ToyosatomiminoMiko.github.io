/// 行主序 4x4 矩阵,元素顺序为:
/// [m00, m01, m02, m03,
///  m10, m11, m12, m13,
///  m20, m21, m22, m23,
///  m30, m31, m32, m33]
pub type Mat4 = [f64; 16];

pub fn identity4() -> Mat4 {
    [
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    ]
}

pub fn translate4(tx: f64, ty: f64, tz: f64) -> Mat4 {
    [
        1.0, 0.0, 0.0, tx,
        0.0, 1.0, 0.0, ty,
        0.0, 0.0, 1.0, tz,
        0.0, 0.0, 0.0, 1.0,
    ]
}

pub fn scale4(sx: f64, sy: f64, sz: f64) -> Mat4 {
    [
        sx, 0.0, 0.0, 0.0,
        0.0, sy, 0.0, 0.0,
        0.0, 0.0, sz, 0.0,
        0.0, 0.0, 0.0, 1.0,
    ]
}

pub fn rotate4(rx: f64, ry: f64, rz: f64) -> Mat4 {
    let cx = rx.cos();
    let sx = rx.sin();
    let cy = ry.cos();
    let sy = ry.sin();
    let cz = rz.cos();
    let sz = rz.sin();

    let rx_m: Mat4 = [
        1.0, 0.0, 0.0, 0.0,
        0.0, cx, -sx, 0.0,
        0.0, sx, cx, 0.0,
        0.0, 0.0, 0.0, 1.0,
    ];
    let ry_m: Mat4 = [
        cy, 0.0, sy, 0.0,
        0.0, 1.0, 0.0, 0.0,
        -sy, 0.0, cy, 0.0,
        0.0, 0.0, 0.0, 1.0,
    ];
    let rz_m: Mat4 = [
        cz, -sz, 0.0, 0.0,
        sz, cz, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    ];

    multiply4x4(multiply4x4(rz_m, ry_m), rx_m)
}

pub fn multiply4x4(a: Mat4, b: Mat4) -> Mat4 {
    let mut out = [0.0; 16];
    for row in 0..4 {
        for col in 0..4 {
            let mut sum = 0.0;
            for k in 0..4 {
                sum += a[row * 4 + k] * b[k * 4 + col];
            }
            out[row * 4 + col] = sum;
        }
    }
    out
}

pub fn apply_to_point(matrix: Mat4, x: f64, y: f64, z: f64) -> [f64; 3] {
    let v = [x, y, z, 1.0];
    let mut out = [0.0; 4];

    for row in 0..4 {
        out[row] = matrix[row * 4] * v[0]
            + matrix[row * 4 + 1] * v[1]
            + matrix[row * 4 + 2] * v[2]
            + matrix[row * 4 + 3] * v[3];
    }

    [out[0], out[1], out[2]]
}

pub fn from_flat(values: Vec<f64>) -> Result<Mat4, String> {
    if values.len() != 16 {
        return Err(format!("4x4 矩阵需要 16 个元素,实际为 {}", values.len()));
    }

    let mut matrix = [0.0; 16];
    matrix.copy_from_slice(&values);
    Ok(matrix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translate_then_apply_moves_point() {
        let matrix = translate4(2.0, -3.0, 5.0);
        let point = apply_to_point(matrix, 1.0, 2.0, 3.0);

        assert!((point[0] - 3.0).abs() < 1e-12);
        assert!((point[1] + 1.0).abs() < 1e-12);
        assert!((point[2] - 8.0).abs() < 1e-12);
    }

    #[test]
    fn rotation_preserves_vector_length() {
        let matrix = rotate4(0.3, -0.2, 0.7);
        let point = apply_to_point(matrix, 1.0, 2.0, 3.0);
        let length = (point[0] * point[0] + point[1] * point[1] + point[2] * point[2]).sqrt();

        assert!((length - (1.0f64 + 4.0 + 9.0).sqrt()).abs() < 1e-10);
    }
}
