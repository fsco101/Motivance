import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import fil from './fil.json'

export type Language = 'en' | 'fil'
const KEY = 'motivance.language'

function stored(): Language {
  try {
    return localStorage.getItem(KEY) === 'fil' ? 'fil' : 'en'
  } catch {
    return 'en'
  }
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fil: { translation: fil } },
  lng: stored(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

const mark = (language: string) => { if (typeof document !== 'undefined') document.documentElement.lang = language }
mark(i18n.language)

export function setLanguage(language: Language) {
  try {
    localStorage.setItem(KEY, language)
  } catch {
    // The choice still applies for this visit.
  }
  mark(language)
  void i18n.changeLanguage(language)
}

export default i18n
