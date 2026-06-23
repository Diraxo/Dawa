export interface Language {
  id: string
  nativeName: string
  englishName: string
  flag: string
  region: string
}

export const LANGUAGES: Language[] = [
  { id: 'en', nativeName: 'English', englishName: 'English', flag: '🇺🇸', region: 'United States' },
  { id: 'so', nativeName: 'Soomaali', englishName: 'Somali', flag: '🇸🇴', region: 'Somalia' },
  { id: 'am', nativeName: 'አማርኛ', englishName: 'Amharic', flag: '🇪🇹', region: 'Ethiopia' },
  { id: 'om', nativeName: 'Afaan Oromoo', englishName: 'Oromo', flag: '🇪🇹', region: 'Ethiopia' },
  { id: 'ti', nativeName: 'ትግርኛ', englishName: 'Tigrinya', flag: '🇪🇷', region: 'Eritrea / Ethiopia' },
  { id: 'ar', nativeName: 'العربية', englishName: 'Arabic', flag: '🇸🇦', region: 'Middle East' },
]
