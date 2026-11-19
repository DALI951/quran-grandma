# quran-grandma · قرآن منّي لجدّتي (v2.0.0)

A simple, dignified Quran reader made for an elderly grandmother (Dali's). Built for **100% scroll-and-tap navigation** — no typing, no search keyboard, no accounts, and completely offline reading.

## What's in v2.0.0

- **Zero-typing 3-tab Home screen**:
  - **المفضلة (Favorites)**: 6 default quick-access surahs (الفاتحة، يس، الرحمن، الواقعة، الملك، الكهف), a one-tap shortcut to **آية الكرسي** (opens Surah 2 directly on the page of Ayah 255), plus her own starred surahs.
  - **السور (Surahs)**: Quick range jump pills (`١ – ٣٠`, `٣١ – ٦٠`, `٦١ – ٩٠`, `٩١ – ١١٤ قصار السور`) and large tap rows with saved-ayah indicators and proper Arabic hamzas.
  - **الأجزاء (Juz)**: All 30 Juz cards jumping straight to the exact starting surah and ayah (highlighting famous Juz like عمّ، تبارك، قد سمع).
  - **Hero Continue Card**: Resumes her last surah, page, and ayah in one tap.
- **Paginated Mushaf Reader**:
  - Splits long surahs (such as Al-Baqarah) into comfortable pages with big Previous/Next page buttons, tap-any-ayah bookmarking, per-surah saved progress, and Sajdah indicators.
  - Switchable **مصحف متصل** (flowing) vs **آية بآية** (verse-by-verse) reading styles, Arabic-Indic (`١٢٣`) vs Western (`123`) numerals, 6 font sizes (`أ−` / `أ+`), and 3 themes (**ورقي** Cream, **ليلي** Night, **واضح** High Contrast).
- **Manual In-App Update Check**:
  - Optional check in Settings queries GitHub Releases (`DALI951/quran-grandma/releases/latest`) on demand and opens allowlisted GitHub release/APK URLs. Offline launches never show network popups.

## Old & Budget Android Optimizations

The `android/` wrapper is a pure Android framework WebView app (**`minSdk 21` / Android 5.0+**, `compileSdk 34`, `targetSdk 34`, zero AndroidX or external Gradle dependencies):

- **Virtual HTTPS Origin (`https://quran.local/`)**: `MainActivity.java` serves `assets/www/` via `WebViewClient.shouldInterceptRequest` (and `ServiceWorkerController` on API 24+) with strict MIME types and path-traversal blocking. This prevents `file://` CORS blocking of `amiri-quran.woff2` on modern Android 14/15 WebViews while working identically back to Android 5.0.
- **Hardware & Gesture Back**: Properly integrates `OnBackInvokedCallback` (API 33+) and `onBackPressed()` (API < 33) with `window.App.back()`, closing modals → exiting reader → returning to Favorites tab before exiting the app.
- **Low-RAM & Budget Device Stability**:
  - Chunked Quran data (`data/meta.js` + `data/c1.js`..`data/c6.js`, ~1.37 MB total) loaded on demand; the monolithic `quran-data.js` is kept solely as an offline build source and excluded from the APK and GitHub Pages builds.
  - `setTextZoom(100)` locks WebView text scaling, `FLAG_KEEP_SCREEN_ON` keeps the screen awake while reading, `fitsSystemWindows` prevents Android 14/15 bar overlap, and `onRenderProcessGone` (API 26+) recovers cleanly if the OS reclaims the renderer on 2–3 GB RAM devices.
- **Legacy WebView Compat Guard**: Strict ES5 JavaScript (`app-config.js`, `app.js`) and fallback-guarded CSS (`styles.css`) compatible with stock Android 5/6 WebViews (Chromium 37–44), enforced automatically by `npm test`.
- **Minimal Permissions**: Only `android.permission.INTERNET` (solely for user-initiated update checks in Settings). Zero location, storage, or camera permissions.

## Android APK & Signing (GitHub Actions)

Every push to `main` runs `.github/workflows/build.yml`: `npm test` → **build APK** (`gradle -p android -q assembleRelease`) → deploy GitHub Pages. Every `v*` tag attaches `quran-grandma-vX.Y.Z.apk` to a GitHub Release.

**Release keystore (optional but recommended).** Without it the APK is signed with a debug key (installs fine, though reinstalling over an existing build requires matching signatures). For a stable signature, add these GitHub repository secrets:

| Secret | Value |
|---|---|
| `KEYSTORE_B64` | `base64 -w0 keystore.jks` |
| `KEYSTORE_PASS` | keystore store password |
| `KEYSTORE_ALIAS` | key alias (e.g. `quran`) |
| `KEYSTORE_KEY_PASS` | key password |

Local `android/app/keystore.jks`, `android/app/keystore.properties`, and `KEYSTORE_SECRETS.txt` are gitignored — never commit them.

## Files

| Path | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | Reader & 3-tab UI (strict ES5 + legacy-safe CSS) |
| `app-config.js` | Version, tabs, shortcuts, surah ranges, font sizes, pagination limits |
| `data/meta.js`, `data/c1.js`..`data/c6.js` | Generated metadata (114 surahs, 30 Juz) and 6 on-demand verse chunks |
| `amiri-quran.woff2` | Embedded Uthmani reading font |
| `icon.svg`, `icon-192.png`, `icon-512.png`, `manifest.webmanifest`, `sw.js` | Vector/PNG icons & offline PWA assets |
| `android/` | Pure framework `MainActivity.java` (`https://quran.local/`) + Gradle APK config |
| `.github/workflows/build.yml` | CI test, APK build/release, and GitHub Pages deployment |
| `scripts/build-data.mjs` | Rebuilds `data/meta.js` and `data/c1.js`..`c6.js` offline from `quran-data.js` (or `--fetch`) |
| `scripts/verify.js` | `jsdom` + ES5/CSS compatibility + Android/CI verification suite |
| `quran-data.js` | Offline Uthmani source data (excluded from APK & Pages bundles) |

## Develop & Test

```bash
npm install
npm run build   # rebuild data/meta.js & data/c1.js..c6.js from quran-data.js (add --fetch to pull API)
npm test        # run jsdom, data, UI, ES5/CSS compat, and Android/CI checks
```

Quick local preview (serve over HTTP so chunk scripts and service worker load cleanly):

```bash
python3 -m http.server 8000
```
