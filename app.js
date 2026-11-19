"use strict";
(function () {
  var CONFIG = window.QURAN_CONFIG || {};
  var META = window.QURAN_META || { basmala: "", surahs: [], juz: [] };
  var SURAHS = META.surahs || [];
  var JUZ_LIST = META.juz || [];
  var FONT_SIZES = CONFIG.fontSizes || [24, 28, 32, 38, 44, 52];
  var THEMES = CONFIG.themes || ["cream", "night", "contrast"];
  var STORAGE_KEY = CONFIG.storageKey || "quran-grandma:v2";
  var LEGACY_KEY = CONFIG.legacyStorageKey || "quran-grandma:v1";
  var PAGE_CHAR_TARGET = CONFIG.pageCharTarget || 1700;
  var PAGE_MAX_AYAHS = CONFIG.pageMaxAyahs || 18;
  var APP_VERSION = CONFIG.version || "2.0.0";

  var THEME_META = {
    cream: { label: "ورقي", hex: "#0b6b4a", lightBar: false },
    night: { label: "ليلي", hex: "#121815", lightBar: false },
    contrast: { label: "واضح", hex: "#000000", lightBar: false }
  };

  window.QURAN_CHUNKS = window.QURAN_CHUNKS || {};
  var pendingChunkCbs = {};
  var loadingChunkIds = {};

  function flushChunkCbs(chunkId, err, data) {
    var list = pendingChunkCbs[chunkId];
    delete pendingChunkCbs[chunkId];
    loadingChunkIds[chunkId] = false;
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] === "function") {
        list[i](err, data);
      }
    }
  }

  window.__Q_CHUNK = function (chunkId, obj) {
    window.QURAN_CHUNKS[chunkId] = obj;
    flushChunkCbs(chunkId, null, obj);
  };

  function loadChunk(chunkId, cb) {
    if (window.QURAN_CHUNKS && window.QURAN_CHUNKS[chunkId]) {
      if (typeof cb === "function") cb(null, window.QURAN_CHUNKS[chunkId]);
      return;
    }
    if (!pendingChunkCbs[chunkId]) pendingChunkCbs[chunkId] = [];
    if (typeof cb === "function") pendingChunkCbs[chunkId].push(cb);
    if (loadingChunkIds[chunkId]) return;
    loadingChunkIds[chunkId] = true;

    var script = document.createElement("script");
    script.src = "data/c" + chunkId + ".js";
    script.async = true;
    script.onload = function () {
      if (window.QURAN_CHUNKS && window.QURAN_CHUNKS[chunkId]) {
        flushChunkCbs(chunkId, null, window.QURAN_CHUNKS[chunkId]);
      } else {
        flushChunkCbs(chunkId, new Error("Chunk did not register"), null);
      }
    };
    script.onerror = function () {
      if (script.parentNode) script.parentNode.removeChild(script);
      flushChunkCbs(chunkId, new Error("Failed to load chunk " + chunkId), null);
    };
    var parent = document.head || document.body || document.documentElement;
    parent.appendChild(script);
  }

  // ===== DOM references =====
  function $(id) { return document.getElementById(id); }

  var home = $("home");
  var reader = $("reader");
  var heroWrap = $("heroWrap");
  var continueBtn = $("continueBtn");
  var continueText = $("continueText");
  var tabBar = $("tabBar");
  var defaultFavsGrid = $("defaultFavsGrid");
  var specialShortcutsEl = $("specialShortcuts");
  var savedFavsList = $("savedFavsList");
  var rangePills = $("rangePills");
  var surahList = $("surahList");
  var juzList = $("juzList");
  var homeVersion = $("homeVersion");

  var readerTop = $("readerTop");
  var backBtn = $("backBtn");
  var readerTitle = $("readerTitle");
  var readerMeta = $("readerMeta");
  var favBtn = $("favBtn");
  var favBtnLabel = $("favBtnLabel");
  var jumpBanner = $("jumpBanner");
  var readerStatus = $("readerStatus");
  var surahBody = $("surahBody");
  var fsDown = $("fsDown");
  var fsUp = $("fsUp");
  var themeCycleBtn = $("themeCycleBtn");
  var themeCycleLabel = $("themeCycleLabel");
  var homeSettingsBtn = $("homeSettingsBtn");
  var readerSettingsBtn = $("readerSettingsBtn");

  var settingsModal = $("settingsModal");
  var settingsBackdrop = $("settingsBackdrop");
  var closeSettingsBtn = $("closeSettingsBtn");
  var readingModeChoices = $("readingModeChoices");
  var numeralsChoices = $("numeralsChoices");
  var themeChoices = $("themeChoices");
  var settingsVersion = $("settingsVersion");
  var checkUpdateBtn = $("checkUpdateBtn");
  var updateStatus = $("updateStatus");
  var updateMsg = $("updateMsg");
  var downloadUpdateBtn = $("downloadUpdateBtn");
  var toastEl = $("toast");
  var metaThemeColor = $("metaThemeColor");

  // ===== State =====
  var state = {
    version: 2,
    tab: "favs",
    last: { surah: 0, ayah: 0 },
    positions: {},
    favs: [],
    size: 2,
    theme: "cream",
    readingMode: "flowing",
    numerals: "arabic",
    openView: { view: "home", surah: 0, ayah: 0 }
  };

  var curSurah = 0;
  var curVerses = null;
  var curPages = [];
  var curPage = 0;
  var curAyah = 1;
  var resumeTargetAyah = 0;
  var userInteractedInReader = false;
  var scrollDirty = false;
  var pendingUnstarSurah = 0;
  var activeRangeFrom = 1;
  var openRequestSeq = 0;

  var ayahNodes = [];
  var tops = [];
  var lastProgrammaticScrollAt = 0;
  var scrollRafPending = false;
  var scrollSaveTimer = null;
  var toastTimer = null;
  var flashTimer = null;
  var settleTimer = null;
  var pendingUpdateUrl = "";

  // ===== Helpers (Strict ES5) =====
  var AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

  function toArabicDigits(val) {
    return String(val).replace(/[0-9]/g, function (d) {
      return AR_DIGITS.charAt(parseInt(d, 10));
    });
  }

  function fmtNum(val) {
    if (state.numerals === "western") return String(val);
    return toArabicDigits(val);
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clampInt(val, min, max) {
    var n = parseInt(val, 10);
    if (isNaN(n)) return min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function setClass(el, cls, on) {
    if (!el) return;
    if (on) el.classList.add(cls);
    else el.classList.remove(cls);
  }

  function walkUp(el, pred) {
    var cur = el;
    while (cur && cur.nodeType === 1) {
      if (pred(cur)) return cur;
      cur = cur.parentElement || cur.parentNode;
    }
    return null;
  }

  function hasAttr(name) {
    return function (el) {
      return el.getAttribute && el.getAttribute(name) !== null;
    };
  }

  function getSurahMeta(n) {
    return SURAHS[n - 1] || null;
  }

  function ayahWord(count) {
    var mod100 = count % 100;
    if (mod100 >= 3 && mod100 <= 10) return "آيات";
    return "آية";
  }

  function getScrollY() {
    if (typeof window.pageYOffset === "number") return window.pageYOffset;
    if (document.documentElement && typeof document.documentElement.scrollTop === "number") {
      return document.documentElement.scrollTop;
    }
    return 0;
  }

  function programmaticScrollTo(y) {
    lastProgrammaticScrollAt = (new Date()).getTime();
    var target = Math.max(0, Math.round(y));
    if (window.scrollTo) window.scrollTo(0, target);
  }

  function raf(fn) {
    if (window.requestAnimationFrame) return window.requestAnimationFrame(fn);
    return setTimeout(fn, 16);
  }

  function starSvg(filled) {
    return '<svg class="ico ico-star" aria-hidden="true" focusable="false" viewBox="0 0 24 24" ' +
      'fill="' + (filled ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>' +
      "</svg>";
  }

  function bookmarkSvg() {
    return '<svg class="ico ico-lg" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';
  }

  function arrowLeftSvg() {
    return '<svg class="ico" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>';
  }

  function arrowRightSvg() {
    return '<svg class="ico" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
  }

  // ===== AndroidBridge helpers =====
  function bridgeKeepScreenOn(on) {
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.setKeepScreenOn === "function") {
        window.AndroidBridge.setKeepScreenOn(!!on);
      }
    } catch (e) {}
  }

  function bridgeSetThemeColor(hex, lightBarIcons) {
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.setThemeColor === "function") {
        window.AndroidBridge.setThemeColor(hex, !!lightBarIcons);
      }
    } catch (e) {}
  }

  function bridgeOpenUrl(url) {
    if (!url) return;
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.openExternalUrl === "function") {
        window.AndroidBridge.openExternalUrl(url);
        return;
      }
    } catch (e) {}
    try { window.open(url, "_blank"); } catch (e2) {}
  }

  // ===== Storage & Migration =====
  function sanitizeFavs(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var n = parseInt(raw[i], 10);
      if (!isNaN(n) && n >= 1 && n <= 114 && out.indexOf(n) === -1) {
        out.push(n);
      }
    }
    return out;
  }

  function sanitizePositions(raw) {
    var out = {};
    if (!raw || typeof raw !== "object") return out;
    for (var k in raw) {
      if (Object.prototype.hasOwnProperty.call(raw, k)) {
        var sNum = parseInt(k, 10);
        var sm = getSurahMeta(sNum);
        var aNum = parseInt(raw[k], 10);
        if (sm && !isNaN(aNum) && aNum >= 1) {
          out[String(sNum)] = Math.min(aNum, sm.count);
        }
      }
    }
    return out;
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function loadState() {
    var rawV2 = null;
    try {
      rawV2 = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {}

    if (rawV2) {
      try {
        var parsed = JSON.parse(rawV2);
        if (parsed && typeof parsed === "object") {
          if (parsed.tab === "favs" || parsed.tab === "surahs" || parsed.tab === "juz") {
            state.tab = parsed.tab;
          }
          state.positions = sanitizePositions(parsed.positions);
          state.favs = sanitizeFavs(parsed.favs);
          if (parsed.last && typeof parsed.last === "object") {
            var ls = parseInt(parsed.last.surah, 10);
            var la = parseInt(parsed.last.ayah, 10);
            var lsm = getSurahMeta(ls);
            if (lsm) {
              state.last = { surah: ls, ayah: clampInt(la || 1, 1, lsm.count) };
            }
          }
          var sz = parseInt(parsed.size, 10);
          if (!isNaN(sz) && sz >= 0 && sz < FONT_SIZES.length) {
            state.size = sz;
          } else {
            state.size = 2;
          }
          if (THEMES.indexOf(parsed.theme) !== -1) state.theme = parsed.theme;
          if (parsed.readingMode === "flowing" || parsed.readingMode === "verse") {
            state.readingMode = parsed.readingMode;
          }
          if (parsed.numerals === "arabic" || parsed.numerals === "western") {
            state.numerals = parsed.numerals;
          }
          if (parsed.openView && typeof parsed.openView === "object") {
            var ov = parsed.openView;
            var os = parseInt(ov.surah, 10);
            var osm = getSurahMeta(os);
            if (ov.view === "reader" && osm) {
              state.openView = {
                view: "reader",
                surah: os,
                ayah: clampInt(ov.ayah || 1, 1, osm.count)
              };
            } else {
              state.openView = { view: "home", surah: 0, ayah: 0 };
            }
          }
          return;
        }
      } catch (e2) {}
    }

    // Migrate from v1 if present
    var rawV1 = null;
    try {
      rawV1 = window.localStorage.getItem(LEGACY_KEY);
    } catch (e3) {}
    if (rawV1) {
      try {
        var v1 = JSON.parse(rawV1);
        if (v1 && typeof v1 === "object") {
          var s1 = parseInt(v1.surah, 10);
          var a1 = parseInt(v1.ayah, 10);
          var sm1 = getSurahMeta(s1);
          if (sm1) {
            var safeAyah = clampInt(a1 || 1, 1, sm1.count);
            state.last = { surah: s1, ayah: safeAyah };
            state.positions[String(s1)] = safeAyah;
          }
          var sz1 = parseInt(v1.size, 10);
          if (!isNaN(sz1) && sz1 >= 0 && sz1 < FONT_SIZES.length) {
            state.size = sz1;
          }
          state.favs = sanitizeFavs(v1.favs);
          saveState();
        }
      } catch (e4) {}
    }
  }

  // ===== Toast =====
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.hidden = true;
    }, 2400);
  }

  // ===== Favorites helpers =====
  function isFav(n) {
    return state.favs.indexOf(n) !== -1;
  }

  function toggleFav(n) {
    var idx = state.favs.indexOf(n);
    if (idx === -1) state.favs.push(n);
    else state.favs.splice(idx, 1);
    saveState();
  }

  function updateReaderFavBtn() {
    var fav = isFav(curSurah);
    setClass(favBtn, "on", fav);
    favBtn.setAttribute("aria-pressed", fav ? "true" : "false");
    favBtn.setAttribute("aria-label", fav ? "إزالة السورة من المحفوظات" : "حفظ السورة في المحفوظات");
    var poly = favBtn.querySelector("polygon");
    if (poly) poly.setAttribute("fill", fav ? "currentColor" : "none");
    if (favBtnLabel) favBtnLabel.textContent = fav ? "محفوظة" : "حفظ";
  }

  function toggleFavAndRefresh(n) {
    var num = n || curSurah;
    if (!getSurahMeta(num)) return false;
    toggleFav(num);
    if (!reader.hidden && curSurah === num) {
      updateReaderFavBtn();
    }
    if (!home.hidden) {
      renderDefaultFavs();
      renderSavedFavs();
      renderSurahsList();
    }
    return isFav(num);
  }

  // ===== Home Rendering =====
  function renderContinue() {
    if (!state.last || !state.last.surah) {
      heroWrap.hidden = true;
      return;
    }
    var sm = getSurahMeta(state.last.surah);
    if (!sm) {
      heroWrap.hidden = true;
      return;
    }
    var ayah = clampInt(state.last.ayah || 1, 1, sm.count);
    heroWrap.hidden = false;
    continueText.textContent = "سورة " + sm.an + " — الآية " + fmtNum(ayah);
  }

  function renderDefaultFavs() {
    var favList = CONFIG.defaultFavs || [1, 36, 55, 56, 67, 18];
    var html = "";
    for (var i = 0; i < favList.length; i++) {
      var n = favList[i];
      var sm = getSurahMeta(n);
      if (!sm) continue;
      var pos = state.positions[String(n)] || 0;
      var fav = isFav(n);
      html += '<div class="favCell">' +
        '<button type="button" class="favCard" data-surah="' + n + '" aria-label="قراءة سورة ' + esc(sm.an) + '">' +
        '<span class="favCardTop">' +
        '<span class="favCardName">' + esc(sm.an) + "</span>" +
        (fav ? '<span class="favCardStar">' + starSvg(true) + "</span>" : "") +
        "</span>" +
        '<span class="favCardMeta">' + fmtNum(sm.count) + " " + ayahWord(sm.count) + "</span>" +
        (pos > 1 ? '<span class="favCardProg">وصلتِ للآية ' + fmtNum(pos) + "</span>" : "") +
        "</button></div>";
    }
    defaultFavsGrid.innerHTML = html;
  }

  function renderSpecialShortcuts() {
    var shortcuts = CONFIG.specialShortcuts || [
      { id: "kursi", title: "آية الكرسي", subtitle: "سورة البقرة · الآية ٢٥٥", surah: 2, ayah: 255 }
    ];
    var html = "";
    for (var i = 0; i < shortcuts.length; i++) {
      var sc = shortcuts[i];
      var sm = getSurahMeta(sc.surah);
      var subText = sm ? ("سورة " + sm.an + " · الآية " + fmtNum(sc.ayah)) : (sc.subtitle || "");
      html += '<button type="button" class="specialCard" data-shortcut-id="' + esc(sc.id) + '" data-surah="' + sc.surah + '" data-ayah="' + sc.ayah + '">' +
        '<span class="specialIcon" aria-hidden="true">' + bookmarkSvg() + "</span>" +
        '<span class="specialBody">' +
        '<span class="specialTitle">' + esc(sc.title) + "</span>" +
        '<span class="specialSub">' + esc(subText) + "</span>" +
        "</span>" +
        '<span aria-hidden="true">' + arrowLeftSvg() + "</span>" +
        "</button>";
    }
    specialShortcutsEl.innerHTML = html;
  }

  function renderSavedFavs() {
    if (!state.favs.length) {
      pendingUnstarSurah = 0;
      savedFavsList.innerHTML = '<div class="hintCard">لا توجد سور محفوظة بعد — اضغطي على زر «حفظ» أثناء القراءة لتظهر لكِ هنا دائماً.</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < state.favs.length; i++) {
      var n = state.favs[i];
      var sm = getSurahMeta(n);
      if (!sm) continue;
      var pos = state.positions[String(n)] || 0;
      var confirming = pendingUnstarSurah === n;
      html += '<div class="savedItem">' +
        '<div class="savedRow">' +
        '<button type="button" class="savedOpenBtn" data-surah="' + n + '">' +
        '<span class="snum">' + fmtNum(n) + "</span>" +
        '<span class="sinfo">' +
        '<span class="sname">' + esc(sm.an) + "</span>" +
        '<span class="smetaRow">' +
        '<span class="smeta">' + fmtNum(sm.count) + " " + ayahWord(sm.count) + "</span>" +
        (pos > 1 ? '<span class="sprog">وصلتِ للآية ' + fmtNum(pos) + "</span>" : "") +
        "</span></span>" +
        "</button>" +
        '<button type="button" class="savedRemoveBtn" data-ask-unstar="' + n + '" aria-label="إزالة سورة ' + esc(sm.an) + ' من المحفوظات">' +
        starSvg(true) + "<span>إزالة</span>" +
        "</button>" +
        "</div>";
      if (confirming) {
        html += '<div class="savedConfirm">' +
          '<p class="savedConfirmText">هل تريدين إزالة سورة ' + esc(sm.an) + " من المحفوظات؟</p>" +
          '<div class="savedConfirmBtns">' +
          '<button type="button" class="confirmYesBtn" data-confirm-unstar="' + n + '">نعم، إزالة</button>' +
          '<button type="button" class="confirmNoBtn" data-cancel-unstar="' + n + '">إبقاء</button>' +
          "</div></div>";
      }
      html += "</div>";
    }
    savedFavsList.innerHTML = html;
  }

  function renderRangePills() {
    var ranges = CONFIG.surahRanges || [
      { label: "١ – ٣٠", from: 1, to: 30 },
      { label: "٣١ – ٦٠", from: 31, to: 60 },
      { label: "٦١ – ٩٠", from: 61, to: 90 },
      { label: "٩١ – ١١٤", sub: "قصار السور", from: 91, to: 114 }
    ];
    var html = "";
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      var lbl = fmtNum(r.from) + " – " + fmtNum(r.to);
      var activeCls = activeRangeFrom === r.from ? " is-active" : "";
      html += '<button type="button" class="rangePill' + activeCls + '" data-from="' + r.from + '" data-to="' + r.to + '">' +
        "<span>" + esc(lbl) + "</span>" +
        (r.sub ? '<span class="rangeSub">' + esc(r.sub) + "</span>" : "") +
        "</button>";
    }
    rangePills.innerHTML = html;
  }

  function renderSurahsList() {
    var html = "";
    for (var i = 0; i < SURAHS.length; i++) {
      var sm = SURAHS[i];
      var pos = state.positions[String(sm.n)] || 0;
      var fav = isFav(sm.n);
      html += '<li id="surahRow-' + sm.n + '">' +
        '<button type="button" class="srow" data-surah="' + sm.n + '" aria-label="قراءة سورة ' + esc(sm.an) + '">' +
        '<span class="snum">' + fmtNum(sm.n) + "</span>" +
        '<span class="sinfo">' +
        '<span class="sname">' + esc(sm.an) + "</span>" +
        '<span class="smetaRow">' +
        '<span class="smeta">' + fmtNum(sm.count) + " " + ayahWord(sm.count) + " · الجزء " + fmtNum(sm.juz || 1) + "</span>" +
        (pos > 1 ? '<span class="sprog">وصلتِ إلى الآية ' + fmtNum(pos) + "</span>" : "") +
        "</span></span>" +
        (fav ? '<span class="sstar" aria-label="سورة محفوظة">' + starSvg(true) + "</span>" : "") +
        "</button></li>";
    }
    surahList.innerHTML = html;
  }

  function renderJuzList() {
    var html = "";
    for (var i = 0; i < JUZ_LIST.length; i++) {
      var j = JUZ_LIST[i];
      var sm = getSurahMeta(j.surah);
      var sName = sm ? sm.an : "";
      var hasLabel = j.label && j.label.length > 0;
      html += '<button type="button" class="juzCard' + (hasLabel ? " is-famous" : "") + '" data-surah="' + j.surah + '" data-ayah="' + j.ayah + '">' +
        '<span class="juzNum">' + fmtNum(j.j) + "</span>" +
        '<span class="juzBody">' +
        '<span class="juzTopLine">' +
        '<span class="juzTitle">الجزء ' + fmtNum(j.j) + "</span>" +
        (hasLabel ? '<span class="juzBadge">' + esc(j.label) + "</span>" : "") +
        "</span>" +
        '<span class="juzSub">يبدأ من سورة ' + esc(sName) + " — الآية " + fmtNum(j.ayah) + "</span>" +
        "</span>" +
        '<span aria-hidden="true">' + arrowLeftSvg() + "</span>" +
        "</button>";
    }
    juzList.innerHTML = html;
  }

  function renderHomeAll() {
    renderContinue();
    renderDefaultFavs();
    renderSpecialShortcuts();
    renderSavedFavs();
    renderRangePills();
    renderSurahsList();
    renderJuzList();
  }

  // ===== Tabs =====
  function openTab(tabId) {
    var valid = (tabId === "favs" || tabId === "surahs" || tabId === "juz") ? tabId : "favs";
    state.tab = valid;
    saveState();

    var tabs = ["favs", "surahs", "juz"];
    for (var i = 0; i < tabs.length; i++) {
      var id = tabs[i];
      var isCur = id === valid;
      var btn = $("tabBtn-" + id);
      var panel = $("panel-" + id);
      if (btn) {
        setClass(btn, "is-active", isCur);
        btn.setAttribute("aria-selected", isCur ? "true" : "false");
      }
      if (panel) {
        panel.hidden = !isCur;
      }
    }
  }

  // ===== Pagination & Reader =====
  function paginateSurah(verses, charTarget, maxAyahs) {
    var cTarget = charTarget || PAGE_CHAR_TARGET;
    var mAyahs = maxAyahs || PAGE_MAX_AYAHS;
    var pages = [];
    if (!verses || !verses.length) {
      pages.push({ index: 0, start: 0, end: 0 });
      return pages;
    }
    var start = 0;
    var chars = 0;
    var count = 0;
    for (var i = 0; i < verses.length; i++) {
      chars += verses[i].length;
      count++;
      if (count >= mAyahs || chars >= cTarget || i === verses.length - 1) {
        pages.push({ index: pages.length, start: start, end: i });
        start = i + 1;
        chars = 0;
        count = 0;
      }
    }
    return pages;
  }

  function findPageForAyah(pages, ayahNum) {
    var idx = Math.max(0, ayahNum - 1);
    for (var i = 0; i < pages.length; i++) {
      if (idx >= pages[i].start && idx <= pages[i].end) return i;
    }
    return 0;
  }

  function measureTops() {
    tops = [];
    if (reader.hidden) return;
    ayahNodes = surahBody.querySelectorAll(".verse");
    for (var i = 0; i < ayahNodes.length; i++) {
      tops.push(ayahNodes[i].offsetTop);
    }
  }

  function setActiveVerseVisual(ayahNum) {
    curAyah = ayahNum;
    for (var i = 0; i < ayahNodes.length; i++) {
      var n = parseInt(ayahNodes[i].getAttribute("data-ayah"), 10);
      setClass(ayahNodes[i], "cur", n === ayahNum);
    }
  }

  function renderCurrentPage() {
    var sm = getSurahMeta(curSurah);
    if (!sm || !curVerses || !curPages.length) return;
    var pg = curPages[curPage] || curPages[0];
    var totalPages = curPages.length;

    readerTitle.textContent = sm.an;
    var metaTxt = "سورة " + sm.an + " · " + fmtNum(sm.count) + " " + ayahWord(sm.count);
    if (totalPages > 1) {
      metaTxt += " · صفحة " + fmtNum(curPage + 1) + " من " + fmtNum(totalPages);
    }
    readerMeta.textContent = metaTxt;
    updateReaderFavBtn();

    var html = "";
    if (totalPages > 1) {
      html += '<div class="pageInfoPill">صفحة ' + fmtNum(curPage + 1) + " من " + fmtNum(totalPages) +
        " · الآيات " + fmtNum(pg.start + 1) + " – " + fmtNum(pg.end + 1) + "</div>";
    }
    if (sm.bsl && curPage === 0 && META.basmala) {
      html += '<p class="bsml">' + esc(META.basmala) + "</p>";
    }

    var modeCls = state.readingMode === "verse" ? "mode-verse" : "mode-flowing";
    html += '<div class="quran ' + modeCls + '">';
    for (var i = pg.start; i <= pg.end; i++) {
      var ayahNum = i + 1;
      var vText = curVerses[i];
      var hasSajdah = vText.indexOf("\u06E9") !== -1;
      var curCls = ayahNum === curAyah ? " cur" : "";
      html += '<span class="verse' + curCls + '" data-i="' + i + '" data-ayah="' + ayahNum + '">' +
        esc(vText) +
        (hasSajdah ? '<span class="sajdahBadge" aria-label="موضع سجدة تلاوة">سجدة تلاوة</span>' : "") +
        '<span class="enum" aria-label="نهاية الآية ' + fmtNum(ayahNum) + '">﴿' + fmtNum(ayahNum) + "﴾</span>" +
        "</span>";
    }
    html += "</div>";

    html += '<div class="pageNav">';
    if (totalPages > 1) {
      html += '<p class="pageStatusFoot">صفحة ' + fmtNum(curPage + 1) + " من " + fmtNum(totalPages) + "</p>";
      html += '<div class="pageBtns">';
      if (curPage > 0) {
        html += '<button type="button" class="pageBtn prevPage" data-page="' + (curPage - 1) + '">' +
          arrowRightSvg() + "<span>الصفحة السابقة</span></button>";
      }
      if (curPage < totalPages - 1) {
        html += '<button type="button" class="pageBtn nextPage" data-page="' + (curPage + 1) + '">' +
          "<span>الصفحة التالية</span>" + arrowLeftSvg() + "</button>";
      }
      html += "</div>";
    }

    if (curPage === totalPages - 1) {
      var prevMeta = curSurah > 1 ? getSurahMeta(curSurah - 1) : null;
      var nextMeta = curSurah < 114 ? getSurahMeta(curSurah + 1) : null;
      html += '<div class="navEnd">';
      if (nextMeta) {
        html += '<button type="button" class="nextS" data-surah="' + nextMeta.n + '">السورة التالية: ' + esc(nextMeta.an) + " ←</button>";
      }
      if (prevMeta) {
        html += '<button type="button" class="prevS" data-surah="' + prevMeta.n + '">→ السورة السابقة: ' + esc(prevMeta.an) + "</button>";
      }
      html += '<button type="button" class="toList">العودة إلى القائمة</button>';
      html += "</div>";
    }
    html += "</div>";

    surahBody.innerHTML = html;
    ayahNodes = surahBody.querySelectorAll(".verse");
    measureTops();
  }

  function scrollToAyah(ayahNum, shouldFlash) {
    if (!curSurah || !curPages.length) return;
    var sm = getSurahMeta(curSurah);
    var safeAyah = clampInt(ayahNum, 1, sm ? sm.count : ayahNum);
    var neededPage = findPageForAyah(curPages, safeAyah);
    if (neededPage !== curPage) {
      curPage = neededPage;
      renderCurrentPage();
    }
    if (!tops.length) measureTops();

    var nodeIdx = -1;
    for (var i = 0; i < ayahNodes.length; i++) {
      if (parseInt(ayahNodes[i].getAttribute("data-ayah"), 10) === safeAyah) {
        nodeIdx = i;
        break;
      }
    }
    if (nodeIdx === -1) return;

    var headerH = (readerTop && readerTop.offsetHeight) ? readerTop.offsetHeight : 0;
    var targetTop = (typeof tops[nodeIdx] === "number" ? tops[nodeIdx] : ayahNodes[nodeIdx].offsetTop);
    programmaticScrollTo(Math.max(0, targetTop - (headerH + 16)));
    setActiveVerseVisual(safeAyah);

    if (shouldFlash !== false && ayahNodes[nodeIdx]) {
      var node = ayahNodes[nodeIdx];
      node.classList.remove("flash");
      node.classList.add("flash");
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(function () {
        node.classList.remove("flash");
      }, 1500);
    }
  }

  function currentAyahIndex() {
    if (!tops.length) return 0;
    var headerH = (readerTop && readerTop.offsetHeight) ? readerTop.offsetHeight : 0;
    var mark = getScrollY() + headerH + (window.innerHeight || 640) * 0.28;
    var lo = 0;
    var hi = tops.length - 1;
    var ans = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (tops[mid] <= mark) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  function clearScrollTimer() {
    if (scrollSaveTimer) {
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = null;
    }
  }

  function commitVisibleProgress() {
    if (reader.hidden || !curSurah || !ayahNodes.length || !userInteractedInReader || !scrollDirty) return;
    scrollDirty = false;
    scrollSaveTimer = null;
    var idx = currentAyahIndex();
    var node = ayahNodes[idx];
    if (!node) return;
    var aNum = parseInt(node.getAttribute("data-ayah"), 10) || 1;
    curAyah = aNum;
    state.positions[String(curSurah)] = aNum;
    state.last = { surah: curSurah, ayah: aNum };
    state.openView = { view: "reader", surah: curSurah, ayah: aNum };
    saveState();
  }

  function onReaderScroll() {
    if (reader.hidden || !curSurah) return;
    var now = (new Date()).getTime();
    if (now - lastProgrammaticScrollAt < 250) return;

    userInteractedInReader = true;
    scrollDirty = true;
    if (!jumpBanner.hidden && getScrollY() > 80) {
      jumpBanner.hidden = true;
    }

    if (!scrollRafPending) {
      scrollRafPending = true;
      raf(function () {
        scrollRafPending = false;
        if (!scrollDirty || reader.hidden || !ayahNodes.length) return;
        var idx = currentAyahIndex();
        var node = ayahNodes[idx];
        if (node) {
          var aNum = parseInt(node.getAttribute("data-ayah"), 10) || 1;
          if (aNum !== curAyah) setActiveVerseVisual(aNum);
        }
      });
    }

    clearScrollTimer();
    scrollSaveTimer = setTimeout(commitVisibleProgress, 550);
  }

  function renderJumpBanner() {
    if (resumeTargetAyah > 1) {
      jumpBanner.hidden = false;
      jumpBanner.innerHTML = '<span class="jumpText">توقفتِ هنا سابقاً: الآية <b>' + fmtNum(resumeTargetAyah) + "</b></span>" +
        '<button type="button" id="jumpGo">اذهبي إليها</button>';
    } else {
      jumpBanner.hidden = true;
      jumpBanner.innerHTML = "";
    }
  }

  function openSurah(n, opts) {
    var sm = getSurahMeta(n);
    if (!sm) return;

    var mode = "browse";
    var explicitAyah = 0;
    if (opts === true) {
      mode = "resume";
      explicitAyah = state.positions[String(n)] || (state.last.surah === n ? state.last.ayah : 1) || 1;
    } else if (opts && typeof opts === "object") {
      mode = opts.mode || (opts.ayah ? "jump" : "browse");
      explicitAyah = opts.ayah ? parseInt(opts.ayah, 10) : 0;
    }

    openRequestSeq++;
    var mySeq = openRequestSeq;
    clearScrollTimer();
    scrollDirty = false;

    // Show reader right away so layout/visibility are ready
    home.hidden = true;
    reader.hidden = false;
    bridgeKeepScreenOn(true);
    readerTitle.textContent = sm.an;
    readerMeta.textContent = "سورة " + sm.an + " · " + fmtNum(sm.count) + " " + ayahWord(sm.count);
    curSurah = n;
    updateReaderFavBtn();
    jumpBanner.hidden = true;
    surahBody.innerHTML = "";
    readerStatus.hidden = false;
    readerStatus.innerHTML = "<p>جاري فتح السورة\u2026</p>";

    loadChunk(sm.c, function (err, chunkObj) {
      if (mySeq !== openRequestSeq) return;
      if (err || !chunkObj || !chunkObj[String(n)]) {
        readerStatus.hidden = false;
        readerStatus.innerHTML = '<p>تعذّر فتح السورة الآن</p><button type="button" class="retryBtn" id="retryChunkBtn">إعادة المحاولة</button>';
        var retry = $("retryChunkBtn");
        if (retry) {
          retry.onclick = function () { openSurah(n, opts); };
        }
        return;
      }

      readerStatus.hidden = true;
      readerStatus.innerHTML = "";
      curVerses = chunkObj[String(n)];
      curPages = paginateSurah(curVerses, PAGE_CHAR_TARGET, PAGE_MAX_AYAHS);

      if (mode === "resume" || mode === "jump") {
        var targetAyah = clampInt(explicitAyah || 1, 1, sm.count);
        curPage = findPageForAyah(curPages, targetAyah);
        curAyah = targetAyah;
        resumeTargetAyah = 0;
        userInteractedInReader = true;
        clearScrollTimer();
        scrollDirty = false;
        state.positions[String(n)] = targetAyah;
        state.last = { surah: n, ayah: targetAyah };
        state.openView = { view: "reader", surah: n, ayah: targetAyah };
        saveState();

        renderCurrentPage();
        renderJumpBanner();
        measureTops();
        scrollToAyah(targetAyah, true);

        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(function () {
          if (mySeq !== openRequestSeq || reader.hidden) return;
          measureTops();
          scrollToAyah(targetAyah, false);
        }, 80);
      } else {
        curPage = 0;
        curAyah = 1;
        var saved = parseInt(state.positions[String(n)], 10) || 0;
        resumeTargetAyah = (saved > 1 && saved <= sm.count) ? saved : 0;
        userInteractedInReader = false;
        clearScrollTimer();
        scrollDirty = false;
        state.openView = { view: "reader", surah: n, ayah: 1 };
        saveState();

        renderCurrentPage();
        renderJumpBanner();
        measureTops();
        programmaticScrollTo(0);

        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(function () {
          if (!reader.hidden) measureTops();
        }, 80);
      }
    });
  }

  function goToPage(pageIdx) {
    if (!curSurah || !curPages.length) return;
    var safeIdx = clampInt(pageIdx, 0, curPages.length - 1);
    curPage = safeIdx;
    resumeTargetAyah = 0;
    jumpBanner.hidden = true;
    userInteractedInReader = true;
    clearScrollTimer();
    scrollDirty = false;

    var firstAyah = curPages[curPage].start + 1;
    curAyah = firstAyah;
    state.positions[String(curSurah)] = firstAyah;
    state.last = { surah: curSurah, ayah: firstAyah };
    state.openView = { view: "reader", surah: curSurah, ayah: firstAyah };
    saveState();

    renderCurrentPage();
    measureTops();
    programmaticScrollTo(0);
  }

  function toHome() {
    clearScrollTimer();
    if (userInteractedInReader && scrollDirty) commitVisibleProgress();
    scrollDirty = false;
    state.openView = { view: "home", surah: 0, ayah: 0 };
    saveState();

    reader.hidden = true;
    home.hidden = false;
    bridgeKeepScreenOn(false);
    renderHomeAll();
    programmaticScrollTo(0);
  }

  // ===== Settings: Size, Theme, ReadingMode, Numerals =====
  function setSize(idx) {
    var clamped = clampInt(idx, 0, FONT_SIZES.length - 1);
    state.size = clamped;
    for (var i = 0; i < FONT_SIZES.length; i++) {
      setClass(reader, "fs-" + i, i === clamped);
    }
    try {
      document.documentElement.style.setProperty("--qfs", FONT_SIZES[clamped] + "px");
    } catch (e) {}
    if (fsDown) fsDown.disabled = clamped <= 0;
    if (fsUp) fsUp.disabled = clamped >= FONT_SIZES.length - 1;
    saveState();

    if (!reader.hidden) {
      setTimeout(measureTops, 60);
    }
  }

  function syncSettingsChoices() {
    var modeBtns = readingModeChoices.querySelectorAll("[data-mode]");
    for (var i = 0; i < modeBtns.length; i++) {
      setClass(modeBtns[i], "is-active", modeBtns[i].getAttribute("data-mode") === state.readingMode);
    }
    var numBtns = numeralsChoices.querySelectorAll("[data-numerals]");
    for (i = 0; i < numBtns.length; i++) {
      setClass(numBtns[i], "is-active", numBtns[i].getAttribute("data-numerals") === state.numerals);
    }
    var thBtns = themeChoices.querySelectorAll("[data-theme]");
    for (i = 0; i < thBtns.length; i++) {
      setClass(thBtns[i], "is-active", thBtns[i].getAttribute("data-theme") === state.theme);
    }
  }

  function setTheme(themeName) {
    var t = THEMES.indexOf(themeName) !== -1 ? themeName : "cream";
    state.theme = t;
    document.documentElement.setAttribute("data-theme", t);
    var tm = THEME_META[t] || THEME_META.cream;
    if (metaThemeColor) metaThemeColor.setAttribute("content", tm.hex);
    if (themeCycleLabel) themeCycleLabel.textContent = tm.label;
    bridgeSetThemeColor(tm.hex, tm.lightBar);
    syncSettingsChoices();
    saveState();
  }

  function cycleTheme() {
    var idx = THEMES.indexOf(state.theme);
    var next = THEMES[(idx + 1) % THEMES.length];
    setTheme(next);
  }

  function setReadingMode(mode) {
    var m = (mode === "verse" || mode === "flowing") ? mode : "flowing";
    state.readingMode = m;
    syncSettingsChoices();
    saveState();
    if (!reader.hidden && curSurah && curVerses) {
      var anchor = curAyah;
      renderCurrentPage();
      measureTops();
      if (anchor > 1) scrollToAyah(anchor, false);
    }
  }

  function setNumerals(numStyle) {
    var ns = (numStyle === "western" || numStyle === "arabic") ? numStyle : "arabic";
    state.numerals = ns;
    syncSettingsChoices();
    saveState();
    renderHomeAll();
    if (!reader.hidden && curSurah && curVerses) {
      renderCurrentPage();
      renderJumpBanner();
      measureTops();
    }
  }

  function openSettings() {
    syncSettingsChoices();
    if (settingsVersion) settingsVersion.textContent = "النسخة " + APP_VERSION;
    settingsModal.hidden = false;
  }

  function closeSettings() {
    settingsModal.hidden = true;
  }

  // ===== Updates =====
  function parseSemver(v) {
    var clean = String(v || "").replace(/^[vV]/, "").split("-")[0];
    var parts = clean.split(".");
    return [
      parseInt(parts[0], 10) || 0,
      parseInt(parts[1], 10) || 0,
      parseInt(parts[2], 10) || 0
    ];
  }

  function compareSemver(a, b) {
    var pa = parseSemver(a);
    var pb = parseSemver(b);
    for (var i = 0; i < 3; i++) {
      if (pa[i] > pb[i]) return 1;
      if (pa[i] < pb[i]) return -1;
    }
    return 0;
  }

  function handleUpdateResult(raw) {
    var res = raw;
    if (typeof raw === "string") {
      try { res = JSON.parse(raw); } catch (e) { res = { ok: false, reason: "error" }; }
    }
    updateStatus.hidden = false;
    pendingUpdateUrl = "";
    downloadUpdateBtn.hidden = true;

    if (!res || !res.ok) {
      if (res && res.reason === "offline") {
        updateMsg.textContent = "التحقق يحتاج اتصالاً بالإنترنت";
      } else {
        updateMsg.textContent = "تعذّر التحقق الآن، حاولي لاحقاً";
      }
      return;
    }

    var remoteVer = String(res.tag_name || res.version || "").replace(/^[vV]/, "");
    if (remoteVer && compareSemver(remoteVer, APP_VERSION) > 0) {
      updateMsg.textContent = "تحديث جديد متاح: النسخة " + remoteVer;
      pendingUpdateUrl = res.apk_url || res.downloadUrl || res.html_url || "";
      if (pendingUpdateUrl) {
        downloadUpdateBtn.hidden = false;
      }
    } else {
      updateMsg.textContent = "أنتِ على أحدث نسخة (" + APP_VERSION + ")";
    }
  }

  window.__onUpdateResult = handleUpdateResult;

  function checkUpdate() {
    updateStatus.hidden = false;
    updateMsg.textContent = "جاري التحقق من التحديثات\u2026";
    downloadUpdateBtn.hidden = true;
    pendingUpdateUrl = "";

    if (window.AndroidBridge && typeof window.AndroidBridge.checkForUpdate === "function") {
      try {
        window.AndroidBridge.checkForUpdate();
      } catch (e) {
        handleUpdateResult({ ok: false, reason: "error" });
      }
      return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      handleUpdateResult({ ok: false, reason: "offline" });
      return;
    }

    try {
      var xhr = new XMLHttpRequest();
      var repo = CONFIG.repo || "DALI951/quran-grandma";
      xhr.open("GET", "https://api.github.com/repos/" + repo + "/releases/latest", true);
      xhr.timeout = 6000;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var data = JSON.parse(xhr.responseText);
            var apkUrl = "";
            if (Array.isArray(data.assets)) {
              for (var i = 0; i < data.assets.length; i++) {
                var a = data.assets[i];
                if (a && a.browser_download_url && /\.apk$/i.test(a.browser_download_url)) {
                  apkUrl = a.browser_download_url;
                  break;
                }
              }
            }
            handleUpdateResult({
              ok: true,
              tag_name: data.tag_name || "",
              version: data.tag_name || "",
              body: data.body || "",
              apk_url: apkUrl,
              html_url: data.html_url || ""
            });
          } catch (e2) {
            handleUpdateResult({ ok: false, reason: "error" });
          }
        } else {
          handleUpdateResult({ ok: false, reason: xhr.status === 0 ? "offline" : "error" });
        }
      };
      xhr.onerror = function () {
        handleUpdateResult({ ok: false, reason: "offline" });
      };
      xhr.ontimeout = function () {
        handleUpdateResult({ ok: false, reason: "offline" });
      };
      xhr.send();
    } catch (e3) {
      handleUpdateResult({ ok: false, reason: "offline" });
    }
  }

  // ===== Back Contract =====
  function back() {
    if (!settingsModal.hidden) {
      closeSettings();
      return true;
    }
    if (!reader.hidden) {
      toHome();
      return true;
    }
    if (state.tab !== "favs") {
      openTab("favs");
      programmaticScrollTo(0);
      return true;
    }
    return false;
  }

  // ===== Events =====
  tabBar.addEventListener("click", function (e) {
    var btn = walkUp(e.target, hasAttr("data-tab"));
    if (btn) openTab(btn.getAttribute("data-tab"));
  });

  continueBtn.addEventListener("click", function () {
    if (state.last && state.last.surah) {
      openSurah(state.last.surah, { ayah: state.last.ayah || 1, mode: "resume" });
    }
  });

  defaultFavsGrid.addEventListener("click", function (e) {
    var btn = walkUp(e.target, hasAttr("data-surah"));
    if (btn) openSurah(parseInt(btn.getAttribute("data-surah"), 10), false);
  });

  specialShortcutsEl.addEventListener("click", function (e) {
    var btn = walkUp(e.target, hasAttr("data-surah"));
    if (btn) {
      openSurah(parseInt(btn.getAttribute("data-surah"), 10), {
        ayah: parseInt(btn.getAttribute("data-ayah"), 10) || 1,
        mode: "jump"
      });
    }
  });

  savedFavsList.addEventListener("click", function (e) {
    var yes = walkUp(e.target, hasAttr("data-confirm-unstar"));
    if (yes) {
      var nYes = parseInt(yes.getAttribute("data-confirm-unstar"), 10);
      pendingUnstarSurah = 0;
      toggleFavAndRefresh(nYes);
      return;
    }
    var no = walkUp(e.target, hasAttr("data-cancel-unstar"));
    if (no) {
      pendingUnstarSurah = 0;
      renderSavedFavs();
      return;
    }
    var ask = walkUp(e.target, hasAttr("data-ask-unstar"));
    if (ask) {
      var nAsk = parseInt(ask.getAttribute("data-ask-unstar"), 10);
      pendingUnstarSurah = (pendingUnstarSurah === nAsk) ? 0 : nAsk;
      renderSavedFavs();
      return;
    }
    var openBtn = walkUp(e.target, hasAttr("data-surah"));
    if (openBtn) {
      openSurah(parseInt(openBtn.getAttribute("data-surah"), 10), false);
    }
  });

  rangePills.addEventListener("click", function (e) {
    var pill = walkUp(e.target, hasAttr("data-from"));
    if (!pill) return;
    var fromNum = parseInt(pill.getAttribute("data-from"), 10);
    activeRangeFrom = fromNum;
    renderRangePills();
    var targetRow = $("surahRow-" + fromNum);
    if (targetRow) {
      var tabH = (tabBar && tabBar.offsetHeight) ? tabBar.offsetHeight : 0;
      var rectTop = targetRow.getBoundingClientRect().top + getScrollY();
      programmaticScrollTo(Math.max(0, rectTop - tabH - 12));
    }
  });

  surahList.addEventListener("click", function (e) {
    var btn = walkUp(e.target, hasAttr("data-surah"));
    if (btn) openSurah(parseInt(btn.getAttribute("data-surah"), 10), false);
  });

  juzList.addEventListener("click", function (e) {
    var btn = walkUp(e.target, hasAttr("data-surah"));
    if (btn) {
      openSurah(parseInt(btn.getAttribute("data-surah"), 10), {
        ayah: parseInt(btn.getAttribute("data-ayah"), 10) || 1,
        mode: "jump"
      });
    }
  });

  backBtn.addEventListener("click", toHome);
  favBtn.addEventListener("click", function () {
    toggleFavAndRefresh(curSurah);
  });

  jumpBanner.addEventListener("click", function (e) {
    var go = walkUp(e.target, function (el) { return el.id === "jumpGo"; });
    if (!go || !resumeTargetAyah) return;
    var targetAyah = resumeTargetAyah;
    resumeTargetAyah = 0;
    jumpBanner.hidden = true;
    userInteractedInReader = true;
    clearScrollTimer();
    scrollDirty = false;

    state.positions[String(curSurah)] = targetAyah;
    state.last = { surah: curSurah, ayah: targetAyah };
    state.openView = { view: "reader", surah: curSurah, ayah: targetAyah };
    saveState();

    scrollToAyah(targetAyah, true);
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      if (!reader.hidden) {
        measureTops();
        scrollToAyah(targetAyah, false);
      }
    }, 80);
  });

  surahBody.addEventListener("click", function (e) {
    var pageBtn = walkUp(e.target, hasAttr("data-page"));
    if (pageBtn) {
      goToPage(parseInt(pageBtn.getAttribute("data-page"), 10));
      return;
    }
    var navSurah = walkUp(e.target, hasAttr("data-surah"));
    if (navSurah) {
      openSurah(parseInt(navSurah.getAttribute("data-surah"), 10), false);
      return;
    }
    var toListBtn = walkUp(e.target, function (el) {
      return el.classList && el.classList.contains("toList");
    });
    if (toListBtn) {
      toHome();
      return;
    }
    var verseEl = walkUp(e.target, hasAttr("data-ayah"));
    if (verseEl) {
      var aNum = parseInt(verseEl.getAttribute("data-ayah"), 10) || 1;
      resumeTargetAyah = 0;
      jumpBanner.hidden = true;
      userInteractedInReader = true;
      clearScrollTimer();
      scrollDirty = false;
      setActiveVerseVisual(aNum);
      state.positions[String(curSurah)] = aNum;
      state.last = { surah: curSurah, ayah: aNum };
      state.openView = { view: "reader", surah: curSurah, ayah: aNum };
      saveState();
      showToast("تم حفظ مكانكِ عند الآية " + fmtNum(aNum));
    }
  });

  fsDown.addEventListener("click", function () { setSize(state.size - 1); });
  fsUp.addEventListener("click", function () { setSize(state.size + 1); });
  themeCycleBtn.addEventListener("click", cycleTheme);
  homeSettingsBtn.addEventListener("click", openSettings);
  readerSettingsBtn.addEventListener("click", openSettings);
  closeSettingsBtn.addEventListener("click", closeSettings);
  settingsBackdrop.addEventListener("click", closeSettings);

  readingModeChoices.addEventListener("click", function (e) {
    var btn = walkUp(e.target, hasAttr("data-mode"));
    if (btn) setReadingMode(btn.getAttribute("data-mode"));
  });

  numeralsChoices.addEventListener("click", function (e) {
    var btn = walkUp(e.target, hasAttr("data-numerals"));
    if (btn) setNumerals(btn.getAttribute("data-numerals"));
  });

  themeChoices.addEventListener("click", function (e) {
    var btn = walkUp(e.target, hasAttr("data-theme"));
    if (btn) setTheme(btn.getAttribute("data-theme"));
  });

  checkUpdateBtn.addEventListener("click", checkUpdate);
  downloadUpdateBtn.addEventListener("click", function () {
    if (pendingUpdateUrl) bridgeOpenUrl(pendingUpdateUrl);
  });

  window.addEventListener("scroll", onReaderScroll, { passive: true });
  window.addEventListener("resize", function () {
    setTimeout(measureTops, 120);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      clearScrollTimer();
      if (!reader.hidden && userInteractedInReader && scrollDirty) commitVisibleProgress();
      else saveState();
      scrollDirty = false;
    }
  });

  window.addEventListener("pagehide", function () {
    clearScrollTimer();
    if (!reader.hidden && userInteractedInReader && scrollDirty) commitVisibleProgress();
    else saveState();
    scrollDirty = false;
  });

  function setStatePublic(patch) {
    if (!patch || typeof patch !== "object") return;
    if (patch.last && typeof patch.last === "object") {
      var ls = parseInt(patch.last.surah, 10) || 0;
      var la = parseInt(patch.last.ayah, 10) || 0;
      var lsm = getSurahMeta(ls);
      if (lsm) {
        var safeA = clampInt(la || 1, 1, lsm.count);
        state.last = { surah: ls, ayah: safeA };
        state.positions[String(ls)] = safeA;
      } else {
        state.last = { surah: 0, ayah: 0 };
      }
    } else if (typeof patch.surah !== "undefined") {
      var ps = parseInt(patch.surah, 10) || 0;
      var pa = parseInt(patch.ayah, 10) || 0;
      var psm = getSurahMeta(ps);
      if (psm) {
        var safeP = clampInt(pa || 1, 1, psm.count);
        state.last = { surah: ps, ayah: safeP };
        state.positions[String(ps)] = safeP;
      } else {
        state.last = { surah: 0, ayah: 0 };
      }
    }
    if (patch.positions) state.positions = sanitizePositions(patch.positions);
    if (Array.isArray(patch.favs)) state.favs = sanitizeFavs(patch.favs);
    if (typeof patch.size === "number") setSize(patch.size);
    if (patch.theme) setTheme(patch.theme);
    if (patch.readingMode) setReadingMode(patch.readingMode);
    if (patch.numerals) setNumerals(patch.numerals);
    if (patch.tab) openTab(patch.tab);
    saveState();
    renderHomeAll();
  }

  // ===== Boot =====
  loadState();
  if (homeVersion) homeVersion.textContent = "النسخة " + APP_VERSION;
  setSize(state.size);
  setTheme(state.theme);
  syncSettingsChoices();
  openTab(state.tab);
  renderHomeAll();

  if (state.openView && state.openView.view === "reader" && state.openView.surah >= 1) {
    openSurah(state.openView.surah, { ayah: state.openView.ayah || 1, mode: "resume" });
  } else {
    bridgeKeepScreenOn(false);
  }

  if (
    "serviceWorker" in navigator &&
    /^https?:$/.test(location.protocol) &&
    location.hostname !== "quran.local" &&
    !window.AndroidBridge
  ) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  window.App = {
    meta: META,
    config: CONFIG,
    openSurah: openSurah,
    openTab: openTab,
    openPage: goToPage,
    setTheme: setTheme,
    setSize: setSize,
    setReadingMode: setReadingMode,
    setNumerals: setNumerals,
    toggleFav: toggleFavAndRefresh,
    getState: function () { return JSON.parse(JSON.stringify(state)); },
    setState: setStatePublic,
    checkUpdate: checkUpdate,
    loadChunk: loadChunk,
    openSettings: openSettings,
    closeSettings: closeSettings,
    scrollToAyah: scrollToAyah,
    currentAyahIndex: currentAyahIndex,
    paginateSurah: paginateSurah,
    fmtNum: fmtNum,
    back: back
  };
})();
