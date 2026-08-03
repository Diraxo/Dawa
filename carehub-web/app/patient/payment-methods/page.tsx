export default function PaymentMethodsPage() {
  const HOW_IT_WORKS = [
    { icon: '🛡️', title: 'Secure Checkout via Chapa', sub: 'Payments are processed at booking time using Chapa, Ethiopia\'s trusted payment gateway.' },
    { icon: '💳', title: 'Accepted Methods', sub: 'Telebirr, CBE Birr, Amole, HelloCash, and major debit/credit cards via Chapa.' },
    { icon: '🧾', title: 'Automatic Receipts', sub: 'A receipt is sent to your email automatically after each successful payment.' },
    { icon: '🔒', title: 'Bank-grade Security', sub: 'Your payment details are never stored on our servers. All transactions are encrypted end-to-end.' },
  ]

  return (
    <div className="p-8 max-w-xl">
      <div className="mb-8">
        <h1 className="font-montserrat font-black text-3xl text-ink-black">Payment Methods</h1>
        <p className="text-ink-black/50 text-sm mt-1">How payments work on Dawa</p>
      </div>

      {/* Hero card */}
      <div
        className="rounded-3xl p-8 mb-8 text-white flex flex-col items-center text-center"
        style={{ background: 'linear-gradient(135deg, #1A4598, #00BFA5)' }}
      >
        <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center mb-4 text-4xl">
          💳
        </div>
        <p className="font-montserrat font-black text-2xl mb-3">Secure Payments via Chapa</p>
        <p className="text-white/75 text-sm leading-relaxed mb-5 max-w-xs">
          Payments are processed securely at booking time. No card details are ever stored on our servers.
        </p>
        <span className="flex items-center gap-2 bg-white/20 px-4 py-2 rounded-full text-sm font-semibold">
          🔒 Bank-grade Security
        </span>
      </div>

      {/* How it works */}
      <div className="flex flex-col gap-3">
        {HOW_IT_WORKS.map(m => (
          <div
            key={m.title}
            className="card p-4 flex items-center gap-4"
          >
            <div className="w-11 h-11 rounded-2xl bg-teal-green/10 flex items-center justify-center text-2xl flex-shrink-0">
              {m.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-montserrat font-semibold text-sm text-ink-black">{m.title}</p>
              <p className="text-ink-black/50 text-xs">{m.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
