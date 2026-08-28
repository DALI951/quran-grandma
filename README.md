# quran-grandma · قرآن منّي لجدّتي

A dead-simple Quran reader made for an elderly grandmother (Dali's). One purpose:
**read the Quran, and find the surah she wants by typing its Arabic name.**

- RTL, big text, huge tap targets, warm paper look — no accounts, no internet needed for reading.
- One-tap favorites up top: الفاتحة، يس، الرحمن، الواقعة، الملك، الكهف
- Search in Arabic (tolerant: `سورة يس`, `الفاتحه`, `يس`, `٣٦`, `36` all work)
- Remembers where she stopped — banner on start: *"وصلتي إلى سورة يس، آية ٤٠ — واصلي"*
- Font size A− / A+, jump-to-last-ayah banner, previous/next surah at the end of the text
- Amiri Quran font embedded, verse numbering in Arabic-Indic numerals (﴿٤٠﴾)

Everything is local: the full Uthmani text ships in `quran-data.js` (from
`api.alquran.cloud/v1/quran/quran-uthmani`), the font is a 45 KB woff2, and the PWA
(`manifest.webmanifest` + `sw.js`) makes it installable and offline once hosted over HTTPS.

## Android APK (built automatically by GitHub Actions)

The `android/` folder is a tiny WebView wrapper — **no Capacitor/Flutter/React Native**, just
a small `MainActivity.java` that loads `assets/www/index.html` from the APK. The data, font and
logic ship inside the APK, so it works with zero internet.

- Every push to `main` runs the `build` workflow: `npm test` → **build APK** → deploy Pages.
- Every `v*` tag publishes a **GitHub Release with the APK attached** (`quran-grandma-vX.Y.Z.apk`).
- The Android back button returns to the surah list, and only exits the app when already there.

**Release keystore (optional but recommended).** Without it the APK is signed with a debug key
(installs fine; reinstalling over an existing copy will be blocked once the key changes). For a
stable signature add these repo secrets:

| secret | value |
|---|---|
| `KEYSTORE_B64` | `base64 -w0 keystore.jks` |
| `KEYSTORE_PASS` | store password |
| `KEYSTORE_ALIAS` | key alias (`quran`) |
| `KEYSTORE_KEY_PASS` | key password |

A ready keystore is already on Dali's box at `android/app/keystore.jks` (`keystore.properties`
next to it) plus `KEYSTORE_SECRETS.txt` in the repo folder — all gitignored, never commit them.

## Files

| file | what |
|---|---|
| `index.html` | the whole app (UI + logic) |
| `quran-data.js` | generated — 114 surahs, 6236 ayat, Uthmani script |
| `amiri-quran.woff2` | embedded reading font |
| `manifest.webmanifest` + `sw.js` + `icon.svg` | installable offline PWA |
| `android/` | WebView wrapper that builds the APK (Gradle, no extra deps) |
| `.github/workflows/build.yml` | test + APK + Pages in GitHub Actions |
| `scripts/build-data.mjs` | rebuilds `quran-data.js` from the API |
| `scripts/verify.js` | jsdom test suite |

## Develop / test

```bash
npm install
npm run build   # rebuild quran-data.js if you ever change the source text
npm test        # 46 checks: data integrity, search, reader, progress, back button, font size
```

Quick preview: `python3 -m http.server 8000` inside the folder → `http://localhost:8000`.

## Give it to Jeddati

Easiest: host the folder (GitHub Pages or Dali's own server) and open it on her
phone/tablet — Chrome will offer "Add to Home screen" so it feels like a real app
and then works fully offline. Or zip the folder and open `index.html` locally
(the service worker just won't register from `file://`, everything else works).

Some notes:
- The saved position lives in each browser's localStorage — if she switches device, the start screen just begins fresh (no data loss, no confusion).
- Verse text is quran.com's Uthmani edition; bismillah is shown as the traditional unnumbered opening line (surah 9 has none, surah 27 keeps its own inside verse 30, surah 1 has it as ayah 1).