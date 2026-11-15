import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useParams, useSearchParams } from 'react-router'
import { useSignedIn } from '@/auth/AuthProvider'
import { toast } from '@/components/Toast'
import {
  cancelScheduled, deleteMessage, loadChatConsent, loadConversations, loadScheduled, mediaLink, scheduleMessage, sendMedia, setChatConsent, setConversationMuted, loadMessages, markConversationRead, mergeMessage, sendMessage, subscribeToChat,
  type ChatMessage, type Conversation, type MessagePage,
} from '@/data/chat'
import { supabase } from '@/data/client'
import { failureKey } from '@/data/errors'
import { asLoad, ready, type Load } from '@/features/shared'
import { MediaError, prepareVideo, preparePhoto } from './media'
import { MessagesIconLink, MessagesView, type Preparing, type Thread } from './MessagesView'
import type { Outgoing } from './thread'

/** The live connection carries news as it happens. This is only the safety net for a connection that died without saying so. */
const CHECK_EVERY = 60_000

type Before = Pick<ChatMessage, 'id' | 'createdAt'> | null
type Pages = InfiniteData<MessagePage, Before>
const threadKey = (conversationId: string) => ['chat', 'messages', conversationId] as const
const LIST_KEY = ['chat', 'conversations'] as const

/**
 * Whether new messages can arrive, shared by every screen that shows it. One connection serves the whole workspace.
 * It takes both: the server saying rows are flowing, and the browser saying it has a network at all. A socket can stay
 * silent for most of a minute after the network goes, and the browser knows at once.
 */
let flowing = false
let online = typeof navigator === 'undefined' || navigator.onLine
const watchers = new Set<() => void>()
const isLive = () => flowing && online
function setLive(change: { flowing?: boolean; online?: boolean }) {
  const before = isLive()
  flowing = change.flowing ?? flowing
  online = change.online ?? online
  if (before !== isLive()) watchers.forEach((notify) => notify())
}
const useLive = () => useSyncExternalStore((notify) => { watchers.add(notify); return () => { watchers.delete(notify) } }, isLive)

/** Puts a live or just-sent message where it belongs in what is already loaded: over its earlier copy, or at the newest end. */
function place(client: QueryClient, message: ChatMessage) {
  client.setQueryData<Pages>(threadKey(message.conversationId), (loaded) => {
    if (!loaded?.pages[0]) return loaded
    const held = loaded.pages.some((page) => page.messages.some((item) => item.id === message.id))
    return {
      ...loaded,
      pages: loaded.pages.map((page, index) => (held
        ? { ...page, messages: page.messages.map((item) => (item.id === message.id ? message : item)) }
        : index === 0 ? { ...page, messages: mergeMessage(page.messages, message) } : page)),
    }
  })
}

/** Mounted once for a workspace: keeps every loaded conversation current, and catches up after the connection drops. */
export function useChatLive() {
  const client = useQueryClient()
  const { userId } = useSignedIn()
  useEffect(() => {
    // Whatever was said while the connection was down never arrived, so everything loaded is read again.
    const catchUp = () => void client.invalidateQueries({ queryKey: ['chat'] })
    const close = subscribeToChat(supabase(), {
      onMessage: (message) => {
        place(client, message)
        void client.invalidateQueries({ queryKey: LIST_KEY })
      },
      onRead: (mark) => {
        if (mark.userId === userId) return void client.invalidateQueries({ queryKey: LIST_KEY })
        client.setQueryData<Pages>(threadKey(mark.conversationId), (loaded) => loaded && { ...loaded, pages: loaded.pages.map((page) => ({ ...page, otherReadAt: mark.readAt })) })
      },
      onConnection: (connected) => {
        setLive({ flowing: connected })
        if (connected) catchUp()
      },
    })
    const lost = () => setLive({ online: false })
    const back = () => { setLive({ online: true }); catchUp() }
    // A phone that slept, or a tab left in the background, may have missed anything.
    const shown = () => { if (document.visibilityState === 'visible') catchUp() }
    window.addEventListener('offline', lost)
    window.addEventListener('online', back)
    document.addEventListener('visibilitychange', shown)
    return () => {
      close()
      setLive({ flowing: false })
      window.removeEventListener('offline', lost)
      window.removeEventListener('online', back)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [client, userId])
}

const useConversations = () => useQuery({ queryKey: LIST_KEY, queryFn: () => loadConversations(supabase()), refetchInterval: CHECK_EVERY })

/** Beside the bell, on every page of a workspace that has messages. It also holds the live connection open. */
export function MessagesLink({ base }: { base: string }) {
  useChatLive()
  const count = (useConversations().data ?? []).reduce((total, conversation) => total + conversation.unread, 0)
  return <MessagesIconLink to={`${base}/messages`} count={count} />
}

function useThread(conversation: Conversation | undefined) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const { userId } = useSignedIn()
  const id = conversation?.id ?? ''
  const [outgoing, setOutgoing] = useState<Outgoing[]>([])
  const [preparing, setPreparing] = useState<Preparing | null>(null)
  // Only a therapist schedules, and only they see what is waiting.
  const waiting = useQuery({ queryKey: ['chat', 'scheduled', id], enabled: Boolean(id) && conversation?.side === 'therapist', queryFn: () => loadScheduled(supabase(), id) })
  const pages = useInfiniteQuery({
    queryKey: threadKey(id), enabled: Boolean(id), initialPageParam: null as Before,
    queryFn: ({ pageParam }) => loadMessages(supabase(), id, pageParam),
    getNextPageParam: (page) => (page.more ? page.messages.at(-1) ?? null : undefined),
  })
  const first = pages.data?.pages[0]
  const messages = pages.data?.pages.flatMap((page) => page.messages)
  const thread: Load<Thread> | null = !id ? null : messages && first
    ? ready({ messages, more: pages.hasNextPage, loadingOlder: pages.isFetchingNextPage, otherReadAt: first.otherReadAt, open: first.open, consented: first.consented, media: first.media })
    : pages.isError ? { status: 'error', retry: () => void pages.refetch() } : { status: 'loading' }

  // Reading is told to the server once for each new message from the other person, and only while the page is in front of the reader.
  const newestTheirs = messages?.find((message) => message.senderId !== userId)?.id
  useEffect(() => {
    if (!id || !newestTheirs || document.visibilityState !== 'visible') return
    void markConversationRead(supabase(), id).then(() => client.invalidateQueries({ queryKey: LIST_KEY })).catch(() => undefined)
  }, [client, id, newestTheirs])

  const deliver = useCallback(async (item: Outgoing) => {
    try {
      const stored = item.media ? await sendMedia(supabase(), item.id, item.conversationId, item.media, item.body) : await sendMessage(supabase(), item.id, item.conversationId, item.body)
      place(client, stored)
      setOutgoing((waiting) => waiting.filter((other) => other.id !== item.id))
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      void client.invalidateQueries({ queryKey: LIST_KEY })
    } catch (failure) {
      setOutgoing((waiting) => waiting.map((other) => (other.id === item.id ? { ...other, failed: true } : other)))
      toast.show(t(failureKey(failure)), 'error')
      // The server may have closed the conversation, which the next read will show.
      void client.invalidateQueries({ queryKey: ['chat'] })
    }
  }, [client, t])

  return {
    thread, outgoing, preparing, scheduled: waiting.data ?? [],
    actions: {
      onSchedule: async (body: string, sendAt: string) => {
        if (!id) return
        try {
          await scheduleMessage(supabase(), crypto.randomUUID(), id, body, sendAt)
          toast.show(t('chat.schedule.done'))
          await waiting.refetch()
        } catch (failure) {
          toast.show(t(failureKey(failure)), 'error')
          throw failure
        }
      },
      onCancelScheduled: (scheduledId: string) => void cancelScheduled(supabase(), scheduledId)
        .then(() => { toast.show(t('chat.schedule.removed')); return waiting.refetch() })
        .catch((failure: unknown) => { toast.show(t(failureKey(failure)), 'error'); void waiting.refetch() }),
      // Made smaller here first, then sent like any message: it waits in the thread, and a failure can be tried again.
      onAttach: (file: File) => {
        if (!id || preparing) return
        const kind = file.type.startsWith('video/') ? 'video' : 'image'
        setPreparing({ kind, share: 0 })
        const made = kind === 'video' ? prepareVideo(file, (share) => setPreparing({ kind, share })) : preparePhoto(file)
        void made.then((media) => {
          const item: Outgoing = { id: crypto.randomUUID(), conversationId: id, body: '', createdAt: new Date().toISOString(), failed: false, media, previewUrl: URL.createObjectURL(media.preview) }
          setOutgoing((waiting) => [...waiting, item])
          void deliver(item)
        }).catch((failure: unknown) => {
          toast.show(t(failureKey(failure instanceof MediaError ? { message: failure.message } : failure)), 'error')
        }).finally(() => setPreparing(null))
      },
      onLink: (path: string) => mediaLink(supabase(), path),
      onMute: (muted: boolean) => {
        if (!id) return
        void setConversationMuted(supabase(), id, muted)
          .then(() => { toast.show(t(muted ? 'chat.mutedToast' : 'chat.unmutedToast')); return client.invalidateQueries({ queryKey: LIST_KEY }) })
          .catch((failure: unknown) => toast.show(t(failureKey(failure)), 'error'))
      },
      onSend: (body: string) => {
        if (!id) return
        const item: Outgoing = { id: crypto.randomUUID(), conversationId: id, body, createdAt: new Date().toISOString(), failed: false }
        setOutgoing((waiting) => [...waiting, item])
        void deliver(item)
      },
      // The same ID goes again, so a message that did arrive the first time is not sent twice.
      onRetry: (messageId: string) => {
        const item = outgoing.find((other) => other.id === messageId)
        if (!item) return
        setOutgoing((waiting) => waiting.map((other) => (other.id === messageId ? { ...other, failed: false } : other)))
        void deliver({ ...item, failed: false })
      },
      onDiscard: (messageId: string) => setOutgoing((waiting) => waiting.filter((other) => {
        if (other.id === messageId && other.previewUrl) URL.revokeObjectURL(other.previewUrl)
        return other.id !== messageId
      })),
      onOlder: () => void pages.fetchNextPage().then((result) => { if (result.isError) toast.show(t(failureKey(result.error)), 'error') }),
      onDelete: (messageId: string) => void deleteMessage(supabase(), messageId)
        .then((stored) => { place(client, stored); void client.invalidateQueries({ queryKey: LIST_KEY }) })
        .catch((failure: unknown) => toast.show(t(failureKey(failure)), 'error')),
    },
  }
}

/** A patient's answer to the messages agreement, and the way to change it. Everything chat shows is read again after a change. */
export function useChatAgreement(enabled: boolean) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const consent = useQuery({ queryKey: ['chat', 'consent'], enabled, queryFn: () => loadChatConsent(supabase()) })
  const [busy, setBusy] = useState(false)
  const change = async (granted: boolean) => {
    setBusy(true)
    try {
      await setChatConsent(supabase(), granted)
      toast.show(t(granted ? 'chat.agreement.turnedOn' : 'chat.agreement.turnedOff'))
      await client.invalidateQueries({ queryKey: ['chat'] })
    } catch (failure) {
      toast.show(t(failureKey(failure)), 'error')
    } finally {
      setBusy(false)
    }
  }
  return { consent: consent.data, load: consent, busy, change }
}

/** Messages for a patient or a therapist. `?with=` opens the conversation with one person, for links from their record. */
export function MessagesPage({ base, self }: { base: string; self?: boolean }) {
  const { userId } = useSignedIn()
  const { id } = useParams()
  const [params] = useSearchParams()
  const connected = useLive()
  const conversations = useConversations()
  const list = conversations.data
  const selected = list?.find((conversation) => conversation.id === id)
  const { thread, outgoing, preparing, scheduled, actions } = useThread(selected)
  const agreement = useChatAgreement(Boolean(self))
  const wanted = params.get('with')
  if (!id && list) {
    const target = wanted ? list.find((conversation) => conversation.otherId === wanted) : self && list.length === 1 ? list[0] : undefined
    if (target) return <Navigate to={`${base}/messages/${target.id}`} replace />
  }
  return <MessagesView base={base} me={userId} self={self} conversations={asLoad(conversations)} selected={id ?? null} thread={thread} outgoing={outgoing} connected={connected} actions={actions}
    preparing={preparing} scheduled={scheduled} agreement={agreement.consent ? { granted: agreement.consent.granted, media: agreement.consent.media, busy: agreement.busy, onAccept: () => void agreement.change(true) } : undefined} />
}
