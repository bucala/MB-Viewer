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
    // Binary STL: 80-byte header + u32 count + 50 bytes per triangle. Some
    // exporters append padding/metadata, so allow trailing bytes — unless the
    // file is really ASCII (a binary header may also start with "solid").
    if bytes.len() >= 84 {
        let count = u32::from_le_bytes([bytes[80], bytes[81], bytes[82], bytes[83]]) as usize;
        let needed = count.checked_mul(50).and_then(|n| n.checked_add(84));
        if let Some(needed) = needed.filter(|_| count > 0) {
            if bytes.len() == needed || (bytes.len() > needed && !looks_ascii_stl(bytes)) {
                return parse_stl_binary(bytes, count);
            }
        }
    }
    parse_stl_ascii(bytes)
}

/// "solid" up front and a "facet" soon after — without copying the file.
fn looks_ascii_stl(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(512)];
    let trimmed = head.iter().position(|b| !b.is_ascii_whitespace()).map_or(&head[..0], |i| &head[i..]);
    trimmed.len() >= 5
        && trimmed[..5].eq_ignore_ascii_case(b"solid")
        && head.windows(5).any(|w| w.eq_ignore_ascii_case(b"facet"))
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
    let start = text.trim_start();
    if !start.get(..5).is_some_and(|p| p.eq_ignore_ascii_case("solid")) {
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
                // OBJ is Y-up (as MB Viewer treats it); the renderer looks at
                // Z-up models, so rotate +90° about X: (x, y, z) -> (x, -z, y).
                verts.push([x, -z, y]);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn binary_stl(triangles: u32, trailing: usize) -> Vec<u8> {
        let mut bytes = vec![0u8; 84 + triangles as usize * 50 + trailing];
        bytes[80..84].copy_from_slice(&triangles.to_le_bytes());
        for t in 0..triangles as usize {
            for (k, value) in [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0].iter().enumerate() {
                let offset = 84 + t * 50 + 12 + k * 4;
                bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            }
        }
        bytes
    }

    #[test]
    fn binary_stl_exact_and_with_trailing_bytes() {
        assert_eq!(parse_auto(&binary_stl(2, 0)).unwrap().tris.len(), 2);
        assert_eq!(parse_auto(&binary_stl(2, 37)).unwrap().tris.len(), 2);
    }

    #[test]
    fn binary_header_starting_with_solid_is_still_binary() {
        let mut bytes = binary_stl(1, 0);
        bytes[..5].copy_from_slice(b"solid");
        assert_eq!(parse_auto(&bytes).unwrap().tris.len(), 1);
    }

    #[test]
    fn ascii_stl() {
        let text = b"  SOLID x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n";
        assert_eq!(parse_auto(text).unwrap().tris.len(), 1);
    }

    #[test]
    fn obj_is_rotated_from_y_up_to_z_up() {
        let mesh = parse_auto(b"v 0 5 0\nv 1 5 0\nv 0 5 1\nf 1 2 3\n").unwrap();
        assert_eq!(mesh.max[2], 5.0);
        assert_eq!(mesh.min[1], -1.0);
    }

    #[test]
    fn garbage_and_truncated_input_yield_none() {
        assert!(parse_auto(b"").is_none());
        assert!(parse_auto(&[0xff; 300]).is_none());
        let mut truncated = binary_stl(4, 0);
        truncated.truncate(84 + 120);
        assert!(parse_auto(&truncated).is_none());
    }
}
