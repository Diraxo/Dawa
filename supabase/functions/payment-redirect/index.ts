// Mobile payment redirect — Chapa calls this as return_url after checkout.
// Chapa strips all custom query params it didn't add, so we cannot rely on
// any param we embed in return_url. We just forward Chapa's own params
// (status, tx_ref) to the app's fixed deep-link scheme.
// No auth required — Chapa's browser makes this request without tokens.

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)

  // Chapa appends these to the return_url
  const chapaStatus = url.searchParams.get('status') ?? 'unknown'
  const txRef       = url.searchParams.get('tx_ref') ?? ''
  const trxRef      = url.searchParams.get('trx_ref') ?? ''

  const fwd = new URLSearchParams()
  fwd.set('status', chapaStatus)
  if (txRef)  fwd.set('tx_ref', txRef)
  if (trxRef) fwd.set('trx_ref', trxRef)

  // Always redirect to the app's registered URL scheme.
  // ASWebAuthenticationSession / Custom Tabs will intercept this and close
  // the in-app browser, resolving openAuthSessionAsync with type:'success'.
  // carehub://payment-return maps to app/(patient)/payment-return.tsx in
  // Expo Router (route groups are transparent in URL paths).
  const deepLink = `carehub://payment-return?${fwd.toString()}`

  return new Response(null, {
    status: 302,
    headers: { 'Location': deepLink },
  })
})
