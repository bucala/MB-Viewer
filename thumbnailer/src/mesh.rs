//! Minimal triangle-mesh parsing for the formats that carry ready-to-draw
//! geometry: STL (binary + ASCII) and Wavefront OBJ. B-rep formats (STEP,
//! IGES, BREP) need OpenCASCADE tessellation and are intentionally skipped —
//! Explorer falls back to the app icon for those.

pub type V3 = [f32; 3];

pub struct Mesh {
    pub tris: Vec<[V3; 3]>,
    pub min: V3,
    pub max: V3,
}

impl Mesh {
    fn from_tris(tris: Vec<[V3; 3]>) -> Option<Mesh> {
        if tris.is_empty() {
            return None;
        }
        let mut min = [f32::MAX; 3];
        let mut max = [f32::MIN; 3];
        for tri in &tris {
            for v in tri {
                for k in 0..3 {
                    if v[k] < min[k] {
                        min[k] = v[k];
                    }
                    if v[k] > max[k] {
                        max[k] = v[k];
                    }
                }
            }
        }
        if !min.iter().chain(max.iter()).all(|c| c.is_finite()) {
            return None;
        }
        Some(Mesh { tris, min, max })
    }

    pub fn center(&self) -> V3 {
        [
            (self.min[0] + self.max[0]) * 0.5,
            (self.min[1] + self.max[1]) * 0.5,
            (self.min[2] + self.max[2]) * 0.5,
        ]
    }

    /// Radius of the bounding sphere around the center (>= tiny epsilon).
    pub fn radius(&self) -> f32 {
        let d = [
            self.max[0] - self.min[0],
            self.max[1] - self.min[1],
            self.max[2] - self.min[2],
        ];
        (0.5 * (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt()).max(1e-4)
    }
}

/// Detect the format purely from content (the thumbnail shell never tells us
/// the extension) and parse. Returns None when nothing usable was found.
pub fn parse_auto(bytes: &[u8]) -> Option<Mesh> {
    parse_stl(bytes).or_else(|| parse_obj(bytes))
}

fn parse_stl(bytes: &[u8]) -> Option<Mesh> {
    // Binary STL: 80-byte header + u32 count + 50 bytes per triangle.
    if bytes.len() >= 84 {
        let count = u32::from_le_bytes([bytes[80], bytes[81], bytes[82], bytes[83]]) as usize;
        if bytes.len() == 84 + count * 50 && count > 0 {
            return parse_stl_binary(bytes, count);
        }
    }
    parse_stl_ascii(bytes)
}

fn parse_stl_binary(bytes: &[u8], count: usize) -> Option<Mesh> {
    let mut tris = Vec::with_capacity(count);
    let mut off = 84;
    let f = |b: &[u8], i: usize| f32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
    for _ in 0..count {
        // Skip the 12-byte normal, read three 12-byte vertices, skip 2-byte attr.
        let base = off + 12;
        let mut tri = [[0.0f32; 3]; 3];
        for (vi, v) in tri.iter_mut().enumerate() {
            let vb = base + vi * 12;
            *v = [f(bytes, vb), f(bytes, vb + 4), f(bytes, vb + 8)];
        }
        tris.push(tri);
        off += 50;
    }
    Mesh::from_tris(tris)
}

fn parse_stl_ascii(bytes: &[u8]) -> Option<Mesh> {
    let text = std::str::from_utf8(bytes).ok()?;
    if !text.trim_start().to_ascii_lowercase().starts_with("solid") {
        return None;
    }
    let mut verts: Vec<V3> = Vec::new();
    for line in text.lines() {
        let line = line.trim_start();
        if let Some(rest) = line.strip_prefix("vertex") {
            let mut it = rest.split_whitespace().filter_map(|t| t.parse::<f32>().ok());
            if let (Some(x), Some(y), Some(z)) = (it.next(), it.next(), it.next()) {
                verts.push([x, y, z]);
            }
        }
    }
    let tris = verts.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
    Mesh::from_tris(tris)
}

fn parse_obj(bytes: &[u8]) -> Option<Mesh> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut verts: Vec<V3> = Vec::new();
    let mut tris: Vec<[V3; 3]> = Vec::new();
    for line in text.lines() {
        let line = line.trim_start();
        if let Some(rest) = line.strip_prefix("v ") {
            let mut it = rest.split_whitespace().filter_map(|t| t.parse::<f32>().ok());
            if let (Some(x), Some(y), Some(z)) = (it.next(), it.next(), it.next()) {
                verts.push([x, y, z]);
            }
        } else if let Some(rest) = line.strip_prefix("f ") {
            let idx: Vec<usize> = rest
                .split_whitespace()
                .filter_map(|tok| {
                    let first = tok.split('/').next()?;
                    let n: i64 = first.parse().ok()?;
                    let i = if n < 0 { verts.len() as i64 + n } else { n - 1 };
                    if i >= 0 && (i as usize) < verts.len() {
                        Some(i as usize)
                    } else {
                        None
                    }
                })
                .collect();
            // Triangulate the polygon as a fan.
            for k in 1..idx.len().saturating_sub(1) {
                tris.push([verts[idx[0]], verts[idx[k]], verts[idx[k + 1]]]);
            }
        }
    }
    Mesh::from_tris(tris)
}
