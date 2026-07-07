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
  'toolbar.material': 'Material',
  'toolbar.fit': 'Fit',

  'tip.menu': 'Settings and tools',
  'tip.tree': 'Toggle the project tree',
  'tip.open': 'Open a CAD file (STEP, IGES, BREP, STL, OBJ, GLB)',
  'tip.select': 'Select parts (Esc)',
  'tip.auto': 'Smart measure — cylinder → diameter, two flat faces → distance',
  'tip.distance': 'Measure a distance between two points',
  'tip.angle': 'Measure an angle from three points',
  'tip.diameter': 'Measure a diameter from three points on a circle',
  'tip.material': 'Materials & colors',
  'tip.fit': 'Fit the model in view',
  'tip.clear': 'Clear all measurements',
  'chip.measurements': 'Measurements: {n}',

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

  'hint.distance.0': 'Distance — pick the first point (snaps to vertices)',
  'hint.distance.1': 'Distance — pick the second point',
  'hint.angle.0': 'Angle — pick a point on the first leg',
  'hint.angle.1': 'Angle — pick the corner (vertex) point',
  'hint.angle.2': 'Angle — pick a point on the second leg',
  'hint.radius.0': 'Diameter — pick a first point on the circular edge or face',
  'hint.radius.1': 'Diameter — pick a second point along the same circle',
  'hint.radius.2': 'Diameter — pick a third point to fit the circle',
  'hint.auto.start': 'Smart measure — click a cylinder for its diameter, or a flat face to start a distance',
  'hint.auto.plane': 'Face captured — click a second face to measure the distance',
  'hint.auto.unknown': 'Could not recognize the surface — try the dedicated tools',
  'hint.auto.nonparallel': 'Faces are not parallel — measured between the picked points',
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
  'set.transparency': 'Part transparency',
  'set.assoc': 'File associations',
  'set.assocNote': 'Applied by the Windows desktop installer (Tauri).',
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
  'toolbar.material': 'Materiál',
  'toolbar.fit': 'Prispôsobiť',

  'tip.menu': 'Nastavenia a nástroje',
  'tip.tree': 'Zobraziť/skryť strom modelu',
  'tip.open': 'Otvoriť CAD súbor (STEP, IGES, BREP, STL, OBJ, GLB)',
  'tip.select': 'Výber dielov (Esc)',
  'tip.auto': 'Inteligentné meranie — valec → priemer, dve rovinné plochy → vzdialenosť',
  'tip.distance': 'Meranie vzdialenosti medzi dvoma bodmi',
  'tip.angle': 'Meranie uhla z troch bodov',
  'tip.diameter': 'Meranie priemeru z troch bodov na kružnici',
  'tip.material': 'Materiály a farby',
  'tip.fit': 'Prispôsobiť model oknu',
  'tip.clear': 'Vymazať všetky merania',
  'chip.measurements': 'Merania: {n}',

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

  'hint.distance.0': 'Vzdialenosť — vyberte prvý bod (prichytáva sa k vrcholom)',
  'hint.distance.1': 'Vzdialenosť — vyberte druhý bod',
  'hint.angle.0': 'Uhol — vyberte bod na prvom ramene',
  'hint.angle.1': 'Uhol — vyberte vrcholový bod',
  'hint.angle.2': 'Uhol — vyberte bod na druhom ramene',
  'hint.radius.0': 'Priemer — vyberte prvý bod na kruhovej hrane alebo ploche',
  'hint.radius.1': 'Priemer — vyberte druhý bod na tej istej kružnici',
  'hint.radius.2': 'Priemer — vyberte tretí bod na preloženie kružnice',
  'hint.auto.start': 'Inteligentné meranie — kliknite na valec (priemer) alebo na rovinnú plochu (vzdialenosť)',
  'hint.auto.plane': 'Plocha zachytená — kliknite na druhú plochu pre odmeranie vzdialenosti',
  'hint.auto.unknown': 'Plochu sa nepodarilo rozpoznať — skúste špecializované nástroje merania',
  'hint.auto.nonparallel': 'Plochy nie sú rovnobežné — merané medzi vybranými bodmi',
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
  'set.transparency': 'Priehľadnosť dielov',
  'set.assoc': 'Asociácie súborov',
  'set.assocNote': 'Použijú sa v inštalátore aplikácie pre Windows (Tauri).',
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
