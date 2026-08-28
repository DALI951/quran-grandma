// API verification for quran-grandma. Usage: npm test  (or node scripts/verify.js)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (err) => {
  if (err && /Not implemented/.test(err.message || "")) return; // scrollTo stub noise
  console.error(err);
});

const dir = fileURLToPath(new URL("..", import.meta.url));
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const quranData = readFileSync(new URL("../quran-data.js", import.meta.url), "utf8");

// inject the data as inline script so jsdom never tries to fetch it
const appHtml = html.replace(
  '<script src="quran-data.js"></script>',
  "<script>" + quranData + "</script>"
);

const dom = new JSDOM(appHtml, {
  url: "http://localhost/quran/index.html",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole
});
const { window } = dom;
const { document } = window;
const App = window.App;

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name); }
}
function eq(a, b, name) {
  ok(a === b, name + " (" + JSON.stringify(a) + " === " + JSON.stringify(b) + ")");
}
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const input = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("input", { bubbles: true })); };

// ——— data integrity ———
console.log("data integrity");
eq(App.data.length, 114, "114 surahs");
const s1 = App.data[0], s2 = App.data[1], s9 = App.data[8], s27 = App.data[26];
let countsOk = true;
for (const s of App.data) if (s.v.length !== s.count) countsOk = false;
ok(countsOk, "every surah's ayah count matches verses array");
ok(s1.v[0].startsWith("بِسْمِ"), "surah 1 ayah 1 is the basmala");
eq(s2.v[0], "الٓمٓ", "surah 2 ayah 1 has the baked-in basmala split out");
ok(!s9.v[0].startsWith("بِسْمِ"), "surah 9 ayah 1 has no basmala");
ok(s27.v[29].includes("بِسْمِ"), "surah 27 keeps the basmala inside verse 30");
eq(App.data[35].an, "يس", "clean surah 36 name");
let normOk = true;
for (const s of App.data) if (App.normalize(s.an) !== s.search) normOk = false;
ok(normOk, "normalize() in app matches precomputed search keys");

// ——— home list ———
console.log("home / search");
eq(document.querySelectorAll("#surahList .srow").length, 114, "all 114 surahs listed");
eq(document.querySelectorAll("#quickRow .quick").length, 6, "6 quick-access surah buttons");
eq(document.querySelector("#resultCount").hidden, true, "result counter hidden on full list");

const queryFn = (q) => App.filterSurahs(q).map((s) => s.n);
function expect(q, nums, name) {
  const got = queryFn(q);
  ok(nums.every((n) => got.includes(n)) && got.length === nums.length,
    name + " -> [" + got + "] expected [" + nums + "]");
}
expect("الفاتحه", [1], "search 'الفاتحه' finds Al-Fatiha");
expect("يس", [36], "search 'يس' finds Ya-Sin only");
expect("سورة يس", [36], "search 'سورة يس' strips the prefix");
expect("الملك", [67], "search 'الملك' finds Al-Mulk");
expect("الرحمن", [55], "search 'الرحمن' finds Ar-Rahman");
expect("36", [36], "western digits search");
expect("٣٦", [36], "arabic-indic digits search");
eq(App.filterSurahs(""), null, "empty query returns null (show all)");

// live input filters the DOM rows
input(document.getElementById("q"), "يس");
eq(document.querySelectorAll("#surahList .srow").length, 1, "typing 'يس' filters list to 1 row");
eq(document.querySelectorAll("#surahList .srow")[0].dataset.n, "36", "filtered row is surah 36");
input(document.getElementById("q"), "");
eq(document.querySelectorAll("#surahList .srow").length, 114, "clearing search restores all 114");

// ——— reader (flowing mushaf layout) ———
console.log("reader");
App.openSurah(2, false);
ok(document.getElementById("reader").hidden === false, "reader becomes visible");
ok(document.getElementById("home").hidden === true, "home hidden while reading");
eq(document.querySelectorAll("#surahBody .bsml").length, 1, "surah 2 shows the basmala line");
eq(document.querySelectorAll("#surahBody .verse").length, 286, "surah 2 renders all 286 ayat");
eq(document.querySelectorAll("#surahBody .ayah").length, 0, "verses flow inline in one block, not one per line");
ok(document.querySelector("#surahBody .verse").textContent.startsWith("الٓمٓ"), "surah 2 starts at ayah 'الٓمٓ'");
ok(document.querySelector("#surahBody .verse").textContent.includes("﴿١﴾"), "first verse ends with its inline marker");
ok(document.querySelector("#surahBody .quran").textContent.includes("\uFD3F١\uFD3Eذَٰلِكَ ٱلْكِتَٰبُ"), "verse 2 flows directly after verse 1's marker, no line break");
ok(document.querySelectorAll("#surahBody .quran").length === 1, "all verses share one flowing container");
eq(document.getElementById("readerTitle").textContent, "البقرة", "reader title = surah name");
ok(document.getElementById("jumpBanner").hidden, "no jump banner when nothing saved here");

App.openSurah(9, false);
eq(document.querySelectorAll("#surahBody .bsml").length, 0, "surah 9 has no basmala line");
ok(document.querySelector("#surahBody .verse").textContent.startsWith("بَرَا"), "surah 9 starts at Bara-ah");

App.openSurah(1, false);
eq(document.querySelectorAll("#surahBody .bsml").length, 0, "surah 1 basmala is its ayah 1, no extra line");
ok(document.querySelector("#surahBody .verse").textContent.startsWith("بِسْمِ"), "surah 1 ayah 1 is basmala");
eq(document.querySelectorAll("#surahBody .verse").length, 7, "surah 1 = 7 ayat");

// Android back button: reader -> list, then list -> exit signal
eq(App.back(), true, "hardware Back while reading returns to list");
ok(document.getElementById("home").hidden === false, "…and home is visible again");
ok(document.getElementById("reader").hidden === true, "…and reader is hidden");
eq(App.back(), false, "hardware Back on the list means exit (false)");

// ——— continue reading ———
console.log("continue / progress");
App.setState({ surah: 36, ayah: 40 });
let cb = document.getElementById("continueBtn");
ok(!cb.hidden, "continue banner appears on home");
ok(cb.textContent.includes("يس") && cb.textContent.includes("٤٠"), "continue banner shows surah + ayah");
App.openSurah(36, false);
ok(!document.getElementById("jumpBanner").hidden, "jump banner shown when resuming same surah");
ok(document.getElementById("jumpBanner").textContent.includes("٤٠"), "jump banner names ayah 40");
App.openSurah(2, false);
ok(document.getElementById("jumpBanner").hidden, "no jump banner on a different surah");
App.setState({ surah: 0, ayah: 0 });
ok(document.getElementById("continueBtn").hidden, "continue banner hides after progress cleared");

// ——— font size ———
const fsUp = document.getElementById("fsUp");
const before = document.documentElement.style.getPropertyValue("--qfs");
click(fsUp);
const after = document.documentElement.style.getPropertyValue("--qfs");
ok(before === "32px" && after === "38px", "A+ grows the verse font (32px -> " + after + ")");
click(document.getElementById("fsDown"));
eq(document.documentElement.style.getPropertyValue("--qfs"), "32px", "A- shrinks it back");

// ——— saved surahs (bookmarks) ———
console.log("saved surahs / bookmarks");
ok(document.getElementById("favBtn").textContent === "☆", "bookmark star starts empty");
ok(document.getElementById("favBar").hidden === true, "fav bar hidden with nothing saved");
App.openSurah(36, false);
eq(document.getElementById("favBtn").textContent, "☆", "star is ☆ on an unsaved surah");
click(document.getElementById("favBtn"));
eq(document.getElementById("favBtn").textContent, "★", "star becomes ★ after saving");
ok(App.getState().favs.indexOf(36) !== -1, "surah 36 is in the saved list");
ok(document.getElementById("favBar").hidden === false, "fav bar now shows (something saved)");
ok(document.getElementById("favListBtn").textContent.includes("١"), "fav bar counts 1 saved surah");
App.openSurah(1, false);
eq(document.getElementById("favBtn").textContent, "☆", "another surah still shows ☆");
App.back(); // to the list
ok(document.getElementById("home").hidden === false, "back on home after reading");
eq(document.querySelectorAll("#surahList .srow").length, 114, "full list shown by default");
click(document.getElementById("favListBtn"));
eq(document.querySelectorAll("#surahList .srow").length, 1, "saved view shows only the saved surah");
eq(document.querySelectorAll("#surahList .srow")[0].dataset.n, "36", "…and it is surah 36");
ok(!!document.querySelector("#surahList [data-rm]"), "'✕' remove button present in saved view");
click(document.querySelector("#surahList [data-rm='36']"));
eq(document.querySelectorAll("#surahList .srow").length, 0, "removing the surah empties the saved view");
ok(!!document.querySelector("#surahList .empty"), "friendly empty hint is shown");
ok(document.getElementById("favBar").hidden === true, "fav bar hides again when nothing is saved");
ok(JSON.parse(window.localStorage.getItem("quran-grandma:v1")).favs.length === 0, "removal persisted to localStorage");
click(document.getElementById("favListBtn")); // saved view off
eq(document.querySelectorAll("#surahList .srow").length, 114, "full list restored");
click(document.getElementById("favListBtn")); // saved view on (empty)
ok(!!document.querySelector("#surahList .empty"), "empty saved view has the hint");
click(document.getElementById("favListBtn")); // and off again, boot-like state
eq(document.querySelectorAll("#surahList .srow").length, 114, "back to a normal full list");

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);