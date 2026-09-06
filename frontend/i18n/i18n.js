// ─── FamilyShield i18n (AI chat page only) ───

const LANG_KEY = "familyshield_lang";

let _currentLang = localStorage.getItem(LANG_KEY) || "en";

function getLang() {
  return _currentLang;
}

function setLang(lang) {
  _currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
}

function t(key, params = {}) {
  const dict = TRANSLATIONS[_currentLang] || TRANSLATIONS.en;
  let str = dict[key] || TRANSLATIONS.en[key] || key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, "g"), v);
  }
  return str;
}

// ─── Wire up language toggle button (AI page only) ───

function initLangToggle() {
  const btn = document.getElementById("lang-toggle");
  const label = document.getElementById("lang-label");
  if (!btn) return;

  // Set initial label
  if (label) label.textContent = _currentLang === "hi" ? "EN" : "HI";

  btn.addEventListener("click", () => {
    const newLang = _currentLang === "en" ? "hi" : "en";
    setLang(newLang);
    window.location.reload();
  });
}

// ─── Apply data-i18n attributes ───

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const translated = t(key);
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if (el.hasAttribute("placeholder")) {
        el.placeholder = translated;
      } else {
        el.value = translated;
      }
    } else {
      el.textContent = translated;
    }
  });

  // data-i18n-text="key" → sets el.dataset.text (e.g. AI suggestion prompts)
  document.querySelectorAll("[data-i18n-text]").forEach((el) => {
    el.dataset.text = t(el.getAttribute("data-i18n-text"));
  });
}

// ─── Init ───

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.lang = _currentLang;
    initLangToggle();
    applyTranslations();
  });
} else {
  document.documentElement.lang = _currentLang;
  initLangToggle();
  applyTranslations();
}
