// Restricts the mobile long-press message menu to the same four actions the
// website exposes (Reply, Copy, Delete for me, Report) instead of Stream
// Chat React Native's full default action set (Pin, Mark Unread, Mute,
// Block, Ban, reactions, etc.) — those are moderation/admin actions that
// don't belong in a doctor↔patient consultation thread. Pass this to the
// `messageActions` prop on stream-chat-expo's <Channel>.
//
// `onReport` reuses this app's own conversation-level report modal (backed
// by the `consultation_reports` table) instead of Stream's built-in
// flagMessage API — matching the website, whose per-message "Report" button
// also just opens that same modal rather than flagging via Stream.
export function restrictedMessageActions(params: any, onReport: () => void) {
  const { quotedReply, copyMessage, deleteForMeMessage, flagMessage, message } = params
  const actions = [] as any[]

  if (quotedReply) actions.push(quotedReply)
  if (copyMessage && message?.text) actions.push({ ...copyMessage, title: 'Copy' })
  if (deleteForMeMessage) actions.push({ ...deleteForMeMessage, title: 'Delete for me' })
  if (flagMessage) actions.push({ ...flagMessage, title: 'Report', action: onReport })

  return actions
}
