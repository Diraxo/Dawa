// Shared AsyncStorage key for the "Chapa payment in flight" marker.
//
// Written by BookingModal.tsx right before opening the Chapa checkout, read
// by splash.tsx to route a cold relaunch straight back to payment-return
// instead of defaulting to Home, and cleared by payment-return.tsx once it
// takes over. Kept in its own module (rather than exported from
// BookingModal.tsx) so screens that only need the key don't have to pull in
// the whole booking-modal component tree.
export const PENDING_PAYMENT_KEY = 'carehub_pending_payment'

export interface PendingPayment {
  consultationId: string
  doctorId: string
  doctorName: string
  consultationType: string
  timing: string
  scheduledAt: string
}
