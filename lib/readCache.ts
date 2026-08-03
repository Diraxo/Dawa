// Stream's `channel.markRead()` is fire-and-forget and its effect on
// `channel.countUnread()` depends on a server round trip + websocket echo.
// If the doctor navigates from the chat screen back to the messages list
// before that round trip finishes, `countUnread()` can still report the
// pre-read count. This module-level cache (survives screen navigation since
// it's just a JS singleton, not component state) records the last message a
// channel was read through, so the messages list can deterministically show
// 0 unread for it regardless of how fast the doctor navigates back.
const readThrough = new Map<string, string>()

export function markChannelReadLocally(channelId: string, lastMessageId: string | undefined) {
  if (!channelId || !lastMessageId) return
  readThrough.set(channelId, lastMessageId)
}

export function isChannelReadThrough(channelId: string, latestMessageId: string | undefined): boolean {
  if (!channelId || !latestMessageId) return false
  return readThrough.get(channelId) === latestMessageId
}
