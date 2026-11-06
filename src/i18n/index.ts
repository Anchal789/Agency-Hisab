import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './en'
import { hi } from './hi'

const stored = window.localStorage.getItem('hisab.language')
const initial = stored === 'hi' || stored === 'en' ? stored : 'en'

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
  },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export function setDocumentLanguage(language: string) {
  document.documentElement.lang = language === 'hi' ? 'hi' : 'en'
  window.localStorage.setItem('hisab.language', language === 'hi' ? 'hi' : 'en')
}

setDocumentLanguage(initial)

export default i18n
