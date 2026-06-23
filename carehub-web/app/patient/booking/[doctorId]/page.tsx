'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'
import Link from 'next/link'
import { stripDrPrefix } from '@/lib/utils'

interface DoctorProfile {
  id: string
  specialty: string
  chat_price: number
  phone_price: number
  video_price: number
  hospital_name: string
  is_online: boolean
  availability: Record<string, unknown> | null
  user: { full_name: string } | null
}

type ConsultType = 'chat' | 'phone' | 'video'
type Step = 1 | 2 | 3 | 4

interface ActiveCredit {
  creditConsultationId: string
  creditAmount:         number
}

const TYPE_META: Record<ConsultType, { icon: string; label: string; priceKey: keyof DoctorProfile }> = {
  chat:  { icon: '💬', label: 'Chat Consultation',  priceKey: 'chat_price' },
  phone: { icon: '📞', label: 'Phone Call',          priceKey: 'phone_price' },
  video: { icon: '🎥', label: 'Video Call',          priceKey: 'video_price' },
}

const PLATFORM_FEE_PERCENT = 0.2

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parseTimeMins(t: string): number {
  const [timePart, meridiem] = t.split(' ')
  const [h, m] = timePart.split(':').map(Number)
  let hour = h
  if (meridiem === 'PM' && h !== 12) hour += 12
  if (meridiem === 'AM' && h === 12) hour = 0
  return hour * 60 + m
}

function formatTimeMins(totalMins: number): string {
  const h24 = Math.floor(totalMins / 60)
  const m = totalMins % 60
  const meridiem = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${meridiem}`
}

function getAvailableSlots(availability: Record<string, unknown> | null, dayValue: string): string[] {
  if (!availability) return []
  const dayName = DAY_NAMES[new Date(dayValue + 'T12:00:00').getDay()]
  const cfg = availability[dayName] as { enabled?: boolean; startTime?: string; endTime?: string } | undefined
  if (!cfg?.enabled || !cfg.startTime || !cfg.endTime) return []
  const start = parseTimeMins(cfg.startTime)
  const end = parseTimeMins(cfg.endTime)
  const slots: string[] = []
  for (let t = start; t < end; t += 60) slots.push(formatTimeMins(t))
  return slots
}

function getNextDays(count: number) {
  const days = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    days.push({
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      value: d.toISOString().split('T')[0],
    })
  }
  return days
}

function parseScheduledAt(dayValue: string, timeSlot: string): string {
  const [timePart, meridiem] = timeSlot.split(' ')
  const [hourStr, minStr] = timePart.split(':')
  let hour = parseInt(hourStr, 10)
  const min = parseInt(minStr, 10)
  if (meridiem === 'PM' && hour !== 12) hour += 12
  if (meridiem === 'AM' && hour === 12) hour = 0
  return new Date(`${dayValue}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`).toISOString()
}

export default function BookingPage() {
  const { doctorId } = useParams<{ doctorId: string }>()
  const searchParams = useSearchParams()
  const { getToken } = useAuth()
  const { user } = useUser()

  const initialType = (searchParams.get('type') ?? 'chat') as ConsultType
  const [step, setStep] = useState<Step>(1)
  const [doctor, setDoctor] = useState<DoctorProfile | null>(null)
  const [selectedType, setSelectedType] = useState<ConsultType>(initialType)
  const [scheduleMode, setScheduleMode] = useState<'now' | 'schedule'>('now')
  const [selectedDay, setSelectedDay] = useState(0)
  const [selectedTime, setSelectedTime] = useState('')
  const [loading, setLoading] = useState(true)
  const [booking, setBooking] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [activeCredit, setActiveCredit] = useState<ActiveCredit | null>(null)
  const [creditLoading, setCreditLoading] = useState(false)
  const days = getNextDays(7)

  useEffect(() => {
    supabase
      .from('doctor_profiles')
      .select('id, specialty, hospital_name, is_online, chat_price, phone_price, video_price, availability, user:users(full_name)')
      .eq('id', doctorId)
      .single()
      .then(({ data }) => {
        setDoctor(data as unknown as DoctorProfile)
        setLoading(false)
      })
  }, [doctorId])

  // Check for active credit when user reaches review/payment step
  useEffect(() => {
    if (step < 3 || !user) return
    let cancelled = false
    setCreditLoading(true)
    ;(async () => {
      try {
        const token = await getToken()
        if (!token || cancelled) return
        const client = getAuthClient(token)
        const { data: userData } = await client.from('users').select('id').eq('clerk_id', user.id).single()
        if (!userData || cancelled) return

        const { data: credits } = await client
          .from('consultations')
          .select('id, credit_amount')
          .eq('patient_id', userData.id)
          .eq('consultation_credit', true)
          .eq('credit_used', false)
          .order('created_at', { ascending: false })
          .limit(1)

        if (cancelled) return
        if (credits && credits.length > 0) {
          setActiveCredit({
            creditConsultationId: credits[0].id,
            creditAmount:         Number(credits[0].credit_amount ?? 0),
          })
        } else {
          setActiveCredit(null)
        }
      } catch {
        // credit check is best-effort
      } finally {
        if (!cancelled) setCreditLoading(false)
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  async function initiateChapaPayment() {
    if (scheduleMode === 'now' && doctor && !doctor.is_online) {
      setPayError('This doctor is currently offline. Please schedule for a later time or choose another doctor.')
      return
    }
    setBooking(true)
    let createdConsultationId: string | null = null
    try {
      const token = await getToken()
      if (!token || !user) throw new Error('Not authenticated')

      const client = getAuthClient(token)
      const { data: userData } = await client.from('users').select('id').eq('clerk_id', user.id).single()
      if (!userData) throw new Error('User profile not found')

      const price = doctor ? (doctor[TYPE_META[selectedType].priceKey] as number) : 0
      const platformFee = Math.round(price * PLATFORM_FEE_PERCENT)
      const doctorAmount = price - platformFee

      const scheduledAt = scheduleMode === 'now'
        ? new Date().toISOString()
        : parseScheduledAt(days[selectedDay].value, selectedTime)

      const creditCoversAll = activeCredit !== null && price <= activeCredit.creditAmount
      const additionalRequired = activeCredit ? Math.max(0, price - activeCredit.creditAmount) : price

      // 1. Create consultation record
      const { data: consultation, error: consultErr } = await client.from('consultations').insert({
        patient_id:      userData.id,
        doctor_id:       doctorId,
        type:            selectedType,
        status:          'pending_payment',
        scheduled_at:    scheduledAt,
        patient_amount:  price,
        doctor_amount:   doctorAmount,
        platform_amount: platformFee,
        payment_status:  'pending',
      }).select('id').single()

      if (consultErr || !consultation) throw new Error('Failed to create booking')
      createdConsultationId = consultation.id

      const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL    ?? ''
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

      // 2. Full credit coverage — apply credit via edge function, skip Chapa
      if (creditCoversAll && activeCredit) {
        const creditResp = await fetch(`${supabaseUrl}/functions/v1/apply-credit`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'apikey':        supabaseAnonKey,
          },
          body: JSON.stringify({
            patient_clerk_id:       user.id,
            credit_consultation_id: activeCredit.creditConsultationId,
            new_consultation_id:    consultation.id,
          }),
        })
        if (!creditResp.ok) {
          const d = await creditResp.json()
          throw new Error(d?.error ?? 'Failed to apply consultation credit')
        }
        // Credit applied — navigate to waiting room
        window.location.href = `/patient/waiting/${consultation.id}`
        return
      }

      // 3. Partial credit — record credit_source_id via initialize-payment then pay difference
      // return_url — use actual origin so Chapa redirects back to the right domain
      const returnUrl = `${window.location.origin}/patient/payment/return?consultation_id=${consultation.id}`

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      let payResp: Response
      try {
        payResp = await fetch(`${supabaseUrl}/functions/v1/initialize-payment`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'apikey':        supabaseAnonKey,
          },
          body: JSON.stringify({
            consultation_id:  consultation.id,
            amount:           activeCredit ? additionalRequired : price,
            email:            user.primaryEmailAddress?.emailAddress ?? '',
            first_name:       user.firstName  ?? 'Patient',
            last_name:        user.lastName   ?? '-',
            type:             selectedType,
            doctor_name:      doctor?.user?.full_name ?? 'Doctor',
            return_url:       returnUrl,
            ...(activeCredit ? { credit_source_id: activeCredit.creditConsultationId } : {}),
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }

      const payData = await payResp.json()

      if (!payResp.ok || !payData?.checkout_url) {
        console.error('[Booking] Payment initialization failed:', payData)
        const raw = payData?.error
        const msg = typeof raw === 'string' && raw.length
          ? raw
          : typeof raw === 'object' && raw !== null
            ? JSON.stringify(raw)
            : 'Could not start payment. Please try again.'
        throw new Error(msg)
      }

      // 4. Redirect browser to Chapa checkout
      window.location.href = payData.checkout_url
    } catch (err: any) {
      // Cancel the orphaned pending consultation if payment setup failed
      if (createdConsultationId) {
        try {
          const token = await getToken()
          if (token) {
            const client = getAuthClient(token)
            await client.from('consultations').update({ status: 'cancelled' }).eq('id', createdConsultationId)
          }
        } catch {
          // best effort
        }
      }
      const msg = err?.name === 'AbortError'
        ? 'Payment request timed out. Please check your connection and try again.'
        : (err?.message ?? 'Something went wrong. Please try again.')
      setPayError(msg)
      setBooking(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-ink-black/40 text-sm">Loading…</div>
      </div>
    )
  }

  if (!doctor) {
    return (
      <div className="p-8 text-center">
        <p className="font-montserrat font-bold text-ink-black">Doctor not found</p>
        <Link href="/patient/doctors" className="btn-primary mt-4 inline-flex h-10 px-6 text-sm rounded-xl">Back</Link>
      </div>
    )
  }

  const price = doctor[TYPE_META[selectedType].priceKey] as number
  const platformFee = Math.round(price * PLATFORM_FEE_PERCENT)

  const STEPS = ['Type', 'Timing', 'Review', 'Payment']

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Back */}
      <Link href={`/patient/doctors/${doctorId}`} className="inline-flex items-center gap-2 text-ink-black/50 hover:text-ink-black text-sm mb-6 transition-colors">
        ← Back to Profile
      </Link>

      <h1 className="font-montserrat font-black text-2xl text-ink-black mb-1">Book Consultation</h1>
      <p className="text-ink-black/50 text-sm mb-6">with Dr. {stripDrPrefix(doctor.user?.full_name ?? '')} · {doctor.specialty}</p>

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8">
        {STEPS.map((s, i) => {
          const n = (i + 1) as Step
          const done = step > n
          const active = step === n
          return (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                done ? 'bg-success text-white' : active ? 'bg-int-blue text-white' : 'bg-steel-grey text-ink-black/40'
              }`}>
                {done ? '✓' : n}
              </div>
              <span className={`text-[10px] font-semibold hidden sm:block ${active ? 'text-int-blue' : 'text-ink-black/40'}`}>{s}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 ${done ? 'bg-success' : 'bg-steel-grey'}`} />}
            </div>
          )
        })}
      </div>

      {/* Step 1 — Choose type */}
      {step === 1 && (
        <div className="card p-6">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Choose Consultation Type</h2>
          <div className="flex flex-col gap-3 mb-6">
            {(Object.entries(TYPE_META) as [ConsultType, typeof TYPE_META[ConsultType]][]).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => setSelectedType(key)}
                className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left ${
                  selectedType === key ? 'border-int-blue bg-int-blue/5' : 'border-steel-grey hover:border-int-blue/40'
                }`}
              >
                <span className="text-2xl">{meta.icon}</span>
                <div className="flex-1">
                  <p className="font-montserrat font-bold text-sm text-ink-black">{meta.label}</p>
                </div>
                <span className="font-bold text-sm text-ink-black">
                  {doctor[meta.priceKey] ? `ETB ${doctor[meta.priceKey]}` : 'Free'}
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => setStep(2)} className="btn-primary w-full">Continue →</button>
        </div>
      )}

      {/* Step 2 — Timing */}
      {step === 2 && (
        <div className="card p-6">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">When do you want to consult?</h2>
          <div className="flex flex-col gap-3 mb-6">
            <button
              onClick={() => setScheduleMode('now')}
              className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
                scheduleMode === 'now' ? 'border-int-blue bg-int-blue/5' : 'border-steel-grey hover:border-int-blue/40'
              }`}
            >
              <span className="text-2xl">⚡</span>
              <div>
                <p className="font-montserrat font-bold text-sm text-ink-black">Right Now — On Demand</p>
                <p className="text-ink-black/50 text-xs">Doctor will be notified immediately</p>
              </div>
            </button>
            <button
              onClick={() => setScheduleMode('schedule')}
              className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
                scheduleMode === 'schedule' ? 'border-int-blue bg-int-blue/5' : 'border-steel-grey hover:border-int-blue/40'
              }`}
            >
              <span className="text-2xl">📅</span>
              <div>
                <p className="font-montserrat font-bold text-sm text-ink-black">Schedule for Later</p>
                <p className="text-ink-black/50 text-xs">Pick a future date and time slot</p>
              </div>
            </button>
          </div>

          {scheduleMode === 'schedule' && (
            <div className="mb-6">
              <p className="font-montserrat font-bold text-sm text-ink-black mb-2">Select Date</p>
              <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
                {days.map((day, idx) => (
                  <button
                    key={day.value}
                    onClick={() => setSelectedDay(idx)}
                    className={`px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                      selectedDay === idx ? 'bg-care-blue text-white' : 'bg-cloud-grey text-ink-black/60 border border-steel-grey'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              <p className="font-montserrat font-bold text-sm text-ink-black mb-2">Select Time</p>
              {(() => {
                const slots = getAvailableSlots(doctor?.availability ?? null, days[selectedDay].value)
                if (slots.length === 0) {
                  return (
                    <p className="text-ink-black/40 text-xs py-3">
                      No available slots for this day. Please select another date.
                    </p>
                  )
                }
                return (
                  <div className="flex flex-wrap gap-2">
                    {slots.map(slot => (
                      <button key={slot} onClick={() => setSelectedTime(slot)}
                        className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                          selectedTime === slot ? 'bg-care-blue text-white' : 'bg-white text-ink-black/60 border border-steel-grey'
                        }`}>
                        {slot}
                      </button>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="btn-outline flex-1">← Back</button>
            <button
              onClick={() => setStep(3)}
              disabled={scheduleMode === 'schedule' && !selectedTime}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Review */}
      {step === 3 && (
        <div className="card p-6">
          <h2 className="font-montserrat font-bold text-lg text-ink-black mb-4">Review Your Booking</h2>

          <div className="bg-cloud-grey rounded-2xl p-4 mb-5 flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-black/60">Doctor</span>
              <span className="font-semibold text-ink-black">Dr. {stripDrPrefix(doctor.user?.full_name ?? '')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-black/60">Specialty</span>
              <span className="font-semibold text-ink-black">{doctor.specialty}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-black/60">Type</span>
              <span className="font-semibold text-ink-black">{TYPE_META[selectedType].icon} {TYPE_META[selectedType].label}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-black/60">Timing</span>
              <span className="font-semibold text-ink-black">
                {scheduleMode === 'now' ? 'On Demand' : `${days[selectedDay].label} at ${selectedTime}`}
              </span>
            </div>
            <div className="border-t border-steel-grey pt-3 flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-ink-black/50">Consultation fee</span>
                <span className="text-ink-black">ETB {price}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-black/50">Platform fee (20%)</span>
                <span className="text-ink-black">ETB {platformFee}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span className="text-ink-black">Total</span>
                <span className="text-ink-black">ETB {price}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="btn-outline flex-1">← Back</button>
            <button onClick={() => setStep(4)} className="btn-primary flex-1">Continue →</button>
          </div>
        </div>
      )}

      {/* Step 4 — Payment (Chapa or Credit) */}
      {step === 4 && (() => {
        const creditCoversAll = activeCredit !== null && price <= activeCredit.creditAmount
        const additionalRequired = activeCredit ? Math.max(0, price - activeCredit.creditAmount) : price

        return (
          <div className="card p-6 relative">
            {booking && (
              <div className="absolute inset-0 bg-white/80 rounded-2xl flex flex-col items-center justify-center z-10 gap-4">
                <div className="w-12 h-12 rounded-full border-4 border-steel-grey border-t-int-blue animate-spin" />
                <p className="font-montserrat font-semibold text-sm text-ink-black">
                  {creditCoversAll ? 'Applying your credit…' : 'Preparing your payment…'}
                </p>
              </div>
            )}

            <h2 className="font-montserrat font-black text-xl text-ink-black mb-1">
              {creditCoversAll ? 'Confirm with Credit' : 'Pay with Chapa'}
            </h2>
            <p className="text-ink-black/50 text-sm mb-5">
              {creditCoversAll ? 'Your consultation credit covers this booking.' : 'Secure payment powered by Chapa'}
            </p>

            {/* Order summary */}
            <div className="bg-cloud-grey rounded-2xl p-4 mb-5 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-black/60">Consultation</span>
                <span className="font-semibold text-ink-black">{TYPE_META[selectedType].icon} {TYPE_META[selectedType].label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-black/60">Doctor</span>
                <span className="font-semibold text-ink-black">Dr. {stripDrPrefix(doctor?.user?.full_name ?? '')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-black/60">Consultation Fee</span>
                <span className="font-semibold text-ink-black">ETB {price}</span>
              </div>
              {activeCredit && (
                <div className="flex justify-between text-teal-700">
                  <span>Consultation Credit</span>
                  <span className="font-semibold">-ETB {activeCredit.creditAmount}</span>
                </div>
              )}
              <div className="border-t border-steel-grey pt-2 flex justify-between font-bold">
                <span className="text-ink-black">{creditCoversAll ? 'Total Due' : 'Additional Payment'}</span>
                <span className="text-teal-600">
                  {creditCoversAll ? 'ETB 0' : `ETB ${additionalRequired}`}
                </span>
              </div>
            </div>

            {/* Credit notice */}
            {activeCredit && !creditLoading && (
              <div className="flex items-start gap-2 bg-teal-50 border border-teal-200 rounded-xl p-4 mb-5">
                <span className="text-teal-600 text-sm">💳</span>
                <p className="text-teal-700 text-xs leading-relaxed">
                  {creditCoversAll
                    ? `Your ETB ${activeCredit.creditAmount} credit covers the full amount. No payment required.`
                    : `Your ETB ${activeCredit.creditAmount} credit is applied. You only need to pay ETB ${additionalRequired} via Chapa.`}
                </p>
              </div>
            )}

            {/* Accepted payment methods — only when Chapa needed */}
            {!creditCoversAll && (
              <>
                <div className="flex flex-wrap gap-2 mb-5">
                  {['CBE Birr', 'Telebirr', 'Awash Bank', 'HelloCash', 'Amole'].map(m => (
                    <span key={m} className="px-3 py-1.5 rounded-lg bg-white border border-steel-grey text-xs font-semibold text-ink-black/70">
                      {m}
                    </span>
                  ))}
                </div>
                <p className="text-ink-black/40 text-xs mb-5">
                  You will be redirected to Chapa to complete your payment. Your booking is only confirmed after successful payment.
                </p>
              </>
            )}

            {payError && (
              <div className="bg-error/10 border border-error/20 rounded-xl px-4 py-3 mb-4 text-sm text-error font-semibold">
                {payError}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => { setStep(3); setPayError(null) }} className="btn-outline flex-1" disabled={booking}>← Back</button>
              <button
                onClick={() => { setPayError(null); initiateChapaPayment() }}
                disabled={booking || creditLoading}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {creditCoversAll
                  ? 'Confirm Booking →'
                  : activeCredit
                    ? `Pay ETB ${additionalRequired} →`
                    : `Pay ETB ${price} →`}
              </button>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
