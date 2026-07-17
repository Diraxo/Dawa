// RN's <Modal> keeps its native window alive for its dismiss animation after
// `visible` flips to false — on Android that's the Dialog window's
// slide/fade-out, on iOS it's UIKit's own modal-dismiss transition
// (~300-400ms). Launching expo-image-picker while that dismiss is still in
// flight races the OS: Android silently drops/loses the picker's result,
// and iOS's `presentViewController` call is silently no-op'd (only a native
// console warning, never a JS error) because UIKit refuses to present while
// another presentation transaction is in progress. Waiting a beat after
// closing the modal avoids the race on both platforms.
export async function waitForModalDismiss(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400))
}
