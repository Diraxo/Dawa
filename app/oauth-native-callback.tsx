import * as WebBrowser from 'expo-web-browser'

// Required: closes the in-app browser and signals startSSOFlow to resolve
WebBrowser.maybeCompleteAuthSession()

export default function OAuthNativeCallback() {
  return null
}
