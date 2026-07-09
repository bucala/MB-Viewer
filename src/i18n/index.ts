import { useMemo } from 'react';
import { useSettings, type Lang } from '@/store/settingsStore';

const en = {
  'toolbar.menu': 'Menu',
  'toolbar.tree': 'Tree',
  'toolbar.open': 'Open',
  'toolbar.select': 'Select',
  'toolbar.auto': 'Auto',
  'toolbar.distance': 'Distance',
  'toolbar.angle': 'Angle',
  'toolbar.diameter': 'Diameter',
  'toolbar.p2p': 'P2P',
  'toolbar.material': 'Material',
  'toolbar.section': 'Section',
  'toolbar.fit': 'Fit',

  'tip.menu': 'Settings and tools',
  'tip.tree': 'Toggle the project tree',
  'tip.open': 'Open a CAD file (STEP, IGES, BREP, STL, OBJ, GLB)',
  'tip.select': 'Select parts (Esc)',
  'tip.auto': 'Smart measure — cylinder/circular edge → Ø, cone → angle, faces & edges pair into distance or angle',
  'tip.distance': 'Distance — pick two faces, edges or points',
  'tip.angle': 'Angle — pick two faces or edges (a cone measures directly)',
  'tip.diameter': 'Diameter — click a cylinder or a circular edge (or pick 3 points)',
  'tip.p2p': 'Measure the distance between two picked points (snaps to vertices)',
  'tip.material': 'Materials & colors',
  'tip.section': 'Cross-section — cut the model with an X/Y/Z plane',
  'tip.fit': 'Fit the model in view',
  'tip.clear': 'Clear all measurements',
  'chip.measurements': 'Measurements: {n}',

  'section.none': 'None',
  'section.x': 'X-Plane',
  'section.y': 'Y-Plane',
  'section.z': 'Z-Plane',
  'section.position': 'Plane position',
  'section.flip': 'Flip side',

  'mat.appliesTo': 'Applies to',
  'mat.entireModel': 'the entire model',
  'mat.original': 'Original',
  'mat.matte': 'Matte Plastic',
  'mat.shiny': 'Shiny Plastic',
  'mat.metal': 'Metal',
  'mat.glass': 'Glass',
  'mat.cadColors': 'Use colors from the CAD file',
  'mat.reset': 'Reset all materials',

  'tree.search': 'Search parts…',
  'tree.empty': 'The assembly tree appears here once a model is loaded.',
  'tree.noModel': 'No model loaded',
  'tree.parts': 'Parts: {n}',
  'tree.noMatch': 'No parts match “{q}”',
  'tree.hide': 'Hide',
  'tree.show': 'Show',
  'tree.transparent': 'Toggle transparency',
  'tree.expand': 'Expand',
  'tree.collapse': 'Collapse',

  'status.ready': 'Ready — open a CAD file to begin',
  'status.parts': 'Parts',
  'status.triangles': 'Triangles',

  'empty.title': 'Open a CAD model',
  'empty.sub': 'Drop a file anywhere, or browse your disk.',
  'empty.open': 'Open file…',
  'empty.sample': 'Load sample',
  'drop.hint': 'Drop to open',

  'load.parsing': 'Parsing {name}…',
  'load.engine': 'OpenCASCADE (WebAssembly) — background worker',

  'err.dismiss': 'Dismiss',
  'err.unsupported': 'Unsupported file type “.{ext}”. Supported: {list}.',
  'err.objEmpty': 'The OBJ file contains no geometry.',
  'err.glbEmpty': 'The GLB file contains no mesh geometry.',
  'err.occt': 'OpenCASCADE could not parse this file. It may be corrupt or use an unsupported schema.',
  'err.worker': 'The CAD parsing worker crashed.',

  'hint.auto.start': 'Smart measure — cylinder/circular edge → Ø, cone → angle; click a flat face or straight edge to start a pair',
  'hint.auto.second': 'Captured — click a second face or edge to finish the measurement',
  'hint.auto.unknown': 'Could not recognize the surface — try the dedicated tools',
  'hint.distance.start': 'Distance — click a face, an edge or a point',
  'hint.distance.second': 'Click the second face, edge or point',
  'hint.distance.nonparallel': 'Not parallel — measured between the picked points',
  'hint.angle.start': 'Angle — click a flat face, an edge or a cone',
  'hint.angle.second': 'Click the second face or edge',
  'hint.angle.invalid': 'The angle tool needs flat faces, straight edges or cylinder/cone axes',
  'hint.radius.start': 'Diameter — click a cylindrical face or a circular edge (or pick 3 points on free-form meshes)',
  'hint.radius.1': 'Diameter — pick a second point along the same circle',
  'hint.radius.2': 'Diameter — pick a third point to fit the circle',
  'hint.p2p.0': 'Point to point — pick the first point (snaps to vertices)',
  'hint.p2p.1': 'Point to point — pick the second point',
  'hint.collinear': 'Those points are collinear — pick three points spread around the curve.',
  'measure.remove': 'Click to remove this measurement',

  'set.title': 'Settings',
  'set.quick': 'Quick actions',
  'set.sample': 'Load sample assembly',
  'set.grid': 'Ground grid',
  'set.language': 'Language',
  'set.skin': 'Appearance',
  'set.skin.white': 'White',
  'set.skin.gray': 'Gray',
  'set.skin.black': 'Black',
  'set.projection': 'Projection',
  'set.projection.perspective': 'Perspective',
  'set.projection.parallel': 'Parallel',
  'set.quality': 'Display quality',
  'set.quality.low': 'Low',
  'set.quality.medium': 'Medium',
  'set.quality.high': 'High',
  'set.transparency': 'Part transparency',
  'set.assoc': 'File associations',
  'set.assocNote': 'Applied immediately on Windows (for the current user); the desktop installer registers them too.',
  'set.assocApplied': 'File associations updated.',
  'set.assocFailed': 'Could not update file associations: {error}',
  'set.apply': 'Apply',
  'set.reset': 'Reset',

  'cube.right': 'RIGHT',
  'cube.left': 'LEFT',
  'cube.top': 'TOP',
  'cube.bottom': 'BOTTOM',
  'cube.front': 'FRONT',
  'cube.back': 'BACK',
};

const sk: Record<TranslationKey, string> = {
  'toolbar.menu': 'Menu',
  'toolbar.tree': 'Strom',
  'toolbar.open': 'Otvoriť',
  'toolbar.select': 'Výber',
  'toolbar.auto': 'Auto',
  'toolbar.distance': 'Vzdialenosť',
  'toolbar.angle': 'Uhol',
  'toolbar.diameter': 'Priemer',
  'toolbar.p2p': 'Bod–bod',
  'toolbar.material': 'Materiál',
  'toolbar.section': 'Rez',
  'toolbar.fit': 'Prispôsobiť',

  'tip.menu': 'Nastavenia a nástroje',
  'tip.tree': 'Zobraziť/skryť strom modelu',
  'tip.open': 'Otvoriť CAD súbor (STEP, IGES, BREP, STL, OBJ, GLB)',
  'tip.select': 'Výber dielov (Esc)',
  'tip.auto': 'Inteligentné meranie — valec/kruhová hrana → Ø, kužeľ → uhol; plochy a hrany sa párujú na vzdialenosť alebo uhol',
  'tip.distance': 'Vzdialenosť — vyberte dve plochy, hrany alebo body',
  'tip.angle': 'Uhol — vyberte dve plochy alebo hrany (kužeľ sa meria priamo)',
  'tip.diameter': 'Priemer — kliknite na valec alebo kruhovú hranu (alebo 3 body)',
  'tip.p2p': 'Meranie vzdialenosti dvoch vybraných bodov (prichytáva sa k vrcholom)',
  'tip.material': 'Materiály a farby',
  'tip.section': 'Rez — orežte model rovinou X/Y/Z',
  'tip.fit': 'Prispôsobiť model oknu',
  'tip.clear': 'Vymazať všetky merania',
  'chip.measurements': 'Merania: {n}',

  'section.none': 'Bez rezu',
  'section.x': 'Rovina X',
  'section.y': 'Rovina Y',
  'section.z': 'Rovina Z',
  'section.position': 'Poloha roviny',
  'section.flip': 'Otočiť stranu',

  'mat.appliesTo': 'Použije sa na',
  'mat.entireModel': 'celý model',
  'mat.original': 'Pôvodný',
  'mat.matte': 'Matný plast',
  'mat.shiny': 'Lesklý plast',
  'mat.metal': 'Kov',
  'mat.glass': 'Sklo',
  'mat.cadColors': 'Použiť farby z CAD súboru',
  'mat.reset': 'Obnoviť všetky materiály',

  'tree.search': 'Hľadať diely…',
  'tree.empty': 'Strom zostavy sa zobrazí po načítaní modelu.',
  'tree.noModel': 'Žiadny model',
  'tree.parts': 'Diely: {n}',
  'tree.noMatch': 'Výrazu „{q}“ nezodpovedá žiadny diel',
  'tree.hide': 'Skryť',
  'tree.show': 'Zobraziť',
  'tree.transparent': 'Prepnúť priehľadnosť',
  'tree.expand': 'Rozbaliť',
  'tree.collapse': 'Zbaliť',

  'status.ready': 'Pripravené — začnite otvorením CAD súboru',
  'status.parts': 'Diely',
  'status.triangles': 'Trojuholníky',

  'empty.title': 'Otvorte CAD model',
  'empty.sub': 'Presuňte súbor kamkoľvek do okna alebo ho vyberte z disku.',
  'empty.open': 'Otvoriť súbor…',
  'empty.sample': 'Načítať ukážku',
  'drop.hint': 'Pustením otvoríte',

  'load.parsing': 'Spracúva sa {name}…',
  'load.engine': 'OpenCASCADE (WebAssembly) — beží na pozadí',

  'err.dismiss': 'Zavrieť',
  'err.unsupported': 'Nepodporovaný typ súboru „.{ext}“. Podporované: {list}.',
  'err.objEmpty': 'Súbor OBJ neobsahuje žiadnu geometriu.',
  'err.glbEmpty': 'Súbor GLB neobsahuje žiadnu geometriu.',
  'err.occt': 'OpenCASCADE nedokázal spracovať tento súbor. Môže byť poškodený alebo používa nepodporovanú schému.',
  'err.worker': 'Proces spracovania CAD súboru zlyhal.',

  'hint.auto.start': 'Inteligentné meranie — valec/kruhová hrana → Ø, kužeľ → uhol; kliknite na rovinnú plochu alebo priamu hranu na začatie páru',
  'hint.auto.second': 'Zachytené — kliknite na druhú plochu alebo hranu na dokončenie merania',
  'hint.auto.unknown': 'Plochu sa nepodarilo rozpoznať — skúste špecializované nástroje merania',
  'hint.distance.start': 'Vzdialenosť — kliknite na plochu, hranu alebo bod',
  'hint.distance.second': 'Kliknite na druhú plochu, hranu alebo bod',
  'hint.distance.nonparallel': 'Nie sú rovnobežné — merané medzi vybranými bodmi',
  'hint.angle.start': 'Uhol — kliknite na rovinnú plochu, hranu alebo kužeľ',
  'hint.angle.second': 'Kliknite na druhú plochu alebo hranu',
  'hint.angle.invalid': 'Uhol vyžaduje rovinné plochy, priame hrany alebo osi valca/kužeľa',
  'hint.radius.start': 'Priemer — kliknite na valcovú plochu alebo kruhovú hranu (na voľných plochách vyberte 3 body)',
  'hint.radius.1': 'Priemer — vyberte druhý bod na tej istej kružnici',
  'hint.radius.2': 'Priemer — vyberte tretí bod na preloženie kružnice',
  'hint.p2p.0': 'Bod–bod — vyberte prvý bod (prichytáva sa k vrcholom)',
  'hint.p2p.1': 'Bod–bod — vyberte druhý bod',
  'hint.collinear': 'Body ležia na priamke — vyberte tri body rozložené po krivke.',
  'measure.remove': 'Kliknutím odstránite toto meranie',

  'set.title': 'Nastavenia',
  'set.quick': 'Rýchle akcie',
  'set.sample': 'Načítať ukážkovú zostavu',
  'set.grid': 'Mriežka podlahy',
  'set.language': 'Jazyk',
  'set.skin': 'Vzhľad',
  'set.skin.white': 'Biely',
  'set.skin.gray': 'Sivý',
  'set.skin.black': 'Čierny',
  'set.projection': 'Zobrazenie',
  'set.projection.perspective': 'Perspektívne',
  'set.projection.parallel': 'Rovnobežné',
  'set.quality': 'Kvalita zobrazenia',
  'set.quality.low': 'Nízka',
  'set.quality.medium': 'Stredná',
  'set.quality.high': 'Vysoká',
  'set.transparency': 'Priehľadnosť dielov',
  'set.assoc': 'Asociácie súborov',
  'set.assocNote': 'Na Windows sa použijú okamžite (pre aktuálneho používateľa); registruje ich aj inštalátor.',
  'set.assocApplied': 'Asociácie súborov boli aktualizované.',
  'set.assocFailed': 'Asociácie súborov sa nepodarilo aktualizovať: {error}',
  'set.apply': 'Použiť',
  'set.reset': 'Obnoviť predvolené',

  'cube.right': 'PRAVÁ',
  'cube.left': 'ĽAVÁ',
  'cube.top': 'HORNÁ',
  'cube.bottom': 'DOLNÁ',
  'cube.front': 'PREDNÁ',
  'cube.back': 'ZADNÁ',
};

export type TranslationKey = keyof typeof en;

const dictionaries: Record<Lang, Record<TranslationKey, string>> = { en, sk };

export function translate(
  lang: Lang,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  let text = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** Translation outside React (stores, loaders) — reads the live language. */
export function tr(key: TranslationKey, params?: Record<string, string | number>): string {
  return translate(useSettings.getState().language, key, params);
}

/** Reactive translation hook for components. */
export function useT() {
  const lang = useSettings((s) => s.language);
  return useMemo(
    () => (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(lang, key, params),
    [lang],
  );
}

/** Locale-aware integer formatting (12 400 in sk, 12,400 in en). */
export function useNumberFormat() {
  const lang = useSettings((s) => s.language);
  return useMemo(() => new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-US'), [lang]);
}
