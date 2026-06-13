'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { getAuthClient, supabase } from '@/lib/supabase'
import Link from 'next/link'

interface DoctorProfile {
  id: string
  specialty: string
  chat_price: number
  phone_price: number
  video_price: number
  hospital_name: string
  user: { full_name: string } | null
}

type ConsultType = 'chat' | 'phone' | 'video'
type Step = 1 | 2 | 3 | 4 | 5

const TYPE_META: Record<ConsultType, { icon: string; label: string; priceKey: keyof DoctorProfile }> = {
  chat:  { icon: '💬', label: 'Chat Consultation',  priceKey: 'chat_price' },
  phone: { icon: '📞', label: 'Phone Call',          priceKey: 'phone_price' },
  video: { icon: '🎥', label: 'Video Call',          priceKey: 'video_price' },
}

const PLATFORM_FEE_PERCENT = 0.2

const TIME_SLOTS = ['09:00 AM', '10:00 AM', '11:00 AM', '02:00 PM', '03:00 PM', '04:00 PM']

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
  const [consultationId, setConsultationId] = useState<string | null>(null)
  const days = getNextDays(7)

  useEffect(() => {
    supabase
      .from('doctor_profiles')
      .select('id, specialty, hospital_name, chat_price, phone_price, video_price, user:users(full_name)')
      .eq('id', doctorId)
      .single()
      .then(({ data }) => {
        setDoctor(data as unknown as DoctorProfile)
        setLoading(false)
      })
  }, [doctorId])

  async function confirmBooking() {
    setBooking(true)
    const token = await getToken()
    if (!token || !user) { setBooking(false); return }

    const client = getAuthClient(token)
    const { data: userData } = await client.from('users').select('id').eq('clerk_id', user.id).single()
    if (!userData) { setBooking(false); return }

    const price = doctor ? (doctor[TYPE_META[selectedType].priceKey] as number) : 0
    const platformFee = Math.round(price * PLATFORM_FEE_PERCENT)
    const doctorAmount = price - platformFee

    const scheduledAt = scheduleMode === 'now'
      ? new Date().toISOString()
      : parseScheduledAt(days[selectedDay].value, selectedTime)

    const { data: consultation, error } = await client.from('consultations').insert({
      patient_id: userData.id,
      doctor_id: doctorId,
      type: selectedType,
      status: 'pending',
      scheduled_at: scheduledAt,
      patient_amount: price,
      doctor_amount: doctorAmount,
      platform_amount: platformFee,
      payment_status: 'pending',
    }).select('id').single()

    if (error || !consultation) { setBooking(false); return }

    setConsultationId(consultation.id)
    setStep(5)
    setBooking(false)
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

  const STEPS = ['Type', 'Timing', 'Review', 'Payment', 'Confirmed']

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Back */}
      <Link href={`/patient/doctors/${doctorId}`} className="inline-flex items-center gap-2 text-ink-black/50 hover:text-ink-black text-sm mb-6 transition-colors">
        ← Back to Profile
      </Link>

      <h1 className="font-montserrat font-black text-2xl text-ink-black mb-1">Book Consultation</h1>
      <p className="text-ink-black/50 text-sm mb-6">with Dr. {doctor.user?.full_name} · {doctor.specialty}</p>

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
              <div className="flex flex-wrap gap-2">
                {TIME_SLOTS.map(slot => (
                  <button
                    key={slot}
                    onClick={() => setSelectedTime(slot)}
                    className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                      selectedTime === slot ? 'bg-care-blue text-white' : 'bg-white text-ink-black/60 border border-steel-grey'
                    }`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
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
              <span className="font-semibold text-ink-black">Dr. {doctor.user?.full_name}</span>
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

      {/* Step 4 — Payment placeholder */}
      {step === 4 && (
        <div className="card p-6 text-center">
          <div className="text-5xl mb-4">💳</div>
          <h2 className="font-montserrat font-black text-xl text-ink-black mb-2">Payment</h2>
          <p className="text-ink-black/50 text-sm mb-2">
            Total: <span className="font-bold text-ink-black">ETB {price}</span>
          </p>
          <div className="bg-info/10 border border-info/20 rounded-2xl px-4 py-3 mb-6 text-info text-sm font-semibold">
            💡 Payment integration coming soon. Confirm to proceed for free.
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(3)} className="btn-outline flex-1">← Back</button>
            <button
              onClick={confirmBooking}
              disabled={booking}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {booking ? 'Booking…' : 'Confirm Booking →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 5 — Confirmation */}
      {step === 5 && (
        <div className="card p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center text-3xl mx-auto mb-4">
            ✅
          </div>
          <h2 className="font-montserrat font-black text-2xl text-ink-black mb-2">Booking Confirmed!</h2>
          <p className="text-ink-black/60 text-sm mb-1">
            Your {TYPE_META[selectedType].label.toLowerCase()} with Dr. {doctor.user?.full_name} has been requested.
          </p>
          <p className="text-ink-black/40 text-xs mb-8">
            The doctor has 30 seconds to accept. You&apos;ll be notified immediately.
          </p>
          <div className="flex flex-col gap-3">
            {consultationId && (
              <Link href={`/patient/waiting/${consultationId}`} className="btn-primary w-full">
                Go to Waiting Room →
              </Link>
            )}
            <Link href="/patient/appointments" className="btn-outline w-full">
              View My Appointments
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
