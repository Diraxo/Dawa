import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import i18n from '@/lib/i18n'

interface AppState {
  selectedCountry: string | null
  selectedLanguage: string | null
  setSelectedCountry: (country: string) => void
  setSelectedLanguage: (language: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedCountry: null,
      selectedLanguage: null,
      setSelectedCountry: (country) => set({ selectedCountry: country }),
      setSelectedLanguage: (language) => {
        i18n.changeLanguage(language)
        set({ selectedLanguage: language })
      },
    }),
    {
      name: 'dawa-app-storage',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        if (state?.selectedLanguage) {
          i18n.changeLanguage(state.selectedLanguage)
        }
      },
    }
  )
)
