// Builds data/meta.js and data/c1.js..data/c6.js (offline-first from quran-data.js,
// or from /tmp/quran.json / alquran.cloud Uthmani API when --fetch is passed).
// Usage: node scripts/build-data.mjs [--fetch]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const API_URL = 'https://api.alquran.cloud/v1/quran/quran-uthmani';
const TMP_SRC = '/tmp/quran.json';
const QURAN_DATA_PATH = new URL('../quran-data.js', import.meta.url);
const DATA_DIR = new URL('../data/', import.meta.url);
const META_OUT = new URL('../data/meta.js', import.meta.url);
const chunkOutUrl = (c) => new URL(`../data/c${c}.js`, import.meta.url);

// Canonical Arabic surah display names preserving proper hamzas (أ إ آ)
// Note: 82 (الانفطار) and 84 (الانشقاق) use hamzat wasl with no hamza.
const HAMZA_NAMES = {
  3: 'آل عمران',
  6: 'الأنعام',
  7: 'الأعراف',
  8: 'الأنفال',
  14: 'إبراهيم',
  17: 'الإسراء',
  21: 'الأنبياء',
  33: 'الأحزاب',
  34: 'سبأ',
  46: 'الأحقاف',
  76: 'الإنسان',
  78: 'النبأ',
  87: 'الأعلى',
  112: 'الإخلاص',
};

// Balanced chunk mapping across 114 surahs
function getChunkNumber(surahNum) {
  if (surahNum <= 4) return 1;
  if (surahNum <= 11) return 2;
  if (surahNum <= 23) return 3;
  if (surahNum <= 42) return 4;
  if (surahNum <= 72) return 5;
  return 6;
}

// Verified Madinah Hafs 30 Juz boundaries
const JUZ_BOUNDARIES = [
  { j: 1, surah: 1, ayah: 1, label: 'الفاتحة والبقرة' },
  { j: 2, surah: 2, ayah: 142, label: '' },
  { j: 3, surah: 2, ayah: 253, label: '' },
  { j: 4, surah: 3, ayah: 93, label: '' },
  { j: 5, surah: 4, ayah: 24, label: '' },
  { j: 6, surah: 4, ayah: 148, label: '' },
  { j: 7, surah: 5, ayah: 82, label: '' },
  { j: 8, surah: 6, ayah: 111, label: '' },
  { j: 9, surah: 7, ayah: 88, label: '' },
  { j: 10, surah: 8, ayah: 41, label: '' },
  { j: 11, surah: 9, ayah: 93, label: '' },
  { j: 12, surah: 11, ayah: 6, label: '' },
  { j: 13, surah: 12, ayah: 53, label: '' },
  { j: 14, surah: 15, ayah: 1, label: '' },
  { j: 15, surah: 17, ayah: 1, label: '' },
  { j: 16, surah: 18, ayah: 75, label: '' },
  { j: 17, surah: 21, ayah: 1, label: '' },
  { j: 18, surah: 23, ayah: 1, label: '' },
  { j: 19, surah: 25, ayah: 21, label: '' },
  { j: 20, surah: 27, ayah: 56, label: '' },
  { j: 21, surah: 29, ayah: 46, label: '' },
  { j: 22, surah: 33, ayah: 31, label: '' },
  { j: 23, surah: 36, ayah: 28, label: '' },
  { j: 24, surah: 39, ayah: 32, label: '' },
  { j: 25, surah: 41, ayah: 47, label: '' },
  { j: 26, surah: 46, ayah: 1, label: '' },
  { j: 27, surah: 51, ayah: 31, label: '' },
  { j: 28, surah: 58, ayah: 1, label: 'قد سمع' },
  { j: 29, surah: 67, ayah: 1, label: 'تبارك' },
  { j: 30, surah: 78, ayah: 1, label: 'عمّ' },
];

function getSurahStartingJuz(surahNum) {
  let startingJuz = 1;
  for (const b of JUZ_BOUNDARIES) {
    if (b.surah < surahNum || (b.surah === surahNum && b.ayah <= 1)) {
      startingJuz = b.j;
    }
  }
  return startingJuz;
}

// Replace alef waslah (ٱ -> ا) and strip tashkeel/tatweel, preserving أ إ آ
function stripDiacriticsPreserveHamza(s) {
  return s
    .replace(/\u0671/g, 'ا')
    .replace(/\u0640/g, '')
    .replace(/[\u064B-\u0652\u0653\u0654\u0670\u06D6-\u06ED]/g, '')
    .trim();
}

function toSafeJson(obj) {
  return JSON.stringify(obj)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

async function fetchApiJson() {
  console.log('fetching quran-uthmani from API…');
  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`API fetch failed with HTTP ${res.status}`);
  }
  const json = await res.json();
  try {
    mkdirSync('/tmp', { recursive: true });
    writeFileSync(TMP_SRC, JSON.stringify(json), 'utf8');
  } catch {
    // Non-fatal if /tmp cannot be written on this platform
  }
  return json;
}

function loadFromLocalQuranDataJs() {
  if (!existsSync(QURAN_DATA_PATH)) {
    throw new Error('Local quran-data.js not found and --fetch was not specified');
  }
  const code = readFileSync(QURAN_DATA_PATH, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  const arr = sandbox.window.QURAN_DATA;
  if (!Array.isArray(arr) || arr.length !== 114) {
    throw new Error('Expected 114 surahs in quran-data.js');
  }
  return arr;
}

function buildFromApiSurahs(rawSurahs) {
  if (!Array.isArray(rawSurahs) || rawSurahs.length !== 114) {
    throw new Error('Expected 114 surahs in API JSON, got ' + (rawSurahs ? rawSurahs.length : 0));
  }
  const basmala = rawSurahs[0].ayahs[0].text.replace(/^\uFEFF/, '');
  const surahs = rawSurahs.map((s) => {
    const rawName = s.name.replace(/^\s*سُورَةُ\s*/, '').trim();
    const an = stripDiacriticsPreserveHamza(rawName);
    const v = s.ayahs.map((a) => a.text.replace(/^\uFEFF/, ''));
    if (s.number !== 1 && s.number !== 9 && v[0].startsWith(basmala)) {
      v[0] = v[0].slice(basmala.length).replace(/^\s+/, '');
    }
    return {
      n: s.number,
      an,
      count: s.ayahs.length,
      bsl: s.number !== 1 && s.number !== 9,
      c: getChunkNumber(s.number),
      juz: getSurahStartingJuz(s.number),
      v,
    };
  });
  return { basmala, surahs };
}

function buildFromLocalData(localArr) {
  const basmala = localArr[0].v[0].replace(/^\uFEFF/, '');
  const surahs = localArr.map((s) => {
    const v = s.v.map((t) => t.replace(/^\uFEFF/, ''));
    if (s.n !== 1 && s.n !== 9 && v[0].startsWith(basmala)) {
      v[0] = v[0].slice(basmala.length).replace(/^\s+/, '');
    }
    const an = HAMZA_NAMES[s.n] || s.an;
    return {
      n: s.n,
      an,
      count: v.length,
      bsl: s.n !== 1 && s.n !== 9,
      c: getChunkNumber(s.n),
      juz: getSurahStartingJuz(s.n),
      v,
    };
  });
  return { basmala, surahs };
}

const forceFetch = process.argv.includes('--fetch');
let built;
if (forceFetch) {
  const raw = await fetchApiJson();
  built = buildFromApiSurahs(raw.data.surahs);
} else if (existsSync(TMP_SRC)) {
  console.log('reading cached ' + TMP_SRC + '…');
  const raw = JSON.parse(readFileSync(TMP_SRC, 'utf8'));
  built = buildFromApiSurahs(raw.data.surahs);
} else {
  console.log('reading offline source quran-data.js…');
  built = buildFromLocalData(loadFromLocalQuranDataJs());
}

const { basmala, surahs } = built;

// Group verses into 6 balanced chunk objects
const chunks = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };
for (const s of surahs) {
  chunks[s.c][String(s.n)] = s.v;
}

const meta = {
  basmala,
  surahs: surahs.map((s) => ({
    n: s.n,
    an: s.an,
    count: s.count,
    bsl: s.bsl,
    c: s.c,
    juz: s.juz,
  })),
  juz: JUZ_BOUNDARIES.map((b) => ({
    j: b.j,
    surah: b.surah,
    ayah: b.ayah,
    label: b.label,
  })),
};

// Write data/meta.js and data/c1.js .. data/c6.js
mkdirSync(DATA_DIR, { recursive: true });

const metaJs =
  '// auto-generated by scripts/build-data.mjs — do not edit by hand\n' +
  'window.QURAN_META = ' + toSafeJson(meta) + ';\n';
writeFileSync(META_OUT, metaJs, 'utf8');

const chunkSizes = {};
for (let c = 1; c <= 6; c++) {
  const chunkJs =
    '// auto-generated by scripts/build-data.mjs — do not edit by hand\n' +
    'window.__Q_CHUNK(' + c + ', ' + toSafeJson(chunks[c]) + ');\n';
  writeFileSync(chunkOutUrl(c), chunkJs, 'utf8');
  chunkSizes[c] = Buffer.byteLength(chunkJs, 'utf8');
}

// Verify generated output on disk by running in an ES5 VM sandbox
function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

const verifySandbox = {
  window: {
    QURAN_CHUNKS: {},
    __Q_CHUNK(id, obj) {
      this.QURAN_CHUNKS[id] = obj;
    },
  },
};
verifySandbox.window.__Q_CHUNK = verifySandbox.window.__Q_CHUNK.bind(verifySandbox.window);

vm.runInNewContext(readFileSync(META_OUT, 'utf8'), verifySandbox);
for (let c = 1; c <= 6; c++) {
  vm.runInNewContext(readFileSync(chunkOutUrl(c), 'utf8'), verifySandbox);
}

const loadedMeta = verifySandbox.window.QURAN_META;
const loadedChunks = verifySandbox.window.QURAN_CHUNKS;

assert(loadedMeta && Array.isArray(loadedMeta.surahs), 'meta.surahs array present');
assert(loadedMeta.surahs.length === 114, '114 surahs in meta');

let totalAyahs = 0;
const coveredSurahs = new Set();
for (let i = 0; i < loadedMeta.surahs.length; i++) {
  const sm = loadedMeta.surahs[i];
  assert(sm.n === i + 1, `surah index ${i + 1} matches n=${sm.n}`);
  assert(sm.c >= 1 && sm.c <= 6, `surah ${sm.n} chunk ${sm.c} in 1..6`);
  assert(sm.juz >= 1 && sm.juz <= 30, `surah ${sm.n} juz ${sm.juz} in 1..30`);
  const chunk = loadedChunks[sm.c];
  assert(chunk && Array.isArray(chunk[String(sm.n)]), `chunk ${sm.c} contains surah ${sm.n}`);
  const verses = chunk[String(sm.n)];
  assert(verses.length === sm.count, `surah ${sm.n} verse count ${verses.length} === ${sm.count}`);
  coveredSurahs.add(sm.n);
  totalAyahs += sm.count;
}
assert(coveredSurahs.size === 114, 'all 114 surahs covered across chunks');
assert(totalAyahs === 6236, `total ayahs === 6236 (got ${totalAyahs})`);

// Verify canonical hamzas and hamzat wasl names
for (const [nStr, expected] of Object.entries(HAMZA_NAMES)) {
  const sm = loadedMeta.surahs[Number(nStr) - 1];
  assert(sm.an === expected, `surah ${nStr} name "${sm.an}" === "${expected}"`);
}
assert(loadedMeta.surahs[81].an === 'الانفطار', 'surah 82 preserves hamzat wasl الانفطار');
assert(loadedMeta.surahs[83].an === 'الانشقاق', 'surah 84 preserves hamzat wasl الانشقاق');

// Verify Basmala rules
const v1 = loadedChunks[1]['1'];
const v2 = loadedChunks[1]['2'];
const v9 = loadedChunks[2]['9'];
const v27 = loadedChunks[4]['27'];
assert(loadedMeta.surahs[0].bsl === false && v1[0] === loadedMeta.basmala, 'surah 1 keeps basmala as ayah 1');
assert(loadedMeta.surahs[1].bsl === true && v2[0] === 'الٓمٓ', 'surah 2 has bsl=true and starts with الٓمٓ');
assert(loadedMeta.surahs[8].bsl === false && !v9[0].startsWith(loadedMeta.basmala) && v9[0].startsWith('بَرَا'), 'surah 9 has no basmala');
assert(v27[29].includes(loadedMeta.basmala), 'surah 27 ayah 30 keeps internal basmala');

// Verify 30 Juz boundaries
assert(Array.isArray(loadedMeta.juz) && loadedMeta.juz.length === 30, '30 juz boundaries present');
for (let i = 0; i < 30; i++) {
  const jz = loadedMeta.juz[i];
  assert(jz.j === i + 1, `juz[${i}].j === ${i + 1}`);
  const sm = loadedMeta.surahs[jz.surah - 1];
  assert(sm && jz.ayah >= 1 && jz.ayah <= sm.count, `juz ${jz.j} boundary ${jz.surah}:${jz.ayah} valid`);
}

const metaBytes = Buffer.byteLength(metaJs, 'utf8');
console.log(`built ${loadedMeta.surahs.length} surahs, ${totalAyahs} ayahs, 30 juz`);
console.log(`data/meta.js: ${(metaBytes / 1024).toFixed(1)} KB (${metaBytes} B)`);
for (let c = 1; c <= 6; c++) {
  console.log(`data/c${c}.js: ${(chunkSizes[c] / 1024).toFixed(1)} KB (${chunkSizes[c]} B)`);
}
