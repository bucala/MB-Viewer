import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const parserSource = readFileSync(new URL('../public/step-faceted.js', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../public/occt-worker.js', import.meta.url), 'utf8');
const encode = (value) => new TextEncoder().encode(value);
const context = vm.createContext({ self: {}, TextDecoder, Float32Array });
vm.runInContext(parserSource, context);
const parse = (value) => context.self.readFacetedStep(encode(value));

// Small, generated geometry only. Real user models are intentionally not
// checked in or required to run the regression suite.
const triangle = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Triangulated workpiece'),'2;1');
FILE_NAME('triangle.stp','',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1=APPLICATION_CONTEXT('automotive_design');
#9=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
#10=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));
#11=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());
#12=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-4),#9,'','');
#13=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#12))GLOBAL_UNIT_ASSIGNED_CONTEXT((#9,#10,#11))REPRESENTATION_CONTEXT('','3D'));
#14=CARTESIAN_POINT('',(0.,0.,0.));
#15=CARTESIAN_POINT('',(10.,0.,0.));
#16=CARTESIAN_POINT('',(0.,10.,0.));
#17=DIRECTION('',(0.,0.,1.));
#18=DIRECTION('',(1.,0.,0.));
#19=AXIS2_PLACEMENT_3D('',#14,#17,#18);
#20=PLANE('',#19);
#21=POLY_LOOP('',(#14,#15,#16));
#22=FACE_OUTER_BOUND('',#21,.T.);
#23=FACE_SURFACE('',(#22),#20,.T.);
#24=CLOSED_SHELL('',(#23));
#25=FACETED_BREP('triangles',#24);
#26=SHAPE_REPRESENTATION('',(#25),#13);
#27=SHAPE_DEFINITION_REPRESENTATION(#8,#26);
ENDSEC;
END-ISO-10303-21;
`;

function addEntities(source, entities) {
  return source.replace('\nENDSEC;\nEND-ISO', `\n${entities}\nENDSEC;\nEND-ISO`);
}

test('imports triangular FACETED_BREP as render-ready, millimeter geometry', () => {
  const result = parse(triangle);
  assert.ok(result);
  assert.equal(result.meshes.length, 1);
  const mesh = result.meshes[0];
  assert.ok(mesh.positions instanceof Float32Array);
  assert.ok(mesh.normals instanceof Float32Array);
  assert.deepEqual(Array.from(mesh.positions), [0, 0, 0, 10, 0, 0, 0, 10, 0]);
  assert.deepEqual(Array.from(mesh.normals), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
  assert.equal(mesh.indices, null);
  assert.equal(mesh.color, null);
  assert.equal(result.root.children[0].name, 'triangles');
  assert.deepEqual(Array.from(result.root.children[0].meshes), [0]);
});

test('handles multiline records, comments, quoted semicolons and escaped quotes', () => {
  const source = triangle
    .replace("FACETED_BREP('triangles',#24)", "FACETED_BREP('Tool''s; triangle',#24)")
    .replace("POLY_LOOP('',(#14,#15,#16))", "POLY_LOOP('',(\n#14,/* ; #999=BAD(); */\n#15,#16))");
  const result = parse(source);
  assert.ok(result);
  assert.equal(result.meshes[0].name, "Tool's; triangle");
  assert.equal(result.meshes[0].positions.length, 9);
});

test('supports STEP scientific notation', () => {
  const result = parse(triangle.replace('(10.,0.,0.)', '(1.E+1,+0.E-3,-.0)'));
  assert.ok(result);
  assert.equal(result.meshes[0].positions[3], 10);
});

test('supports topological FACE triangles and reversed loop orientation', () => {
  const result = parse(triangle
    .replace("FACE_SURFACE('',(#22),#20,.T.)", "FACE('',(#22))")
    .replace("FACE_OUTER_BOUND('',#21,.T.)", "FACE_OUTER_BOUND('',#21,.F.)"));
  assert.ok(result);
  assert.deepEqual(Array.from(result.meshes[0].positions), [0, 0, 0, 0, 10, 0, 10, 0, 0]);
  assert.equal(result.meshes[0].normals[2], -1);
});

test('resolves forward references instead of depending on entity order', () => {
  const lines = triangle.trimEnd().split('\n');
  const first = lines.indexOf('DATA;') + 1;
  const last = lines.lastIndexOf('ENDSEC;');
  const source = [...lines.slice(0, first), ...lines.slice(first, last).reverse(), ...lines.slice(last)].join('\n');
  assert.ok(parse(source));
});

test('preserves all standalone solids and their mesh references', () => {
  const source = addEntities(triangle, "#28=FACETED_BREP('second body',#24);")
    .replace("SHAPE_REPRESENTATION('',(#25),#13)", "FACETED_BREP_SHAPE_REPRESENTATION('',(#25,#28),#13)");
  const result = parse(source);
  assert.ok(result);
  assert.equal(result.meshes.length, 2);
  assert.equal(result.root.children[1].name, 'second body');
  assert.deepEqual(Array.from(result.root.children[1].meshes), [1]);
});

test('handles a long shell statement without recursive regex overflow', () => {
  const count = 25000;
  const source = triangle.replace("CLOSED_SHELL('',(#23))", `CLOSED_SHELL('',(${Array(count).fill('#23').join(',')}))`);
  const result = parse(source);
  assert.ok(result);
  assert.equal(result.meshes[0].positions.length / 9, count);
});

test('never emits non-finite normals for a degenerate input triangle', () => {
  const result = parse(triangle.replace("POLY_LOOP('',(#14,#15,#16))", "POLY_LOOP('',(#14,#14,#14))"));
  assert.ok(result);
  assert.ok(result.meshes[0].normals.every(Number.isFinite));
});

test('falls back rather than returning incomplete or incorrectly scaled geometry', async (t) => {
  const cases = {
    'ordinary analytic STEP': triangle.replace('FACETED_BREP', 'MANIFOLD_SOLID_BREP'),
    'non-millimeter units': triangle.replace('SI_UNIT(.MILLI.,.METRE.)', 'SI_UNIT($,.METRE.)'),
    'wrong unit context': triangle.replace('(#9,#10,#11)', '(#10,#11)'),
    'quadrilateral polygon': triangle.replace("POLY_LOOP('',(#14,#15,#16))", "POLY_LOOP('',(#14,#15,#16,#14))"),
    'face with holes': triangle.replace("FACE_SURFACE('',(#22),#20,.T.)", "FACE_SURFACE('',(#22,#22),#20,.T.)"),
    'reversed surface sense': triangle.replace("FACE_SURFACE('',(#22),#20,.T.)", "FACE_SURFACE('',(#22),#20,.F.)"),
    'curved surface': triangle.replace("PLANE('',#19)", "CYLINDRICAL_SURFACE('',#19,10.)"),
    'missing point': triangle.replace("POLY_LOOP('',(#14,#15,#16))", "POLY_LOOP('',(#14,#15,#999))"),
    'missing face': triangle.replace("CLOSED_SHELL('',(#23))", "CLOSED_SHELL('',(#999))"),
    'missing plane': triangle.replace("FACE_SURFACE('',(#22),#20,.T.)", "FACE_SURFACE('',(#22),#999,.T.)"),
    'missing representation': triangle.replace('#27=SHAPE_DEFINITION_REPRESENTATION(#8,#26);', ''),
    'unaccounted solid': addEntities(triangle, "#28=FACETED_BREP('other',#24);"),
    'mixed analytic geometry': addEntities(triangle, "#28=MANIFOLD_SOLID_BREP('other',#24);"),
    'assembly placement': addEntities(triangle, "#28=MAPPED_ITEM('',#25,#19);"),
    'styled geometry': addEntities(triangle, "#28=STYLED_ITEM('',(),#25);"),
    'malformed reference list': triangle.replace('(#14,#15,#16)', '(#14,#15#16)'),
    'non-finite coordinate': triangle.replace('(10.,0.,0.)', '(1.E999,0.,0.)'),
    'truncated file': triangle.replace('END-ISO-10303-21;', ''),
    'unterminated statement': triangle.trimEnd().slice(0, -1),
    'unterminated comment': `${triangle}/* unfinished`,
    'unterminated string': triangle.replace("FACETED_BREP('triangles',#24)", "FACETED_BREP('triangles,#24)"),
  };
  for (const [name, source] of Object.entries(cases)) {
    await t.test(name, () => assert.equal(parse(source), null));
  }
});

function createWorker(engine) {
  const messages = [];
  const imports = [];
  const calls = [];
  const scope = {
    self: { postMessage: (message, transfer) => messages.push({ message, transfer }) },
    TextDecoder, Uint8Array, Float32Array, Uint32Array,
    occtimportjs: async () => ({
      ReadStepFile: (...args) => { calls.push({ format: 'step', args }); return engine; },
      ReadIgesFile: (...args) => { calls.push({ format: 'iges', args }); return engine; },
      ReadBrepFile: (...args) => { calls.push({ format: 'brep', args }); return engine; },
    }),
  };
  const workerContext = vm.createContext(scope);
  scope.importScripts = (path) => {
    imports.push(path);
    if (path === './step-faceted.js') vm.runInContext(parserSource, workerContext);
    else assert.equal(path, './vendor/occt/occt-import-js.js');
  };
  vm.runInContext(workerSource, workerContext);
  return { scope, messages, imports, calls };
}

const engineTriangle = {
  success: true,
  root: { name: 'CAD', meshes: [0], children: [] },
  meshes: [{
    name: 'CAD body',
    attributes: { position: { array: [0, 0, 0, 10, 0, 0, 0, 10, 0] } },
    index: { array: [0, 1, 2] },
  }],
};

test('worker transfers faceted geometry without loading or calling WASM', async () => {
  const worker = createWorker(engineTriangle);
  await worker.scope.self.onmessage({ data: { id: 7, format: 'step', buffer: encode(triangle).buffer } });
  assert.equal(worker.calls.length, 0);
  assert.deepEqual(worker.imports, ['./step-faceted.js']);
  const { message, transfer } = worker.messages[0];
  assert.equal(message.id, 7);
  assert.equal(message.ok, true);
  assert.equal(message.meshes[0].positions.length, 9);
  assert.equal(transfer.length, 2);
  assert.equal(transfer[0], message.meshes[0].positions.buffer);
  assert.equal(transfer[1], message.meshes[0].normals.buffer);
});

test('worker keeps the original STEP, IGES and BREP engine paths', async (t) => {
  for (const format of ['step', 'iges', 'brep']) {
    await t.test(format, async () => {
      const worker = createWorker(engineTriangle);
      const bytes = encode('general CAD input');
      await worker.scope.self.onmessage({ data: { id: 8, format, buffer: bytes.buffer } });
      assert.equal(worker.calls.length, 1);
      assert.equal(worker.calls[0].format, format);
      assert.equal(worker.calls[0].args[1], null);
      assert.ok(worker.imports.includes('./vendor/occt/occt-import-js.js'));
      assert.equal(worker.messages[0].message.ok, true);
      assert.ok(worker.messages[0].message.meshes[0].indices instanceof Uint32Array);
    });
  }
});

test('worker falls back for faceted files outside the supported subset', async () => {
  const worker = createWorker(engineTriangle);
  const source = triangle.replace('SI_UNIT(.MILLI.,.METRE.)', 'SI_UNIT($,.METRE.)');
  await worker.scope.self.onmessage({ data: { id: 9, format: 'step', buffer: encode(source).buffer } });
  assert.equal(worker.calls.length, 1);
  assert.equal(worker.messages[0].message.ok, true);
});

test('worker reports an error instead of accepting successful but empty CAD output', async () => {
  const worker = createWorker({
    success: true,
    root: { meshes: [0], children: [] },
    meshes: [{ attributes: { position: { array: [] } }, index: { array: [] } }],
  });
  await worker.scope.self.onmessage({ data: { id: 10, format: 'step', buffer: new ArrayBuffer(0) } });
  assert.equal(worker.messages[0].message.ok, false);
  assert.equal(worker.messages[0].message.error, 'The CAD file contains no triangle geometry.');
});

test('worker reports an engine parse failure', async () => {
  const worker = createWorker({ success: false });
  await worker.scope.self.onmessage({ data: { id: 11, format: 'step', buffer: new ArrayBuffer(0) } });
  assert.equal(worker.messages[0].message.ok, false);
  assert.match(worker.messages[0].message.error, /^OpenCASCADE could not parse/);
});
