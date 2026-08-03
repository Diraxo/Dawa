import { Alert, Linking } from 'react-native'

export const SUPPORT_WHATSAPP_NUMBER = '251777012633'
export const SUPPORT_EMAIL = 'dawasupport@gmail.com'

// Opens the native WhatsApp app when installed, falling back to wa.me
// (WhatsApp Web / app-store prompt) when it isn't.
export async function openWhatsAppSupport() {
  const appUrl = `whatsapp://send?phone=${SUPPORT_WHATSAPP_NUMBER}`
  const webUrl = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`

  try {
    const canOpenApp = await Linking.canOpenURL(appUrl)
    await Linking.openURL(canOpenApp ? appUrl : webUrl)
  } catch {
    await Linking.openURL(webUrl)
  }
}

// mailto: can reject (e.g. no mail client configured, common on
// simulators) which otherwise surfaces as an uncaught promise rejection.
export async function openSupportEmail(subject?: string) {
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : ''
  try {
    await Linking.openURL(`mailto:${SUPPORT_EMAIL}${query}`)
  } catch {
    Alert.alert('No Email App Found', `Please reach us directly at ${SUPPORT_EMAIL}`)
  }
}
