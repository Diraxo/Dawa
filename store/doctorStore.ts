import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type Gender = 'Male' | 'Female'
export type DoctorStatus = 'pending' | 'approved' | 'rejected' | 'suspended' | null

interface DoctorState {
  isOnline: boolean
  doctorStatus: DoctorStatus

  // Registration — Step 1: Personal Info
  regFullName: string
  regPhone: string
  regDateOfBirth: string   // ISO date string "YYYY-MM-DD"
  regGender: Gender | null
  regProfilePhotoUri: string | null

  // Registration — Step 2: Professional Info
  regLicenseNumber: string
  regSpecialty: string
  regYearsOfExperience: number
  regHospitalName: string
  regBio: string

  // Registration — Step 3: Documents
  regLicenseDocUris: string[]   // multiple documents allowed
  regLicenseDocNames: string[]
  regIdDocType: 'national_id' | 'passport' | null
  regNationalIdFrontUri: string | null  // also used for passport photo
  regNationalIdFrontName: string | null
  regNationalIdBackUri: string | null   // only used for national_id type
  regNationalIdBackName: string | null

  // Registration — Step 2: Languages
  regLanguages: string[]

  // Registration — Step 4: Pricing
  regChatPrice: string
  regPhonePrice: string
  regVideoPrice: string

  setIsOnline: (online: boolean) => void
  setDoctorStatus: (status: DoctorStatus) => void
  updateReg: (data: Partial<Omit<DoctorState,
    'setIsOnline' | 'updateReg' | 'clearReg'
  >>) => void
  clearReg: () => void
}

export const useDoctorStore = create<DoctorState>()(
  persist(
    (set) => ({
      isOnline: false,
      doctorStatus: null,

      regFullName: '',
      regPhone: '',
      regDateOfBirth: '',
      regGender: null,
      regProfilePhotoUri: null,

      regLicenseNumber: '',
      regSpecialty: '',
      regYearsOfExperience: 1,
      regHospitalName: '',
      regBio: '',
      regLanguages: [],

      regLicenseDocUris: [],
      regLicenseDocNames: [],
      regIdDocType: null,
      regNationalIdFrontUri: null,
      regNationalIdFrontName: null,
      regNationalIdBackUri: null,
      regNationalIdBackName: null,

      regChatPrice: '',
      regPhonePrice: '',
      regVideoPrice: '',

      setIsOnline: (online) => set({ isOnline: online }),
      setDoctorStatus: (status) => set({ doctorStatus: status }),
      updateReg: (data) => set(data as Partial<DoctorState>),

      clearReg: () =>
        set({
          regFullName: '',
          regPhone: '',
          regDateOfBirth: '',
          regGender: null,
          regProfilePhotoUri: null,
          regLicenseNumber: '',
          regSpecialty: '',
          regYearsOfExperience: 1,
          regHospitalName: '',
          regBio: '',
          regLanguages: [],
          regLicenseDocUris: [],
          regLicenseDocNames: [],
          regIdDocType: null,
          regNationalIdFrontUri: null,
          regNationalIdFrontName: null,
          regNationalIdBackUri: null,
          regNationalIdBackName: null,
          regChatPrice: '',
          regPhonePrice: '',
          regVideoPrice: '',
        }),
    }),
    {
      name: 'carehub-doctor-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        isOnline: s.isOnline,
        doctorStatus: s.doctorStatus,
        regFullName: s.regFullName,
        regPhone: s.regPhone,
        regDateOfBirth: s.regDateOfBirth,
        regGender: s.regGender,
        // Don't persist file URIs — they may be base64 data URLs (large) or
        // file:// paths that become invalid after the picker session ends
        regLicenseNumber: s.regLicenseNumber,
        regSpecialty: s.regSpecialty,
        regYearsOfExperience: s.regYearsOfExperience,
        regHospitalName: s.regHospitalName,
        regBio: s.regBio,
        regLanguages: s.regLanguages,
        regLicenseDocNames: s.regLicenseDocNames,
        regIdDocType: s.regIdDocType,
        regNationalIdFrontName: s.regNationalIdFrontName,
        regNationalIdBackName: s.regNationalIdBackName,
        regChatPrice: s.regChatPrice,
        regPhonePrice: s.regPhonePrice,
        regVideoPrice: s.regVideoPrice,
      }),
    }
  )
)
