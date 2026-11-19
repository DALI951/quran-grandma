// Comprehensive verification suite for quran-grandma v2.0.0.
// Usage: npm test  (or node scripts/verify.js)
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { JSDOM, ResourceLoader, VirtualConsole } from "jsdom";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const readBuf = (rel) => readFileSync(path.join(ROOT, rel));

let pass = 0;
let fail = 0;

function ok(cond, name) {
  if (cond) {
    pass++;
    console.log("  ok   " + name);
  } else {
    fail++;
    console.log("  FAIL " + name);
  }
}

function eq(a, b, name) {
  ok(a === b, name + " (" + JSON.stringify(a) + " === " + JSON.stringify(b) + ")");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(pred, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await sleep(10);
  }
  return false;
}

function click(win, el) {
  el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function stripJsComments(src) {
  let out = "";
  let i = 0;
  let state = "code"; // code | single | double | line | block
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (ch === "'") state = "single";
      else if (ch === '"') state = "double";
      out += ch;
      i++;
    } else if (state === "single") {
      out += ch;
      if (ch === "\\" && i + 1 < src.length) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === "'") state = "code";
      i++;
    } else if (state === "double") {
      out += ch;
      if (ch === "\\" && i + 1 < src.length) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') state = "code";
      i++;
    } else if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out += "\n";
      }
      i++;
    } else if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        out += " ";
        i += 2;
        continue;
      }
      if (ch === "\n") out += "\n";
      i++;
    }
  }
  return out;
}

function stripJavaStringsAndComments(src) {
  let out = "";
  let i = 0;
  let state = "code";
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (ch === '"') {
        state = "string";
        i++;
        continue;
      }
      if (ch === "'") {
        state = "char";
        i++;
        continue;
      }
      out += ch;
      i++;
    } else if (state === "string") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') state = "code";
      i++;
    } else if (state === "char") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "'") state = "code";
      i++;
    } else if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out += "\n";
      }
      i++;
    } else if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        i += 2;
        continue;
      }
      i++;
    }
  }
  return out;
}

class LocalResourceLoader extends ResourceLoader {
  constructor(opts = {}) {
    super();
    this.failOnce = opts.failOnce || new Set();
  }
  fetch(urlString) {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (e) {
      const p = Promise.reject(e);
      p.abort = () => {};
      return p;
    }
    if (parsed.origin !== "https://quran.local") {
      const p = Promise.reject(new Error("Blocked external fetch in offline test: " + urlString));
      p.abort = () => {};
      return p;
    }
    let rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    if (!rel) rel = "index.html";
    if (rel.indexOf("..") !== -1 || rel.indexOf("\\") !== -1) {
      const p = Promise.reject(new Error("Path traversal blocked: " + rel));
      p.abort = () => {};
      return p;
    }
    if (this.failOnce.has(rel)) {
      this.failOnce.delete(rel);
      const p = Promise.reject(new Error("Simulated chunk fetch failure: " + rel));
      p.abort = () => {};
      return p;
    }
    const fullPath = path.join(ROOT, rel);
    const promise = new Promise((resolve, reject) => {
      try {
        resolve(readFileSync(fullPath));
      } catch (err) {
        reject(err);
      }
    });
    promise.abort = () => {};
    return promise;
  }
}

async function bootApp(options = {}) {
  const html = read("index.html");
  const jsdomErrors = [];
  const expectedErrorSubstr = options.expectedErrorSubstr || null;

  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (err) => {
    const msg = (err && err.message) ? err.message : String(err);
    const detail = (err && err.detail && err.detail.message) ? err.detail.message : String((err && err.detail) || "");
    if (expectedErrorSubstr && (msg.indexOf(expectedErrorSubstr) !== -1 || detail.indexOf(expectedErrorSubstr) !== -1)) return;
    jsdomErrors.push(msg);
  });

  const scrollCalls = [];
  const bridgeCalls = {
    keepScreenOn: [],
    themeColor: [],
    checkForUpdate: 0,
    openExternalUrl: [],
    exit: 0
  };

  let curScrollY = 0;
  const loader = new LocalResourceLoader({ failOnce: options.failOnce });

  const dom = new JSDOM(html, {
    url: "https://quran.local/index.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    resources: loader,
    virtualConsole,
    beforeParse(win) {
      if (options.seedStorage) {
        for (const [k, v] of Object.entries(options.seedStorage)) {
          win.localStorage.setItem(k, v);
        }
      }
      if (options.onLine === false) {
        Object.defineProperty(win.navigator, "onLine", {
          configurable: true,
          get() { return false; }
        });
      }
      win.scrollTo = (xOrOpts, yVal) => {
        const y = (typeof xOrOpts === "object" && xOrOpts !== null) ? (xOrOpts.top || 0) : (yVal || 0);
        curScrollY = y;
        scrollCalls.push(y);
        if (win.document && win.document.documentElement) {
          win.document.documentElement.scrollTop = y;
        }
      };
      Object.defineProperty(win, "pageYOffset", { configurable: true, get() { return curScrollY; } });
      Object.defineProperty(win, "scrollY", { configurable: true, get() { return curScrollY; } });
      win.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
      win.cancelAnimationFrame = (id) => clearTimeout(id);

      if (options.mockBridge !== false) {
        win.AndroidBridge = {
          setKeepScreenOn(on) { bridgeCalls.keepScreenOn.push(!!on); },
          setThemeColor(hex, lightBar) { bridgeCalls.themeColor.push({ hex, lightBar: !!lightBar }); },
          checkForUpdate() { bridgeCalls.checkForUpdate++; },
          openExternalUrl(url) { bridgeCalls.openExternalUrl.push(url); },
          exit() { bridgeCalls.exit++; }
        };
      }
    }
  });

  const loaded = await waitFor(() => !!dom.window.App, 5000);
  if (!loaded) {
    throw new Error("Timed out waiting for window.App to boot. jsdomErrors: " + JSON.stringify(jsdomErrors));
  }
  // Allow any immediate boot async work (e.g. openView restore chunk load) to settle if needed
  await sleep(30);

  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    App: dom.window.App,
    jsdomErrors,
    scrollCalls,
    bridgeCalls,
    getScrollY: () => curScrollY
  };
}

// ============================================================================
// 1. DATA INTEGRITY (data/meta.js + data/c1.js..data/c6.js)
// ============================================================================
console.log("1. data integrity");

const metaSandbox = { window: {} };
vm.runInNewContext(read("data/meta.js"), metaSandbox);
const meta = metaSandbox.window.QURAN_META;
ok(!!meta && typeof meta === "object", "data/meta.js defines window.QURAN_META");
eq(meta.surahs.length, 114, "meta has 114 surahs");
eq(meta.juz.length, 30, "meta has 30 juz");

const chunks = {};
const chunkSandbox = {
  window: {
    __Q_CHUNK(id, obj) {
      chunks[id] = obj;
    }
  }
};
for (let c = 1; c <= 6; c++) {
  vm.runInNewContext(read("data/c" + c + ".js"), chunkSandbox);
  ok(!!chunks[c] && typeof chunks[c] === "object", "data/c" + c + ".js loads cleanly via __Q_CHUNK");
}

const expectedChunkRanges = {
  1: [1, 4],
  2: [5, 11],
  3: [12, 23],
  4: [24, 42],
  5: [43, 72],
  6: [73, 114]
};

let totalAyahs = 0;
let countsMatch = true;
let chunksMatch = true;
let nonEmptyVerses = true;
const allSurahMap = {};

for (let c = 1; c <= 6; c++) {
  const [from, to] = expectedChunkRanges[c];
  const keys = Object.keys(chunks[c]).map((k) => parseInt(k, 10)).sort((a, b) => a - b);
  const expectedKeys = [];
  for (let n = from; n <= to; n++) expectedKeys.push(n);
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    chunksMatch = false;
  }
  for (const k of keys) {
    allSurahMap[k] = chunks[c][String(k)];
  }
}

for (const sm of meta.surahs) {
  const verses = allSurahMap[sm.n];
  if (!Array.isArray(verses) || verses.length !== sm.count) countsMatch = false;
  if (sm.n < expectedChunkRanges[sm.c][0] || sm.n > expectedChunkRanges[sm.c][1]) chunksMatch = false;
  if (Array.isArray(verses)) {
    totalAyahs += verses.length;
    for (const v of verses) {
      if (typeof v !== "string" || v.trim().length === 0) nonEmptyVerses = false;
    }
  }
}

eq(Object.keys(allSurahMap).length, 114, "chunks c1..c6 cover all 114 surahs");
eq(totalAyahs, 6236, "total ayahs across all chunks equals 6236");
ok(countsMatch, "every surah's metadata count matches its chunk verses array length");
ok(chunksMatch, "chunk ranges match balanced c1..c6 partitions");
ok(nonEmptyVerses, "every verse string is non-empty");

// Proper Arabic hamzas
const expectedHamzaNames = {
  3: "آل عمران",
  6: "الأنعام",
  7: "الأعراف",
  8: "الأنفال",
  14: "إبراهيم",
  17: "الإسراء",
  21: "الأنبياء",
  33: "الأحزاب",
  34: "سبأ",
  46: "الأحقاف",
  76: "الإنسان",
  78: "النبأ",
  87: "الأعلى",
  112: "الإخلاص",
  82: "الانفطار",
  84: "الانشقاق"
};
let hamzasOk = true;
for (const [nStr, expectedName] of Object.entries(expectedHamzaNames)) {
  const sm = meta.surahs[parseInt(nStr, 10) - 1];
  if (!sm || sm.an !== expectedName) {
    hamzasOk = false;
    console.log("    mismatch surah " + nStr + ": got " + (sm && sm.an) + " expected " + expectedName);
  }
}
ok(hamzasOk, "proper Arabic hamzas (and hamzat wasl on 82/84) preserved in surah names");

// Basmala rules
const sm1 = meta.surahs[0];
const sm2 = meta.surahs[1];
const sm9 = meta.surahs[8];
const sm27 = meta.surahs[26];
eq(sm1.bsl, false, "surah 1 has bsl:false");
ok(allSurahMap[1][0].startsWith("بِسْمِ"), "surah 1 ayah 1 is the basmala");
eq(sm2.bsl, true, "surah 2 has bsl:true");
eq(allSurahMap[2][0], "الٓمٓ", "surah 2 ayah 1 is 'الٓمٓ'");
eq(sm9.bsl, false, "surah 9 has bsl:false");
ok(allSurahMap[9][0].startsWith("بَرَا"), "surah 9 ayah 1 starts with 'بَرَا' (no basmala)");
eq(sm27.bsl, true, "surah 27 has bsl:true");
ok(allSurahMap[27][29].includes("بِسْمِ"), "surah 27 keeps internal basmala in ayah 30");
let otherBslOk = true;
for (const sm of meta.surahs) {
  if (sm.n !== 1 && sm.n !== 9 && sm.bsl !== true) otherBslOk = false;
}
ok(otherBslOk, "all surahs other than 1 and 9 have bsl:true");

// Juz boundaries
let juzValid = true;
let prevSurah = 0;
let prevAyah = 0;
for (let idx = 0; idx < meta.juz.length; idx++) {
  const jz = meta.juz[idx];
  const sm = meta.surahs[jz.surah - 1];
  if (jz.j !== idx + 1 || !sm || jz.ayah < 1 || jz.ayah > sm.count) {
    juzValid = false;
  }
  if (jz.surah < prevSurah || (jz.surah === prevSurah && jz.ayah <= prevAyah)) {
    juzValid = false;
  }
  prevSurah = jz.surah;
  prevAyah = jz.ayah;
}
ok(juzValid, "all 30 Juz boundaries valid, in range, and strictly ordered");
eq(meta.juz[1].surah + ":" + meta.juz[1].ayah, "2:142", "Juz 2 starts at 2:142");
eq(meta.juz[29].surah + ":" + meta.juz[29].ayah, "78:1", "Juz 30 starts at 78:1");

let surahJuzOk = true;
for (const sm of meta.surahs) {
  if (typeof sm.juz !== "number" || sm.juz < 1 || sm.juz > 30) surahJuzOk = false;
}
ok(surahJuzOk, "every surah metadata includes valid starting juz (1..30)");

// ============================================================================
// 2. SCROLL & TAP-ONLY UI, FAVORITES, TABS, SURAH RANGES, JUZ
// ============================================================================
console.log("2. scroll & tap-only UI / tabs / shortcuts / juz");

const env = await bootApp();
const { window: win, document: doc, App, jsdomErrors, scrollCalls, bridgeCalls } = env;

eq(doc.querySelectorAll("input, textarea, [contenteditable]").length, 0, "ZERO <input>/editable elements in UI (no keyboard)");
eq(doc.getElementById("home").hidden, false, "Home visible on initial launch");
eq(doc.getElementById("reader").hidden, true, "Reader hidden on initial launch");
eq(bridgeCalls.keepScreenOn[0], false, "keepScreenOn disabled on Home launch");

// All 3 tabs
eq(doc.querySelectorAll("#tabBar .tabBtn").length, 3, "3 tabs in tab bar");
eq(doc.getElementById("panel-favs").hidden, false, "Favorites tab active by default");
eq(doc.getElementById("panel-surahs").hidden, true, "Surahs tab hidden by default");
eq(doc.getElementById("panel-juz").hidden, true, "Juz tab hidden by default");

click(win, doc.getElementById("tabBtn-surahs"));
eq(doc.getElementById("panel-surahs").hidden, false, "clicking Surahs tab shows Surahs panel");
eq(doc.getElementById("panel-favs").hidden, true, "Favorites panel hides when Surahs active");
eq(doc.getElementById("tabBtn-surahs").getAttribute("aria-selected"), "true", "Surahs tab aria-selected=true");

click(win, doc.getElementById("tabBtn-juz"));
eq(doc.getElementById("panel-juz").hidden, false, "clicking Juz tab shows Juz panel");
eq(doc.getElementById("panel-surahs").hidden, true, "Surahs panel hides when Juz active");

click(win, doc.getElementById("tabBtn-favs"));
eq(doc.getElementById("panel-favs").hidden, false, "switching back to Favorites tab works");

// Favorites defaults + Ayat al-Kursi
const defaultCards = Array.from(doc.querySelectorAll("#defaultFavsGrid .favCard"));
const defaultNums = defaultCards.map((el) => parseInt(el.getAttribute("data-surah"), 10));
eq(JSON.stringify(defaultNums), JSON.stringify([1, 36, 55, 56, 67, 18]), "Favorites tab shows 6 default surahs (1,36,55,56,67,18)");

const kursiBtn = doc.querySelector('#specialShortcuts [data-surah="2"][data-ayah="255"]');
ok(!!kursiBtn && kursiBtn.textContent.indexOf("آية الكرسي") !== -1, "Ayat al-Kursi shortcut present in Favorites tab");

scrollCalls.length = 0;
click(win, kursiBtn);
const baqarahLoaded = await waitFor(() => doc.querySelectorAll("#surahBody .verse").length > 0);
ok(baqarahLoaded, "clicking Ayat al-Kursi loads chunk c1 dynamically and opens reader");
eq(doc.getElementById("reader").hidden, false, "reader visible after clicking Ayat al-Kursi");
eq(doc.getElementById("readerTitle").textContent, "البقرة", "reader title is البقرة");
const kursiVerse = doc.querySelector('#surahBody .verse[data-ayah="255"]');
ok(!!kursiVerse, "reader opened directly on the page containing Ayah 255");
ok(kursiVerse && kursiVerse.classList.contains("cur"), "Ayah 255 is highlighted (.cur)");
ok(scrollCalls.length > 0, "opening Ayat al-Kursi invokes scrollTo");

// Return to Home for Surahs & Juz tests
eq(App.back(), true, "App.back() exits reader to Home");
eq(doc.getElementById("home").hidden, false, "Home visible again after App.back()");

// Surahs tab: 114 surahs + range jump pills
click(win, doc.getElementById("tabBtn-surahs"));
eq(doc.querySelectorAll("#surahList .srow").length, 114, "Surahs tab renders all 114 surah rows");
const pills = Array.from(doc.querySelectorAll("#rangePills .rangePill"));
eq(pills.length, 4, "Surahs tab renders 4 range jump pills");
eq(pills.map((p) => p.getAttribute("data-from")).join(","), "1,31,61,91", "range jump pills cover 1, 31, 61, 91");

// Mock boundingClientRect on surahRow-91 to verify range pill scroll
const row91 = doc.getElementById("surahRow-91");
row91.getBoundingClientRect = () => ({ top: 2400, bottom: 2480, left: 0, right: 360 });
scrollCalls.length = 0;
click(win, pills[3]);
ok(doc.querySelector('#rangePills .rangePill[data-from="91"]').classList.contains("is-active"), "clicking range pill 91-114 activates it");
ok(scrollCalls.some((y) => y > 2000), "clicking range pill 91-114 scrolls to surah 91");

// Juz tab: 30 Juz + Juz 30 & Juz 2 navigation
click(win, doc.getElementById("tabBtn-juz"));
eq(doc.querySelectorAll("#juzList .juzCard").length, 30, "Juz tab renders all 30 Juz cards");

const juz30Btn = doc.querySelector('#juzList .juzCard[data-surah="78"][data-ayah="1"]');
ok(!!juz30Btn && juz30Btn.textContent.indexOf("عمّ") !== -1, "Juz 30 card points to 78:1 with label 'عمّ'");
click(win, juz30Btn);
ok(await waitFor(() => doc.querySelectorAll("#surahBody .verse").length > 0 && doc.getElementById("readerTitle").textContent === "النبأ"),
  "clicking Juz 30 opens Surah 78 (النبأ) via chunk c6");
ok(!!doc.querySelector('#surahBody .verse[data-ayah="1"].cur'), "Juz 30 highlights Surah 78 Ayah 1");

App.back();
click(win, doc.getElementById("tabBtn-juz"));
const juz2Btn = doc.querySelector('#juzList .juzCard[data-surah="2"][data-ayah="142"]');
ok(!!juz2Btn, "Juz 2 card points to 2:142");
click(win, juz2Btn);
ok(await waitFor(() => !!doc.querySelector('#surahBody .verse[data-ayah="142"]')),
  "clicking Juz 2 opens Surah 2 directly on the page containing Ayah 142");
ok(!!doc.querySelector('#surahBody .verse[data-ayah="142"].cur'), "Juz 2 highlights Ayah 142");

// ============================================================================
// 3. STARRING / UNSTARRING & NEVER TRAPPED ON EMPTY SCREEN
// ============================================================================
console.log("3. starring / unstarring safety");

App.back();
// Reset state clean for star tests
App.setState({ favs: [], last: { surah: 0, ayah: 0 }, positions: {} });
App.openSurah(36, false);
ok(await waitFor(() => doc.getElementById("readerTitle").textContent === "يس" && doc.querySelectorAll("#surahBody .verse").length > 0),
  "opened Surah 36 (يس) via chunk c4");

const favBtn = doc.getElementById("favBtn");
eq(favBtn.getAttribute("aria-pressed"), "false", "Surah 36 starts unstarred");
click(win, favBtn);
eq(favBtn.getAttribute("aria-pressed"), "true", "tapping star sets aria-pressed=true");
eq(doc.getElementById("favBtnLabel").textContent, "محفوظة", "star label reads 'محفوظة'");
ok(App.getState().favs.indexOf(36) !== -1, "Surah 36 saved in state.favs");

App.back();
click(win, doc.getElementById("tabBtn-favs"));
const savedOpen36 = doc.querySelector('#savedFavsList .savedOpenBtn[data-surah="36"]');
const askUnstar36 = doc.querySelector('#savedFavsList .savedRemoveBtn[data-ask-unstar="36"]');
ok(!!savedOpen36 && !!askUnstar36, "Surah 36 appears in saved list with separate unstar sibling button");
ok(!savedOpen36.contains(askUnstar36), "remove button is NOT nested inside the surah open button");

// Clicking ask-unstar opens inline confirmation without deleting immediately
click(win, askUnstar36);
const confirmYes36 = doc.querySelector('#savedFavsList [data-confirm-unstar="36"]');
const confirmNo36 = doc.querySelector('#savedFavsList [data-cancel-unstar="36"]');
ok(!!confirmYes36 && !!confirmNo36, "tapping remove shows safe inline confirmation");
eq(App.getState().favs.length, 1, "fav not removed before confirmation");

// Cancel keeps it
click(win, confirmNo36);
eq(App.getState().favs.length, 1, "cancelling unstar keeps surah 36");

// Confirm removes it cleanly without trapping Grandma
click(win, doc.querySelector('#savedFavsList [data-ask-unstar="36"]'));
click(win, doc.querySelector('#savedFavsList [data-confirm-unstar="36"]'));
eq(App.getState().favs.length, 0, "confirming unstar removes custom saved surah");
ok(!!doc.querySelector("#savedFavsList .hintCard"), "friendly hint card shown when custom saved list is empty");
eq(doc.getElementById("tabBar").hidden, false, "tab bar stays visible after removing all custom saved surahs");
eq(doc.querySelectorAll("#defaultFavsGrid .favCard").length, 6, "6 default favorites remain accessible (never trapped on empty screen)");
ok(!!doc.querySelector('#specialShortcuts [data-surah="2"]'), "Ayat al-Kursi shortcut remains accessible");

// ============================================================================
// 4. READER, PAGINATION, PER-SURAH PROGRESS & RESUME FIXES
// ============================================================================
console.log("4. reader, pagination, per-surah memory & resume fixes");

// Open Surah 2 normally (browse)
App.openSurah(2, false);
ok(await waitFor(() => doc.getElementById("readerTitle").textContent === "البقرة" && doc.querySelectorAll("#surahBody .verse").length > 0),
  "Surah 2 loaded");

const firstPageVerses = doc.querySelectorAll("#surahBody .verse");
ok(firstPageVerses.length > 0 && firstPageVerses.length <= 18,
  "Surah 2 is paginated (page 1 renders " + firstPageVerses.length + " ayahs, NOT 286 at once)");
eq(doc.querySelectorAll("#surahBody .bsml").length, 1, "Surah 2 page 1 shows Basmala");
ok(doc.querySelector("#surahBody .pageInfoPill").textContent.indexOf("صفحة ١ من") !== -1, "page header pill shows 'صفحة ١ من ...'");

// Next / Prev page buttons
const nextPageBtn = doc.querySelector("#surahBody .nextPage");
ok(!!nextPageBtn, "Next page button rendered on page 1");
click(win, nextPageBtn);
const page2FirstAyah = parseInt(doc.querySelector("#surahBody .verse").getAttribute("data-ayah"), 10);
ok(page2FirstAyah === firstPageVerses.length + 1, "Next page starts right after page 1's last ayah (" + page2FirstAyah + ")");
eq(doc.querySelectorAll("#surahBody .bsml").length, 0, "page 2 does not repeat Basmala");
const prevPageBtn = doc.querySelector("#surahBody .prevPage");
ok(!!prevPageBtn, "Previous page button rendered on page 2");
click(win, prevPageBtn);
eq(parseInt(doc.querySelector("#surahBody .verse").getAttribute("data-ayah"), 10), 1, "Previous page returns to Ayah 1");

// Jump to last page -> shows Next Surah, Prev Surah, Return to List
const baqarahPages = App.paginateSurah(chunks[1]["2"]);
ok(baqarahPages.length >= 16, "Surah 2 splits into " + baqarahPages.length + " comfortable pages");
App.openPage(baqarahPages.length - 1);
ok(!!doc.querySelector("#surahBody .navEnd .nextS[data-surah='3']"), "last page shows Next Surah (آل عمران)");
ok(!!doc.querySelector("#surahBody .navEnd .prevS[data-surah='1']"), "last page shows Prev Surah (الفاتحة)");
ok(!!doc.querySelector("#surahBody .navEnd .toList"), "last page shows Return to List button");

// Tapping an ayah saves bookmark & per-surah memory
App.openSurah(2, { ayah: 150, mode: "jump" });
await waitFor(() => !!doc.querySelector('#surahBody .verse[data-ayah="150"]'));
click(win, doc.querySelector('#surahBody .verse[data-ayah="150"]'));
eq(App.getState().positions["2"], 150, "tapping ayah 150 in Surah 2 saves positions['2'] = 150");
eq(App.getState().last.surah, 2, "state.last.surah = 2");
eq(App.getState().last.ayah, 150, "state.last.ayah = 150");
ok(!doc.getElementById("toast").hidden && doc.getElementById("toast").textContent.indexOf("١٥٠") !== -1,
  "tapping ayah shows bookmark toast");

// Open Surah 18 and tap ayah 10 -> does NOT erase Surah 2's saved ayah!
App.openSurah(18, false);
ok(await waitFor(() => doc.getElementById("readerTitle").textContent === "الكهف" && doc.querySelectorAll("#surahBody .verse").length > 0),
  "opened Surah 18 via chunk c3");
click(win, doc.querySelector('#surahBody .verse[data-ayah="10"]'));
eq(App.getState().positions["18"], 10, "Surah 18 saves positions['18'] = 10");
eq(App.getState().positions["2"], 150, "opening & reading Surah 18 does NOT erase Surah 2's saved ayah (150)");

// Return to Home, verify progress badge & resume Surah 2 from list WITHOUT overwriting saved ayah
App.back();
click(win, doc.getElementById("tabBtn-surahs"));
const baqarahRow = doc.querySelector("#surahRow-2 .srow");
ok(baqarahRow.textContent.indexOf("١٥٠") !== -1, "Surah 2 row displays saved progress badge '١٥٠'");

// Mock sticky header height & verse offsetTop so we verify exact scroll offset math
Object.defineProperty(doc.getElementById("readerTop"), "offsetHeight", {
  configurable: true,
  get() { return 72; }
});

click(win, baqarahRow);
ok(await waitFor(() => doc.getElementById("readerTitle").textContent === "البقرة" && doc.querySelectorAll("#surahBody .verse").length > 0),
  "opened Surah 2 from list");
await sleep(110); // Wait past settleTimer (80ms) to confirm it NEVER overwrites saved progress!

eq(App.getState().positions["2"], 150, "opening Surah 2 from list does NOT overwrite saved ayah 150 to 1 or 286");
const jb = doc.getElementById("jumpBanner");
ok(!jb.hidden && jb.textContent.indexOf("١٥٠") !== -1, "jump banner shown pointing to saved ayah 150");
const jumpGoBtn = doc.getElementById("jumpGo");
ok(!!jumpGoBtn && jumpGoBtn.textContent === "اذهبي إليها", "jump banner has 'اذهبي إليها' button");

// Even exiting back to Home without clicking anything preserves positions["2"] = 150
App.back();
eq(App.getState().positions["2"], 150, "exiting Surah 2 without interacting preserves saved ayah 150");

// Re-open Surah 2 from list and click "اذهبي إليها"
App.openSurah(2, false);
await waitFor(() => !doc.getElementById("jumpBanner").hidden);
// Hook offsetTop on all .verse elements monotonically once page renders after jump
const origProtoDesc = Object.getOwnPropertyDescriptor(win.HTMLElement.prototype, "offsetTop");
Object.defineProperty(win.HTMLElement.prototype, "offsetTop", {
  configurable: true,
  get() {
    if (this.getAttribute && this.getAttribute("data-ayah")) {
      const a = parseInt(this.getAttribute("data-ayah"), 10) || 1;
      return 500 + (a - 150) * 60;
    }
    return 120;
  }
});
scrollCalls.length = 0;
click(win, doc.getElementById("jumpGo"));
await sleep(100);
const jumpedVerse150 = doc.querySelector('#surahBody .verse[data-ayah="150"]');
ok(!!jumpedVerse150 && jumpedVerse150.classList.contains("cur"),
  "clicking 'اذهبي إليها' navigates to the page containing Ayah 150 and highlights it");
ok(doc.getElementById("jumpBanner").hidden, "jump banner hides after jumping");
// 500 - (72 + 16) = 412
ok(scrollCalls.some((y) => y === 412), "scrollTo offsets by sticky header height + 16px (500 - 88 = 412)");
if (origProtoDesc) Object.defineProperty(win.HTMLElement.prototype, "offsetTop", origProtoDesc);
else delete win.HTMLElement.prototype.offsetTop;

// Also test tapping an ayah near bottom of viewport and leaving via Back without scrolling:
// must NOT overwrite the tapped ayah with currentAyahIndex()!
win.scrollTo(0, 0);
await sleep(20);
click(win, doc.querySelector('#surahBody .verse[data-ayah="150"]'));
eq(App.getState().last.ayah, 150, "explicit tap sets last.ayah = 150");
App.back();
eq(App.getState().positions["2"], 150, "leaving via Back after tapping ayah 150 preserves 150 (not overwritten by scroll index)");

// Hero Continue Card test (already back on Home from test above)
ok(!doc.getElementById("heroWrap").hidden, "Hero Continue Card visible on Home when last.surah is set");
ok(doc.getElementById("continueText").textContent.indexOf("البقرة") !== -1 &&
   doc.getElementById("continueText").textContent.indexOf("١٥٠") !== -1,
  "Hero Continue Card displays Surah البقرة and Ayah ١٥٠");
click(win, doc.getElementById("continueBtn"));
await waitFor(() => !!doc.querySelector('#surahBody .verse[data-ayah="150"]'));
ok(!!doc.querySelector('#surahBody .verse[data-ayah="150"].cur'), "tapping Hero Continue Card resumes directly at Surah 2 Ayah 150");

// Test debounced manual scroll progress saving (>250ms after programmatic scroll, commits after ~550ms)
const origScrollProto = Object.getOwnPropertyDescriptor(win.HTMLElement.prototype, "offsetTop");
Object.defineProperty(win.HTMLElement.prototype, "offsetTop", {
  configurable: true,
  get() {
    if (this.getAttribute && this.getAttribute("data-ayah")) {
      const a = parseInt(this.getAttribute("data-ayah"), 10) || 1;
      return 100 + (a - 143) * 120;
    }
    return 100;
  }
});
App.openPage(App.paginateSurah(chunks[1]["2"]).findIndex((p) => 150 >= p.start + 1 && 150 <= p.end + 1));
const beforeScrollPos = App.getState().positions["2"];
await sleep(360);
win.scrollTo(0, 700);
win.dispatchEvent(new win.Event("scroll"));
eq(App.getState().positions["2"], beforeScrollPos, "scroll save is debounced (not committed synchronously)");
await sleep(600);
ok(App.getState().positions["2"] > beforeScrollPos, "manual scroll saves visible ayah after 550ms debounce (" + beforeScrollPos + " -> " + App.getState().positions["2"] + ")");
if (origScrollProto) Object.defineProperty(win.HTMLElement.prototype, "offsetTop", origScrollProto);
else delete win.HTMLElement.prototype.offsetTop;

// Sajdah indicator (Surah 32 Ayah 15 and Surah 96 Ayah 19)
App.openSurah(32, { ayah: 15, mode: "jump" });
ok(await waitFor(() => !!doc.querySelector('#surahBody .verse[data-ayah="15"]')),
  "opened Surah 32 (السجدة) via chunk c4");
const sajdah32 = doc.querySelector('#surahBody .verse[data-ayah="15"] .sajdahBadge');
ok(!!sajdah32 && sajdah32.textContent.indexOf("سجدة تلاوة") !== -1, "Sajdah indicator renders on Surah 32 Ayah 15");

App.openSurah(96, { ayah: 19, mode: "jump" });
ok(await waitFor(() => !!doc.querySelector('#surahBody .verse[data-ayah="19"]')),
  "opened Surah 96 (العلق) via chunk c6");
const sajdah96 = doc.querySelector('#surahBody .verse[data-ayah="19"] .sajdahBadge');
ok(!!sajdah96 && sajdah96.textContent.indexOf("سجدة تلاوة") !== -1, "Sajdah indicator renders on Surah 96 Ayah 19");

// ============================================================================
// 5. CONTROLS, THEMES, ACCESSIBILITY, ARABIC & BACK CONTRACT
// ============================================================================
console.log("5. controls, themes, numerals, reading mode, back & update checker");

const readerEl = doc.getElementById("reader");
eq(readerEl.classList.contains("fs-2"), true, "default font size class is .fs-2");
click(win, doc.getElementById("fsUp"));
eq(readerEl.classList.contains("fs-3"), true, "أ+ increments to .fs-3");
click(win, doc.getElementById("fsDown"));
click(win, doc.getElementById("fsDown"));
click(win, doc.getElementById("fsDown"));
eq(readerEl.classList.contains("fs-0"), true, "أ− reaches .fs-0");
eq(doc.getElementById("fsDown").disabled, true, "أ− disables at minimum size 0");
eq(App.getState().size, 0, "state.size is 0");

// Verify size = 0 persists across a fresh reload!
const persistedV2 = win.localStorage.getItem("quran-grandma:v2");
const reloadEnv = await bootApp({ seedStorage: { "quran-grandma:v2": persistedV2 } });
eq(reloadEnv.App.getState().size, 0, "size = 0 persists across reload (NOT reset to 2)");
eq(reloadEnv.document.getElementById("reader").classList.contains("fs-0"), true, "reloaded reader preserves .fs-0 class");
eq(reloadEnv.document.getElementById("reader").hidden, false, "openView restores Reader screen on reload");
eq(reloadEnv.App.getState().openView.surah, 96, "openView restores Surah 96 on reload");
eq(reloadEnv.bridgeCalls.keepScreenOn[0], true, "restored Reader enables FLAG_KEEP_SCREEN_ON");
eq(reloadEnv.jsdomErrors.length, 0, "zero jsdomErrors on reload boot");

// Theme cycling: Cream -> Night -> Contrast -> Cream
eq(doc.documentElement.getAttribute("data-theme"), "cream", "initial theme is cream");
click(win, doc.getElementById("themeCycleBtn"));
eq(doc.documentElement.getAttribute("data-theme"), "night", "1st theme cycle -> night");
eq(doc.getElementById("themeCycleLabel").textContent, "ليلي", "theme label -> ليلي");
click(win, doc.getElementById("themeCycleBtn"));
eq(doc.documentElement.getAttribute("data-theme"), "contrast", "2nd theme cycle -> contrast");
eq(doc.getElementById("themeCycleLabel").textContent, "واضح", "theme label -> واضح");
click(win, doc.getElementById("themeCycleBtn"));
eq(doc.documentElement.getAttribute("data-theme"), "cream", "3rd theme cycle -> cream");
ok(bridgeCalls.themeColor.some((t) => t.hex === "#121815" && t.lightBar === false) &&
   bridgeCalls.themeColor.some((t) => t.hex === "#000000" && t.lightBar === false),
  "AndroidBridge.setThemeColor called for night & contrast themes");

// Reading mode toggle: Flowing vs Verse-by-Verse
ok(doc.querySelector("#surahBody .quran").classList.contains("mode-flowing"), "default reading mode is flowing");
click(win, doc.getElementById("readerSettingsBtn"));
eq(doc.getElementById("settingsModal").hidden, false, "Settings modal opens");
click(win, doc.querySelector('#readingModeChoices [data-mode="verse"]'));
ok(doc.querySelector("#surahBody .quran").classList.contains("mode-verse"), "switches to verse-by-verse mode (.mode-verse)");
click(win, doc.querySelector('#readingModeChoices [data-mode="flowing"]'));
ok(doc.querySelector("#surahBody .quran").classList.contains("mode-flowing"), "switches back to flowing mode (.mode-flowing)");

// Numerals toggle: ١٢٣ vs 123
ok(doc.querySelector("#surahBody .verse .enum").textContent.indexOf("١") !== -1, "default numerals use Arabic-Indic digits (١)");
click(win, doc.querySelector('#numeralsChoices [data-numerals="western"]'));
ok(doc.querySelector("#surahBody .verse .enum").textContent.indexOf("1") !== -1, "western numerals switch verse marker to (1)");
click(win, doc.querySelector('#numeralsChoices [data-numerals="arabic"]'));
ok(doc.querySelector("#surahBody .verse .enum").textContent.indexOf("١") !== -1, "switches back to Arabic-Indic numerals");

// Update checker in Settings
click(win, doc.getElementById("checkUpdateBtn"));
eq(bridgeCalls.checkForUpdate, 1, "checkUpdateBtn calls AndroidBridge.checkForUpdate()");

win.__onUpdateResult(JSON.stringify({
  ok: true,
  tag_name: "v2.1.0",
  apk_url: "https://github.com/DALI951/quran-grandma/releases/download/v2.1.0/quran-grandma-v2.1.0.apk"
}));
eq(doc.getElementById("updateStatus").hidden, false, "update status revealed");
ok(doc.getElementById("updateMsg").textContent.indexOf("2.1.0") !== -1, "renders available update version 2.1.0");
eq(doc.getElementById("downloadUpdateBtn").hidden, false, "download button shown when update is newer");
click(win, doc.getElementById("downloadUpdateBtn"));
eq(bridgeCalls.openExternalUrl[0], "https://github.com/DALI951/quran-grandma/releases/download/v2.1.0/quran-grandma-v2.1.0.apk",
  "clicking download invokes AndroidBridge.openExternalUrl");

// XSS safety in update checker
win.__onUpdateResult({ ok: true, tag_name: "v9.9.9<script>window.__xss=1</script>" });
eq(win.__xss, undefined, "__onUpdateResult safely escapes/uses textContent (no XSS)");
eq(doc.getElementById("updateMsg").querySelectorAll("script").length, 0, "no script element injected in updateMsg");

// Same version & offline message
win.__onUpdateResult({ ok: true, tag_name: "v2.0.0" });
ok(doc.getElementById("updateMsg").textContent.indexOf("أنتِ على أحدث نسخة") !== -1, "same version shows up-to-date message");
eq(doc.getElementById("downloadUpdateBtn").hidden, true, "download button hidden when up-to-date");

win.__onUpdateResult({ ok: false, reason: "offline" });
ok(doc.getElementById("updateMsg").textContent.indexOf("اتصالاً بالإنترنت") !== -1, "offline result shows offline message");
eq(doc.getElementById("downloadUpdateBtn").hidden, true, "download button hidden when offline");

// Back button contract (Settings modal -> Reader -> non-favs Tab -> favs Home returns strict false)
eq(App.back(), true, "App.back() #1 closes Settings modal and returns true");
eq(doc.getElementById("settingsModal").hidden, true, "Settings modal is closed");
eq(App.back(), true, "App.back() #2 exits Reader to Home and returns true");
eq(doc.getElementById("reader").hidden, true, "Reader is hidden");
eq(doc.getElementById("home").hidden, false, "Home is visible");
eq(bridgeCalls.keepScreenOn[bridgeCalls.keepScreenOn.length - 1], false, "leaving Reader clears keepScreenOn");

App.openTab("juz");
eq(App.back(), true, "App.back() #3 on non-favs tab switches to favs and returns true");
eq(App.getState().tab, "favs", "tab switched back to favs");
eq(App.back(), false, "App.back() #4 on Home favs tab with no modal returns strict boolean false");

// ============================================================================
// 6. V1 -> V2 MIGRATION & CHUNK RETRY RECOVERY
// ============================================================================
console.log("6. v1 -> v2 migration & chunk error retry");

const migEnv = await bootApp({
  seedStorage: {
    "quran-grandma:v1": JSON.stringify({ surah: 36, ayah: 40, size: 0, favs: [18, 55] })
  }
});
const migState = migEnv.App.getState();
eq(migState.last.surah, 36, "v1 migration preserves last.surah (36)");
eq(migState.last.ayah, 40, "v1 migration preserves last.ayah (40)");
eq(migState.positions["36"], 40, "v1 migration populates positions['36'] = 40");
eq(migState.size, 0, "v1 migration preserves size = 0");
eq(JSON.stringify(migState.favs), JSON.stringify([18, 55]), "v1 migration preserves favs [18, 55]");
ok(!!migEnv.window.localStorage.getItem("quran-grandma:v2"), "migration writes quran-grandma:v2");
eq(migEnv.jsdomErrors.length, 0, "zero jsdomErrors during v1 -> v2 migration");

// Chunk failure + retry test
const retryEnv = await bootApp({
  failOnce: new Set(["data/c4.js"]),
  expectedErrorSubstr: "Simulated chunk fetch failure"
});
retryEnv.App.openSurah(36, false);
ok(await waitFor(() => !retryEnv.document.getElementById("readerStatus").hidden && !!retryEnv.document.getElementById("retryChunkBtn")),
  "chunk load error shows friendly retry button");
click(retryEnv.window, retryEnv.document.getElementById("retryChunkBtn"));
ok(await waitFor(() => retryEnv.document.getElementById("readerStatus").hidden && retryEnv.document.querySelectorAll("#surahBody .verse").length > 0),
  "clicking retry loads chunk c4 cleanly on second attempt");
eq(retryEnv.jsdomErrors.length, 0, "no unexpected jsdomErrors during chunk retry");

// Non-bridge offline checkUpdate test
const offlineEnv = await bootApp({ mockBridge: false, onLine: false });
click(offlineEnv.window, offlineEnv.document.getElementById("homeSettingsBtn"));
click(offlineEnv.window, offlineEnv.document.getElementById("checkUpdateBtn"));
ok(offlineEnv.document.getElementById("updateMsg").textContent.indexOf("اتصالاً بالإنترنت") !== -1,
  "browser offline fallback checkUpdate shows offline message without network calls");
eq(offlineEnv.jsdomErrors.length, 0, "zero jsdomErrors on offline fallback checkUpdate");

// ============================================================================
// 7. ARABIC CONSISTENCY & ZERO RAW UI EMOJIS
// ============================================================================
console.log("7. Arabic tone & zero raw UI emojis");

const indexHtml = read("index.html");
const appConfigJs = read("app-config.js");
const appJs = read("app.js");
const stylesCss = read("styles.css");

const RAW_EMOJIS = ["🔎", "📖", "🔖", "☰", "⭐"];
let emojisClean = true;
for (const em of RAW_EMOJIS) {
  for (const [fname, content] of [["index.html", indexHtml], ["app-config.js", appConfigJs], ["app.js", appJs], ["styles.css", stylesCss]]) {
    if (content.indexOf(em) !== -1) {
      emojisClean = false;
      console.log("    found raw emoji " + em + " in " + fname);
    }
  }
}
ok(emojisClean, "zero raw UI emojis (🔎, 📖, 🔖, ☰, ⭐) in UI HTML/CSS/JS");

const BAD_ARABIC = ["افتح ", "اضغط ", "حلّها", "اذهب ", "توقف هنا"];
let arabicClean = true;
for (const bad of BAD_ARABIC) {
  for (const [fname, content] of [["index.html", indexHtml], ["app-config.js", appConfigJs], ["app.js", appJs]]) {
    if (content.indexOf(bad) !== -1) {
      arabicClean = false;
      console.log("    found inconsistent Arabic '" + bad + "' in " + fname);
    }
  }
}
ok(arabicClean, "consistent feminine Arabic across UI (no افتح / اضغط / حلّها)");

// ============================================================================
// 8. OLD-ANDROID WEBVIEW COMPAT GUARD (ES5 & CSS FALLBACKS)
// ============================================================================
console.log("8. old-Android WebView compatibility guard");

const jsFilesToCheck = [
  ["app-config.js", appConfigJs],
  ["app.js", appJs],
  ["data/meta.js", read("data/meta.js")]
];
for (let c = 1; c <= 6; c++) {
  jsFilesToCheck.push(["data/c" + c + ".js", read("data/c" + c + ".js")]);
}

// Extract any inline <script> blocks in index.html
const scriptTagRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let scriptMatch;
let inlineIdx = 0;
while ((scriptMatch = scriptTagRe.exec(indexHtml)) !== null) {
  inlineIdx++;
  jsFilesToCheck.push(["index.html<inline#" + inlineIdx + ">", scriptMatch[1]]);
}

const ES5_FORBIDDEN = [
  ["const ", "const is ES6"],
  ["let ", "let is ES6"],
  ["=>", "arrow functions are ES6"],
  ["`", "template literals are ES6"],
  [".includes(", "String/Array.includes needs modern Chromium"],
  [".startsWith(", "String.startsWith needs Chromium 41+"],
  ["closest(", "Element.closest needs Chromium 41+"],
  ["Array.from", "Array.from needs Chromium 45+"],
  ["Object.assign", "Object.assign needs Chromium 45+"],
  ["fetch(", "fetch() needs Chromium 42+"]
];

let vmSyntaxOk = true;
for (const [fname, content] of jsFilesToCheck) {
  try {
    new vm.Script(content, { filename: fname });
  } catch (e) {
    vmSyntaxOk = false;
    console.log("    syntax error in " + fname + ": " + e.message);
  }
}
ok(vmSyntaxOk, "all JS files & inline scripts parse cleanly in vm.Script");

const appCompatTargets = jsFilesToCheck.filter(([n]) => !n.startsWith("data/"));
for (const [tok, why] of ES5_FORBIDDEN) {
  let clean = true;
  for (const [fname, content] of appCompatTargets) {
    const stripped = stripJsComments(content);
    if (stripped.indexOf(tok) !== -1) {
      clean = false;
      console.log("    forbidden token '" + tok + "' found in " + fname);
    }
  }
  ok(clean, "no ES5-incompatible token '" + tok + "' (" + why + ")");
}

// CSS compatibility guard
const CSS_FORBIDDEN = [
  ["gap:", "flex gap needs Chromium 84+"],
  ["clamp(", "CSS clamp() needs Chromium 79+"],
  ["backdrop-filter", "backdrop-filter needs Chromium 76+"]
];
const cssNoComments = stylesCss.replace(/\/\*[\s\S]*?\*\//g, "");
for (const [tok, why] of CSS_FORBIDDEN) {
  ok(cssNoComments.indexOf(tok) === -1, "styles.css has no '" + tok + "' (" + why + ")");
}

// Verify EVERY var(-- declaration has a literal fallback declaration immediately before it
const varMatches = stylesCss.match(/var\(--/g) || [];
const markerMatch = stylesCss.match(/LEGACY-FALLBACKS:(\d+)/);
ok(!!markerMatch && parseInt(markerMatch[1], 10) === varMatches.length,
  "styles.css LEGACY-FALLBACKS marker matches var(-- count (" + varMatches.length + ")");

// Parse every CSS declaration block and verify literal preceding fallback
let missingFallbacks = [];
const blockRe = /\{([^{}]*)\}/g;
let bm;
while ((bm = blockRe.exec(cssNoComments)) !== null) {
  const body = bm[1];
  const decls = body.split(";").map((d) => d.trim()).filter(Boolean);
  for (let i = 0; i < decls.length; i++) {
    const colonIdx = decls[i].indexOf(":");
    if (colonIdx === -1) continue;
    const prop = decls[i].slice(0, colonIdx).trim();
    const val = decls[i].slice(colonIdx + 1).trim();
    if (prop.indexOf("--") === 0) continue; // custom property definition in :root / theme block
    if (val.indexOf("var(--") !== -1) {
      if (i === 0) {
        missingFallbacks.push(decls[i] + " (no prior declaration)");
        continue;
      }
      const prevColon = decls[i - 1].indexOf(":");
      const prevProp = prevColon !== -1 ? decls[i - 1].slice(0, prevColon).trim() : "";
      const prevVal = prevColon !== -1 ? decls[i - 1].slice(prevColon + 1).trim() : "";
      if (prevProp !== prop || prevVal.indexOf("var(--") !== -1) {
        missingFallbacks.push(decls[i] + " (preceded by: " + decls[i - 1] + ")");
      }
    }
  }
}
ok(missingFallbacks.length === 0,
  "every CSS var(-- declaration has an immediate literal fallback (" + varMatches.length + " checked" +
  (missingFallbacks.length ? ", missing: " + missingFallbacks.join("; ") : "") + ")");

// ============================================================================
// 9. ANDROID, SW, MANIFEST, ICONS & CI CROSS-CHECKS
// ============================================================================
console.log("9. Android, SW, Manifest, Icons & CI cross-checks");

const mainJava = read("android/app/src/main/java/com/dali951/quran/MainActivity.java");
ok(mainJava.indexOf("String(window.App.back())") === -1, "MainActivity.java does NOT wrap App.back() in String()");
ok(mainJava.indexOf('"false".equals') !== -1, 'MainActivity.java checks "false".equals(...) for back handling');
ok(mainJava.indexOf("shouldInterceptRequest") !== -1 && mainJava.indexOf("quran.local") !== -1,
  "MainActivity.java implements shouldInterceptRequest for https://quran.local/");
ok(mainJava.indexOf("FLAG_KEEP_SCREEN_ON") !== -1, "MainActivity.java sets/clears FLAG_KEEP_SCREEN_ON");
ok(mainJava.indexOf("setTextZoom(100)") !== -1, "MainActivity.java sets setTextZoom(100)");
ok(mainJava.indexOf("checkForUpdate") !== -1 && mainJava.indexOf("openExternalUrl") !== -1,
  "MainActivity.java implements checkForUpdate & openExternalUrl");
ok(mainJava.indexOf("https://github.com/DALI951/quran-grandma/") !== -1 &&
   mainJava.indexOf("https://objects.githubusercontent.com/") !== -1,
  "MainActivity.java allowlists official GitHub repo/release URLs");
ok(mainJava.indexOf("androidx.") === -1, "MainActivity.java uses pure Android framework (zero AndroidX)");
ok(mainJava.indexOf("@TargetApi(33)") !== -1 && mainJava.indexOf("OnBackInvokedCallback") !== -1,
  "MainActivity.java guards API 33 OnBackInvokedCallback with @TargetApi(33)");
ok(mainJava.indexOf("@TargetApi(26)") !== -1 && mainJava.indexOf("onRenderProcessGone") !== -1,
  "MainActivity.java guards API 26 onRenderProcessGone with @TargetApi(26)");
ok(mainJava.indexOf("@TargetApi(24)") !== -1 && mainJava.indexOf("ServiceWorkerController") !== -1,
  "MainActivity.java guards API 24 ServiceWorkerController with @TargetApi(24)");
ok(mainJava.indexOf("@TargetApi(23)") !== -1 && mainJava.indexOf("SYSTEM_UI_FLAG_LIGHT_STATUS_BAR") !== -1,
  "MainActivity.java guards API 23 light status bar with @TargetApi(23)");

// Balanced braces and parentheses in MainActivity.java
const javaCode = stripJavaStringsAndComments(mainJava);
let braceDepth = 0;
let parenDepth = 0;
let bracesBalanced = true;
for (const ch of javaCode) {
  if (ch === "{") braceDepth++;
  else if (ch === "}") { braceDepth--; if (braceDepth < 0) bracesBalanced = false; }
  else if (ch === "(") parenDepth++;
  else if (ch === ")") { parenDepth--; if (parenDepth < 0) bracesBalanced = false; }
}
ok(bracesBalanced && braceDepth === 0 && parenDepth === 0,
  "MainActivity.java has balanced {} and () braces");

// AndroidManifest.xml & build.gradle
const manifestXml = read("android/app/src/main/AndroidManifest.xml");
ok(manifestXml.indexOf("android.permission.INTERNET") !== -1, "AndroidManifest.xml includes INTERNET permission");
const DANGEROUS_PERMS = ["FINE_LOCATION", "COARSE_LOCATION", "EXTERNAL_STORAGE", "CAMERA", "RECORD_AUDIO", "READ_CONTACTS", "CALL_PHONE"];
ok(DANGEROUS_PERMS.every((p) => manifestXml.indexOf(p) === -1), "AndroidManifest.xml has zero dangerous permissions");

const buildGradle = read("android/app/build.gradle");
ok(/versionCode\s+4\b/.test(buildGradle), "build.gradle has versionCode 4");
ok(/versionName\s+"2\.0\.0"/.test(buildGradle), 'build.gradle has versionName "2.0.0"');
ok(/minSdk\s+21\b/.test(buildGradle) && /compileSdk\s+34\b/.test(buildGradle) && /targetSdk\s+34\b/.test(buildGradle),
  "build.gradle sets minSdk 21 / compileSdk 34 / targetSdk 34");

const pkgJson = JSON.parse(read("package.json"));
eq(pkgJson.version, "2.0.0", 'package.json version is "2.0.0"');
eq(win.QURAN_CONFIG.version, "2.0.0", 'app-config.js version is "2.0.0"');
eq(win.QURAN_CONFIG.versionCode, 4, "app-config.js versionCode is 4");

// GitHub workflow
const workflowYml = read(".github/workflows/build.yml");
const requiredAssetsInCi = [
  "index.html", "styles.css", "app-config.js", "app.js",
  "amiri-quran.woff2", "icon.svg", "icon-192.png", "icon-512.png",
  "manifest.webmanifest", "sw.js", "cp -r data"
];
ok(requiredAssetsInCi.every((item) => workflowYml.indexOf(item) !== -1),
  ".github/workflows/build.yml bundles all v2 web assets and data/");
ok(workflowYml.indexOf("quran-data.js") === -1,
  ".github/workflows/build.yml does NOT bundle monolithic quran-data.js");

// sw.js checks
const swJs = read("sw.js");
const swVerMatch = swJs.match(/VERSION\s*=\s*["']([^"']+)["']/);
ok(!!swVerMatch && swVerMatch[1].indexOf("v2") !== -1, "sw.js VERSION includes v2 (" + (swVerMatch && swVerMatch[1]) + ")");
const swAssetsMatch = swJs.match(/ASSETS\s*=\s*(\[[\s\S]*?\]);/);
let swAssets = [];
if (swAssetsMatch) {
  swAssets = JSON.parse(swAssetsMatch[1]);
}
ok(swAssets.length >= 17, "sw.js ASSETS lists all v2 assets (" + swAssets.length + ")");
let allSwAssetsExist = swAssets.length > 0;
for (const asset of swAssets) {
  const rel = asset === "./" ? "index.html" : asset.replace(/^\.\//, "");
  if (!existsSync(path.join(ROOT, rel))) {
    allSwAssetsExist = false;
    console.log("    missing SW asset on disk: " + asset);
  }
}
ok(allSwAssetsExist, "every asset in sw.js ASSETS exists on disk");

// Web manifest & icons
const webManifest = JSON.parse(read("manifest.webmanifest"));
eq(webManifest.dir, "rtl", 'manifest.webmanifest dir === "rtl"');
eq(webManifest.lang, "ar", 'manifest.webmanifest lang === "ar"');
eq(webManifest.start_url, "./index.html", 'manifest.webmanifest start_url === "./index.html"');
ok(Array.isArray(webManifest.icons) && webManifest.icons.every((ic) => existsSync(path.join(ROOT, ic.src))),
  "all manifest.webmanifest icons exist on disk");

const iconSvg = read("icon.svg");
ok(iconSvg.indexOf("<svg") !== -1 && iconSvg.indexOf("<text") === -1,
  "icon.svg is pure vector SVG with zero <text> font dependency");

for (const [pngFile, expectedDim] of [["icon-192.png", 192], ["icon-512.png", 512]]) {
  const exists = existsSync(path.join(ROOT, pngFile));
  ok(exists, pngFile + " exists");
  if (exists) {
    const buf = readBuf(pngFile);
    const sigOk = buf.length > 24 && buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    const w = sigOk ? buf.readUInt32BE(16) : 0;
    const h = sigOk ? buf.readUInt32BE(20) : 0;
    ok(sigOk && w === expectedDim && h === expectedDim,
      pngFile + " has valid PNG signature & " + expectedDim + "x" + expectedDim + " dimensions (got " + w + "x" + h + ")");
  }
}

// Final check on main JSDOM instance uncaught errors
eq(jsdomErrors.length, 0, "ZERO uncaught jsdomErrors in main verification run (" + JSON.stringify(jsdomErrors) + ")");

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
