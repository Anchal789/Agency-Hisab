import { create } from 'zustand'

export type AppNotification = {
  id: string
  title: string
  body: string
}

type NotificationState = {
  items: AppNotification[]
  push: (item: AppNotification) => void
  dismiss: (id: string) => void
}

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  push: (item) => set((state) => ({ items: [item, ...state.items].slice(0, 20) })),
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}))
