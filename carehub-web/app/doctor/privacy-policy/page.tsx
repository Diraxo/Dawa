'use client'

const SECTIONS = [
  {
    title: 'Information We Collect',
    body: 'We collect professional information you provide during registration (name, medical license, specialty, years of experience, hospital affiliation, profile photo, and supporting documents). We also collect usage data such as consultation records, ratings received, and platform activity.',
  },
  {
    title: 'How We Use Your Information',
    body: 'Your information is used to verify your credentials, create your doctor profile visible to patients, match you with patient consultation requests, process earnings, and improve our platform. We do not sell your personal or professional data to third parties.',
  },
  {
    title: 'Document Verification',
    body: 'Medical license documents and identity documents you upload are stored securely and reviewed only by Dawa administrators for the purpose of verifying your credentials. Approved documents are not shared with patients.',
  },
  {
    title: 'Patient Data Access',
    body: 'During consultations, you will have access to patient-provided information necessary to deliver care. This data must be handled with strict confidentiality in accordance with applicable medical privacy laws and professional ethics.',
  },
  {
    title: 'Consultation Records',
    body: 'Records of your consultations (type, duration, diagnoses, prescriptions) are stored and may be accessed by both you and the patient. These records are retained for medical record-keeping purposes.',
  },
  {
    title: 'Earnings & Payments',
    body: 'Payment and earnings data is processed and stored securely. Your bank details provided for withdrawals are encrypted and used solely for processing your earnings.',
  },
  {
    title: 'Data Security',
    body: 'We use industry-standard encryption (TLS in transit, AES at rest) and access controls to protect your data. Only authorized Dawa staff can access sensitive records, and only for legitimate operational purposes.',
  },
  {
    title: 'Third-Party Services',
    body: 'We use Clerk (authentication), Supabase (database and file storage), Agora (voice/video calls), Stream (chat messaging), Firebase (push notifications), and Chapa (processing patients’ consultation payments — we never see or store patient card details). Each provider only receives the data needed to deliver its service, and none may sell your data.',
  },
  {
    title: 'Your Rights',
    body: 'You may request access to, correction of, or deletion of your personal data by contacting support@dawa.app. Account deletion will remove your profile from patient discovery; consultation records may be retained for legal compliance.',
  },
  {
    title: 'Contact Us',
    body: 'For privacy-related questions or concerns, contact our Data Protection team at privacy@dawa.app or write to us at Dawa Health Technologies, Addis Ababa, Ethiopia.',
  },
]

export default function DoctorPrivacyPolicyPage() {
  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Privacy Policy</h1>
        <p className="text-ink-black/50 text-sm mt-1">Last updated: June 2026 · For Healthcare Professionals</p>
      </div>

      <div
        className="rounded-3xl p-6 mb-8"
        style={{ background: 'linear-gradient(to right, #1A4598, #00BFA5)' }}
      >
        <p className="text-white font-montserrat text-sm leading-relaxed opacity-90">
          This Privacy Policy describes how Dawa Health Technologies collects, uses, and protects the personal and professional information of registered healthcare professionals on the Dawa platform.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {SECTIONS.map((s, i) => (
          <div key={i} className="card p-6">
            <div className="flex items-start gap-4">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-montserrat font-black text-sm flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #1A4598, #00BFA5)' }}
              >
                {i + 1}
              </div>
              <div>
                <h2 className="font-montserrat font-bold text-base text-ink-black mb-2">{s.title}</h2>
                <p className="text-ink-black/60 text-sm leading-relaxed">{s.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 card p-5 text-center">
        <p className="text-xs text-ink-black/40 leading-relaxed">
          By using the Dawa platform as a healthcare professional, you agree to this Privacy Policy.
          For questions, contact{' '}
          <a href="mailto:privacy@dawa.app" className="text-teal-green underline">
            privacy@dawa.app
          </a>
        </p>
      </div>
    </div>
  )
}
