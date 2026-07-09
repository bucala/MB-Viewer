//! Tiny software rasterizer: an orthographic, flat-shaded, z-buffered preview
//! of a triangle mesh. Output is a top-down BGRA buffer (one u32 per pixel,
//! 0xAARRGGBB in native little-endian order) with a transparent background,
//! ready to hand to a 32-bit GDI DIB section.

use crate::mesh::{Mesh, V3};

const BASE_COLOR: V3 = [0.62, 0.68, 0.74];
const AMBIENT: f32 = 0.30;

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn dot(a: V3, b: V3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn norm(a: V3) -> V3 {
    let l = dot(a, a).sqrt();
    if l < 1e-12 {
        [0.0, 0.0, 0.0]
    } else {
        [a[0] / l, a[1] / l, a[2] / l]
    }
}

pub fn render(mesh: &Mesh, size: u32) -> Vec<u32> {
    let w = size.max(1) as usize;
    let h = w;
    let mut pixels = vec![0u32; w * h];
    let mut zbuf = vec![f32::MAX; w * h];

    let center = mesh.center();
    let radius = mesh.radius();

    // View basis: look at the model from front-right, slightly above (Z-up).
    let eye_dir = norm([1.0, -1.0, 0.72]);
    let f = [-eye_dir[0], -eye_dir[1], -eye_dir[2]]; // forward, into the screen
    let up = [0.0, 0.0, 1.0];
    let mut r = norm(cross(f, up));
    if dot(r, r) < 0.5 {
        r = [1.0, 0.0, 0.0]; // model axis parallel to up — pick a stable right
    }
    let u = cross(r, f);

    let light = norm([-0.35, 0.55, -0.75]);
    let scale = (size as f32 * 0.42) / radius;
    let (cx, cy) = (w as f32 * 0.5, h as f32 * 0.5);

    let project = |p: V3| -> (f32, f32, f32) {
        let d = sub(p, center);
        (
            cx + dot(d, r) * scale,
            cy - dot(d, u) * scale,
            dot(d, f),
        )
    };

    for tri in &mesh.tris {
        let n = norm(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])));
        // Two-sided shading: orient the normal toward the viewer.
        let mut nv = [dot(n, r), dot(n, u), dot(n, f)];
        if nv[2] > 0.0 {
            nv = [-nv[0], -nv[1], -nv[2]];
        }
        let intensity = (AMBIENT + (1.0 - AMBIENT) * dot(nv, light).max(0.0)).clamp(0.0, 1.0);
        let color = pack(
            BASE_COLOR[0] * intensity,
            BASE_COLOR[1] * intensity,
            BASE_COLOR[2] * intensity,
        );

        let p0 = project(tri[0]);
        let p1 = project(tri[1]);
        let p2 = project(tri[2]);

        let area = edge(p0, p1, p2);
        if area.abs() < 1e-6 {
            continue;
        }
        let inv_area = 1.0 / area;

        let min_x = p0.0.min(p1.0).min(p2.0).floor().max(0.0) as usize;
        let max_x = (p0.0.max(p1.0).max(p2.0).ceil() as isize).clamp(0, w as isize - 1) as usize;
        let min_y = p0.1.min(p1.1).min(p2.1).floor().max(0.0) as usize;
        let max_y = (p0.1.max(p1.1).max(p2.1).ceil() as isize).clamp(0, h as isize - 1) as usize;

        for py in min_y..=max_y {
            for px in min_x..=max_x {
                let sample = (px as f32 + 0.5, py as f32 + 0.5, 0.0);
                let mut w0 = edge(p1, p2, sample) * inv_area;
                let mut w1 = edge(p2, p0, sample) * inv_area;
                let mut w2 = edge(p0, p1, sample) * inv_area;
                // Accept regardless of winding (meshes may be either).
                if !((w0 >= 0.0 && w1 >= 0.0 && w2 >= 0.0)
                    || (w0 <= 0.0 && w1 <= 0.0 && w2 <= 0.0))
                {
                    continue;
                }
                if area < 0.0 {
                    w0 = -w0;
                    w1 = -w1;
                    w2 = -w2;
                }
                let depth = w0 * p0.2 + w1 * p1.2 + w2 * p2.2;
                let idx = py * w + px;
                if depth < zbuf[idx] {
                    zbuf[idx] = depth;
                    pixels[idx] = color;
                }
            }
        }
    }

    pixels
}

/// Twice the signed area of triangle (a, b, c) in screen space.
fn edge(a: (f32, f32, f32), b: (f32, f32, f32), c: (f32, f32, f32)) -> f32 {
    (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0)
}

fn pack(r: f32, g: f32, b: f32) -> u32 {
    let to = |v: f32| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u32;
    0xFF00_0000 | (to(r) << 16) | (to(g) << 8) | to(b)
}
