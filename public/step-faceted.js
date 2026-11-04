/**
 * Fast path for unstyled, standalone, millimeter FACETED_BREP models whose
 * faces are already triangles. Rebuilding hundreds of thousands of planar
 * CAD faces in OpenCASCADE is both expensive and unnecessary for these files.
 *
 * This is deliberately not a general STEP reader. Unsupported topology,
 * units, styles, placements or representations return null, so the worker
 * can use OpenCASCADE without silently dropping part of a model.
 */
(() => {
  const ignoredTypes = new Set([
    'APPLICATION_CONTEXT', 'APPLICATION_PROTOCOL_DEFINITION', 'PRODUCT_CONTEXT',
    'PRODUCT', 'PRODUCT_DEFINITION_FORMATION', 'PRODUCT_DEFINITION_CONTEXT',
    'PRODUCT_DEFINITION', 'PRODUCT_DEFINITION_SHAPE', 'UNCERTAINTY_MEASURE_WITH_UNIT',
    'DIRECTION', 'AXIS2_PLACEMENT_3D',
  ]);

  // Split on STEP statement boundaries, not lines. A shell's reference list
  // can span megabytes; quoted strings and comments can contain semicolons.
  function* statements(text) {
    let start = 0;
    let prefix = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      if (char === 39) {
        if (quoted && text.charCodeAt(i + 1) === 39) i++;
        else quoted = !quoted;
      } else if (!quoted && char === 47 && text.charCodeAt(i + 1) === 42) {
        prefix += text.slice(start, i) + ' ';
        const end = text.indexOf('*/', i + 2);
        if (end < 0) throw new Error('Unterminated STEP comment.');
        i = end + 1;
        start = i + 1;
      } else if (!quoted && char === 59) {
        const statement = (prefix + text.slice(start, i)).trim();
        if (statement) yield statement;
        prefix = '';
        start = i + 1;
      }
    }
    if (quoted || (prefix + text.slice(start)).trim()) {
      throw new Error('Unterminated STEP statement.');
    }
  }

  function references(value) {
    value = value.trim();
    if (value[0] !== '(' || value[value.length - 1] !== ')') return null;
    const body = value.slice(1, -1);
    const ids = [];
    const pattern = /#([1-9]\d*)/g;
    let end = 0;
    let match;
    while ((match = pattern.exec(body))) {
      if (body.slice(end, match.index).trim() !== (ids.length ? ',' : '')) return null;
      const id = Number(match[1]);
      if (!Number.isSafeInteger(id)) return null;
      ids.push(id);
      end = pattern.lastIndex;
    }
    return body.slice(end).trim() ? null : ids;
  }

  function labelled(value) {
    const match = /^'((?:[^']|'')*)'\s*,\s*([\s\S]*)$/.exec(value);
    return match ? { name: match[1].replace(/''/g, "'"), rest: match[2] } : null;
  }

  function parse(text) {
    const points = new Map();
    const loops = new Map();
    const bounds = new Map();
    const faces = new Map();
    const planes = new Set();
    const shells = new Map();
    const solids = new Map();
    const representations = new Map();
    const shapeLinks = [];
    const millimeterUnits = new Set();
    const contexts = new Map();
    let phase = 0;

    for (const statement of statements(text)) {
      // Accept one complete Part 21 data section, not an arbitrary fragment
      // that happens to contain some recognizable geometry.
      if (phase === 0 && statement === 'ISO-10303-21') { phase = 1; continue; }
      if (phase === 1 && statement === 'HEADER') { phase = 2; continue; }
      if (phase === 2) {
        if (statement === 'ENDSEC') phase = 3;
        else if (!/^FILE_(?:DESCRIPTION|NAME|SCHEMA)\s*\(/.test(statement)) return null;
        continue;
      }
      if (phase === 3 && statement === 'DATA') { phase = 4; continue; }
      if (phase === 4 && statement === 'ENDSEC') { phase = 5; continue; }
      if (phase === 5 && statement === 'END-ISO-10303-21') { phase = 6; continue; }
      if (phase !== 4) return null;

      const entity = /^#([1-9]\d*)\s*=\s*(?:([A-Z][A-Z0-9_]*)\s*)?\(([\s\S]*)\)$/i.exec(statement);
      if (!entity) return null;
      const id = Number(entity[1]);
      if (!Number.isSafeInteger(id)) return null;
      const type = entity[2]?.toUpperCase();
      const args = entity[3].trim();
      if (ignoredTypes.has(type)) continue;

      if (!type) {
        const compact = args.replace(/\s+/g, '');
        if (compact === 'LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.)') {
          millimeterUnits.add(id);
        } else if (
          compact === 'NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.)' ||
          compact === 'NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT()'
        ) {
          // Angular units do not affect the supplied triangle coordinates.
        } else {
          const context = /^GEOMETRIC_REPRESENTATION_CONTEXT\(3\)(?:GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT\(\(#[\d#,]+\)\))?GLOBAL_UNIT_ASSIGNED_CONTEXT\((\([^()]*\))\)REPRESENTATION_CONTEXT\('(?:[^']|'')*','(?:[^']|'')*'\)$/.exec(compact);
          const units = context && references(context[1]);
          if (!units) return null;
          contexts.set(id, units);
        }
        continue;
      }

      if (type === 'SHAPE_DEFINITION_REPRESENTATION') {
        const link = /^#[1-9]\d*\s*,\s*#([1-9]\d*)$/.exec(args);
        if (!link) return null;
        shapeLinks.push(Number(link[1]));
        continue;
      }

      const label = labelled(args);
      if (!label) return null;
      const { name, rest } = label;
      if (type === 'CARTESIAN_POINT') {
        const coordinates = /^\(\s*([^()]*)\s*\)$/.exec(rest);
        if (!coordinates) return null;
        const values = coordinates[1].split(',').map((value) => {
          value = value.trim();
          return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?$/i.test(value) ? Number(value) : NaN;
        });
        if (values.length !== 3 || !values.every(Number.isFinite) || points.has(id)) return null;
        points.set(id, values);
      } else if (type === 'POLY_LOOP') {
        const vertices = references(rest);
        // Polygons (especially concave ones) and holes need the CAD kernel.
        if (!vertices || vertices.length !== 3 || loops.has(id)) return null;
        loops.set(id, vertices);
      } else if (type === 'FACE_OUTER_BOUND') {
        const bound = /^#([1-9]\d*)\s*,\s*\.([TF])\.$/.exec(rest);
        if (!bound || bounds.has(id)) return null;
        bounds.set(id, Number(bound[1]) * (bound[2] === 'T' ? 1 : -1));
      } else if (type === 'FACE' || type === 'FACE_SURFACE') {
        const face = type === 'FACE'
          ? /^\(\s*#([1-9]\d*)\s*\)$/.exec(rest)
          : /^\(\s*#([1-9]\d*)\s*\)\s*,\s*#([1-9]\d*)\s*,\s*\.T\.$/.exec(rest);
        if (!face || faces.has(id)) return null;
        faces.set(id, { bound: Number(face[1]), plane: face[2] ? Number(face[2]) : null });
      } else if (type === 'PLANE') {
        if (!/^#[1-9]\d*$/.test(rest)) return null;
        planes.add(id);
      } else if (type === 'CLOSED_SHELL') {
        const items = references(rest);
        if (!items?.length || shells.has(id)) return null;
        shells.set(id, items);
      } else if (type === 'FACETED_BREP') {
        const shell = /^#([1-9]\d*)$/.exec(rest);
        if (!shell || solids.has(id)) return null;
        solids.set(id, { name, shell: Number(shell[1]) });
      } else if (type === 'SHAPE_REPRESENTATION' || type === 'FACETED_BREP_SHAPE_REPRESENTATION') {
        const representation = /^(\([\s\S]*\))\s*,\s*#([1-9]\d*)$/.exec(rest);
        const items = representation && references(representation[1]);
        if (!items?.length || representations.has(id)) return null;
        representations.set(id, { name, items, context: Number(representation[2]) });
      } else {
        return null;
      }
    }

    if (phase !== 6 || !solids.size || representations.size !== 1 || shapeLinks.length !== 1) return null;
    const representation = representations.get(shapeLinks[0]);
    if (!representation || representation.items.length !== solids.size ||
        new Set(representation.items).size !== solids.size) return null;
    const units = contexts.get(representation.context);
    if (!units || units.filter((id) => millimeterUnits.has(id)).length !== 1) return null;

    const meshes = [];
    for (const solidId of representation.items) {
      const solid = solids.get(solidId);
      const shell = solid && shells.get(solid.shell);
      if (!shell) return null;
      const positions = new Float32Array(shell.length * 9);
      const normals = new Float32Array(positions.length);
      let offset = 0;
      for (const faceId of shell) {
        const face = faces.get(faceId);
        if (!face || (face.plane !== null && !planes.has(face.plane))) return null;
        const bound = bounds.get(face.bound);
        const loop = bound && loops.get(Math.abs(bound));
        if (!loop) return null;
        const a = points.get(loop[0]);
        const b = points.get(loop[bound > 0 ? 1 : 2]);
        const c = points.get(loop[bound > 0 ? 2 : 1]);
        if (!a || !b || !c) return null;

        positions.set(a, offset);
        positions.set(b, offset + 3);
        positions.set(c, offset + 6);
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const length = Math.hypot(nx, ny, nz) || 1;
        for (let vertex = 0; vertex < 3; vertex++) {
          normals[offset + vertex * 3] = nx / length;
          normals[offset + vertex * 3 + 1] = ny / length;
          normals[offset + vertex * 3 + 2] = nz / length;
        }
        offset += 9;
      }
      if (!positions.every(Number.isFinite) || !normals.every(Number.isFinite)) return null;
      meshes.push({ name: solid.name, color: null, positions, normals, indices: null });
    }
    return {
      meshes,
      root: {
        name: representation.name,
        meshes: [],
        children: meshes.map((mesh, i) => ({ name: mesh.name, meshes: [i], children: [] })),
      },
    };
  }

  self.readFacetedStep = (bytes) => {
    const text = new TextDecoder().decode(bytes);
    if (!/\bFACETED_BREP\s*\(/.test(text)) return null;
    try {
      return parse(text);
    } catch {
      // A failed fast-path attempt must never prevent the general importer.
      return null;
    }
  };
})();
