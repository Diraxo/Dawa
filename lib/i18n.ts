import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import am from './translations/am'
import ar from './translations/ar'
import en from './translations/en'
import om from './translations/om'
import so from './translations/so'
import ti from './translations/ti'

const resources = {
  en: { translation: en },
  so: { translation: so },
  am: { translation: am },
  om: { translation: om },
  ti: { translation: ti },
  ar: { translation: ar },
}

i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
})

export default i18n
