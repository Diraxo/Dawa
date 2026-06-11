import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type Gender = 'Male' | 'Female' | 'Other'

export interface IncomingRequest {
  id: string
  patientName: string
  patientAge: number
  consultationType: 'chat' | 'phone' | 'video'
  price: number
  currency: string
}

interface DoctorState {
  isOnline: boolean
  incomingRequest: IncomingRequest | null

  // Registration — Step 1: Personal Info
  regFullName: string
  regPhone: string
  regDateOfBirth: string
  regGender: Gender | null
  regProfilePhotoUri: string | null

  // Registration — Step 2: Professional Info
  regLicenseNumber: string
  regSpecialty: string
  regYearsOfExperience: number
  regHospitalName: string
  regBio: string

  // Registration — Step 3: Documents
  regLicenseDocUri: string | null
  regLicenseDocName: string | null
  regNationalIdUri: string | null
  regNationalIdName: string | null

  // Registration — Step 4: Pricing
  regChatPrice: string
  regPhonePrice: string
  regVideoPrice: string

  setIsOnline: (online: boolean) => void
  setIncomingRequest: (req: IncomingRequest | null) => void
  updateReg: (data: Partial<Omit<DoctorState,
    'setIsOnline' | 'setIncomingRequest' | 'updateReg' | 'clearReg' | 'incomingRequest'
  >>) => void
  clearReg: () => void
}

export const useDoctorStore = create<DoctorState>()(
  persist(
    (set) => ({
      isOnline: false,
      incomingRequest: null,

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

      regLicenseDocUri: null,
      regLicenseDocName: null,
      regNationalIdUri: null,
      regNationalIdName: null,

      regChatPrice: '',
      regPhonePrice: '',
      regVideoPrice: '',

      setIsOnline: (online) => set({ isOnline: online }),
      setIncomingRequest: (req) => set({ incomingRequest: req }),
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
          regLicenseDocUri: null,
          regLicenseDocName: null,
          regNationalIdUri: null,
          regNationalIdName: null,
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
        regFullName: s.regFullName,
        regPhone: s.regPhone,
        regDateOfBirth: s.regDateOfBirth,
        regGender: s.regGender,
        regProfilePhotoUri: s.regProfilePhotoUri,
        regLicenseNumber: s.regLicenseNumber,
        regSpecialty: s.regSpecialty,
        regYearsOfExperience: s.regYearsOfExperience,
        regHospitalName: s.regHospitalName,
        regBio: s.regBio,
        regLicenseDocUri: s.regLicenseDocUri,
        regLicenseDocName: s.regLicenseDocName,
        regNationalIdUri: s.regNationalIdUri,
        regNationalIdName: s.regNationalIdName,
        regChatPrice: s.regChatPrice,
        regPhonePrice: s.regPhonePrice,
        regVideoPrice: s.regVideoPrice,
      }),
    }
  )
)
