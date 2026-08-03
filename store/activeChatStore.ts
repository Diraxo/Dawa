import { create } from 'zustand'

interface ActiveChatState {
  // The Stream channel id of whichever chat-consultation screen is currently
  // mounted and focused, or null if the user isn't inside any chat. Read by
  // app/_layout.tsx's message.new listener to decide whether a new message
  // should show a push/local notification (user is elsewhere) or just update
  // live in place (user is already looking at that exact conversation).
  // Deliberately not persisted — this only ever describes the live session.
  activeChannelId: string | null
  setActiveChannelId: (id: string | null) => void
}

export const useActiveChatStore = create<ActiveChatState>()((set) => ({
  activeChannelId: null,
  setActiveChannelId: (id) => set({ activeChannelId: id }),
}))
