// App configuration for quran-grandma v2.0.0 (strict ES5)
window.QURAN_CONFIG = {
  version: "2.0.0",
  versionCode: 4,
  repo: "DALI951/quran-grandma",
  storageKey: "quran-grandma:v2",
  legacyStorageKey: "quran-grandma:v1",
  defaultFavs: [1, 36, 55, 56, 67, 18],
  specialShortcuts: [
    {
      id: "kursi",
      title: "آية الكرسي",
      subtitle: "سورة البقرة · الآية ٢٥٥",
      surah: 2,
      ayah: 255
    }
  ],
  surahRanges: [
    { label: "١ – ٣٠", from: 1, to: 30 },
    { label: "٣١ – ٦٠", from: 31, to: 60 },
    { label: "٦١ – ٩٠", from: 61, to: 90 },
    { label: "٩١ – ١١٤", sub: "قصار السور", from: 91, to: 114 }
  ],
  tabs: [
    { id: "favs", label: "المفضلة" },
    { id: "surahs", label: "السور" },
    { id: "juz", label: "الأجزاء" }
  ],
  fontSizes: [24, 28, 32, 38, 44, 52],
  themes: ["cream", "night", "contrast"],
  pageCharTarget: 1700,
  pageMaxAyahs: 18
};
