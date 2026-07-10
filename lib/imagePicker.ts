import { Platform } from 'react-native'

// On Android, RN's <Modal> keeps its native Dialog window alive for its
// slide/fade-out animation after `visible` flips to false. Launching
// expo-image-picker (which needs the host Activity's focus for its result
// callback) while that window is still tearing down makes the picker
// silently no-op or lose its result. Waiting a beat after closing the modal
// avoids the race. iOS doesn't exhibit this, so it's a no-op there.
export async function waitForModalDismiss(): Promise<void> {
  if (Platform.OS === 'android') {
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}
