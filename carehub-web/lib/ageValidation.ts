export const MIN_AGE_PATIENT = 18
export const MIN_AGE_DOCTOR = 24

export function calculateAge(birthDate: Date): number {
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

export function meetsAgeRequirement(birthDate: Date, role: 'patient' | 'doctor'): boolean {
  const min = role === 'doctor' ? MIN_AGE_DOCTOR : MIN_AGE_PATIENT
  return calculateAge(birthDate) >= min
}
