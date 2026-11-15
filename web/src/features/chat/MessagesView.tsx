import { ArrowLeftIcon, ChatCircleDotsIcon, PaperPlaneRightIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/components/Button'
import { Avatar, EmptyState, Notice, PageHeader, StatusPill } from '@/components/Display'
import { CHAT_BODY_LIMIT, type ChatMessage, type Conversation } from '@/data/chat'
import { Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'
import { cn } from '@/lib/cn'
import { ChatAgreementPanel } from './ChatAgreement'
import { canDelete, threadItems, type Outgoing, type ThreadItem } from './thread'

/** Newest first, as it is loaded. */
export type Thread = { messages: ChatMessage[]; more: boolean; loadingOlder?: boolean; otherReadAt: string | null; open: boolean; consented: boolean }

export type ChatActions = {
  onSend: (body: string) => void
  onRetry: (id: string) => void
  onDiscard: (id: string) => void
  onOlder: () => void
  onDelete: (id: string) => void
}

type Props = {
  base: string
  me: string
  /** A patient reading their own messages. Staff see the same screen with their own wording. */
  self?: boolean
  conversations: Load<Conversation[]>
  selected: string | null
  /** Null until a conversation is chosen. */
  thread: Load<Thread> | null
  outgoing: readonly Outgoing[]
  /** False while the live connection is down. Messages still send; new ones appear when it returns. */
  connected: boolean
  actions: ChatActions
  /** A patient's answer to the messages agreement. Until they agree, nobody can write to them. */
  agreement?: { granted: boolean; busy: boolean; onAccept: () => void }
}

/** Beside the bell on every page. The label holds what the badge shows, so someone using voice control can say what they see. */
export function MessagesIconLink({ to, count }: { to: string; count: number }) {
  const { t } = useTranslation()
  const shown = count > 9 ? '9+' : String(count)
  return (
    <Link to={to} aria-label={count > 0 ? t('nav.messagesUnread', { count, shown }) : t('nav.messages')}
      className="relative grid size-11 shrink-0 place-items-center rounded-control text-slate transition-colors transition-quick hover:bg-mist hover:text-ink">
      <ChatCircleDotsIcon aria-hidden className="text-xl" />
      {count > 0 && <span aria-hidden className="absolute right-1 top-1 min-w-4 rounded-full bg-lagoon-deep px-1 text-center text-[0.625rem] font-bold leading-4 text-paper">{shown}</span>}
    </Link>
  )
}

function lastLine(conversation: Conversation, me: string, t: (key: string, values?: Record<string, unknown>) => string) {
  const last = conversation.lastMessage
  if (!last && !conversation.consented) return t(conversation.side === 'patient' ? 'chat.turnOnToStart' : 'chat.notTurnedOn')
  if (!last) return t('chat.noMessagesYet')
  const words = last.deleted ? t('chat.deleted') : last.kind === 'text' || last.kind === 'system' ? last.body : t('chat.unsupported')
  return last.senderId === me ? t('chat.youSaid', { words }) : words
}

function ConversationList({ conversations, selected, base, me, className }: { conversations: readonly Conversation[]; selected: string | null; base: string; me: string; className?: string }) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <nav aria-label={t('chat.conversations')} className={cn('overflow-clip rounded-card border border-line bg-paper shadow-rest', className)}>
      <ul className="divide-y divide-line">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <Link to={`${base}/messages/${conversation.id}`} aria-current={conversation.id === selected ? 'page' : undefined}
              className={cn('flex min-h-16 items-center gap-3 px-4 py-3 transition-colors transition-quick hover:bg-mist', conversation.id === selected && 'bg-tide hover:bg-tide')}>
              <Avatar name={conversation.otherName} photo={conversation.otherPhoto} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">{conversation.otherName || t('chat.unnamed')}</span>
                  {conversation.lastMessageAt && <span className="numeric shrink-0 text-xs text-slate">{format.short(conversation.lastMessageAt)}</span>}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className={cn('truncate text-sm', conversation.unread > 0 ? 'font-semibold text-ink' : 'text-slate')}>{lastLine(conversation, me, t)}</span>
                  {conversation.unread > 0 && (
                    <span className="numeric min-w-5 shrink-0 rounded-full bg-lagoon-deep px-1.5 text-center text-xs font-bold leading-5 text-paper">
                      <span aria-hidden>{conversation.unread > 99 ? '99+' : conversation.unread}</span>
                      <span className="sr-only">{t('chat.unread', { count: conversation.unread })}</span>
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Bubble({ item, actions }: { item: Extract<ThreadItem, { type: 'message' }>; actions: ChatActions }) {
  const { t } = useTranslation()
  const format = useFormat()
  const [asking, setAsking] = useState(false)
  const { message, mine } = item
  if (message.kind === 'system') return <li className="self-center px-3 text-center text-sm text-slate">{message.body}</li>
  const quiet = 'text-xs text-slate'
  const link = 'rounded-sm font-semibold text-lagoon-deep underline underline-offset-2'
  return (
    <li className={cn('flex max-w-[85%] flex-col gap-1 tablet:max-w-[70%]', mine ? 'items-end self-end' : 'items-start self-start')}>
      <p className={cn('whitespace-pre-wrap break-words rounded-card px-3.5 py-2', message.deleted ? 'border border-line italic text-slate' : item.state === 'failed' ? 'border border-dashed border-alarm bg-paper text-ink' : mine ? 'bg-lagoon-deep text-paper' : 'bg-tide text-ink')}>
        <span className="sr-only">{mine ? t('chat.fromYou') : t('chat.fromThem')} </span>
        {message.deleted ? t('chat.deleted') : message.kind === 'text' ? message.body : t('chat.unsupported')}
      </p>
      <p className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', quiet, mine && 'justify-end')}>
        {item.state === 'sending' && <span>{t('chat.sending')}</span>}
        {item.state === 'failed' && (
          <>
            <span className="flex items-center gap-1 font-semibold text-alarm"><WarningCircleIcon weight="fill" aria-hidden />{t('chat.notSent')}</span>
            <button type="button" className={link} onClick={() => actions.onRetry(message.id)}>{t('chat.retry')}</button>
            <button type="button" className={link} onClick={() => actions.onDiscard(message.id)}>{t('chat.discard')}</button>
          </>
        )}
        {item.state === 'sent' && <time dateTime={message.createdAt} className="numeric">{format.time(message.createdAt)}</time>}
        {item.seen && <span>{t('chat.seen')}</span>}
        {item.state === 'sent' && canDelete(message, message.senderId ?? '') && mine && (asking
          ? <><span>{t('chat.deleteAsk')}</span><button type="button" className={link} onClick={() => { setAsking(false); actions.onDelete(message.id) }}>{t('chat.deleteYes')}</button><button type="button" className={link} onClick={() => setAsking(false)}>{t('chat.deleteNo')}</button></>
          : <button type="button" className={link} onClick={() => setAsking(true)}>{t('chat.delete')}</button>)}
      </p>
    </li>
  )
}

function Composer({ name, onSend }: { name: string; onSend: (body: string) => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const words = draft.trim()
  const left = CHAT_BODY_LIMIT - draft.length
  const send = (event?: FormEvent) => {
    event?.preventDefault()
    if (!words) return
    onSend(words)
    setDraft('')
  }
  // Enter sends, as in every chat. Shift and Enter make a new line, and a phone's own keyboard still inserts one.
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) send(event)
  }
  return (
    <form onSubmit={send} className="flex items-end gap-2 border-t border-line p-3">
      <div className="min-w-0 flex-1">
        <label htmlFor="chat-draft" className="sr-only">{t('chat.writeTo', { name })}</label>
        <textarea id="chat-draft" rows={2} value={draft} maxLength={CHAT_BODY_LIMIT} onChange={(event) => setDraft(event.target.value)} onKeyDown={keys} placeholder={t('chat.placeholder')}
          aria-describedby="chat-draft-help" className="block max-h-40 w-full resize-none rounded-control border border-line-strong bg-paper px-3 py-2 text-ink placeholder:text-slate hover:border-lagoon" />
        <p id="chat-draft-help" className="mt-1 text-xs text-slate">{left <= 200 ? t('chat.charactersLeft', { count: left }) : t('chat.enterHint')}</p>
      </div>
      <Button type="submit" disabled={!words} leading={<PaperPlaneRightIcon aria-hidden weight="fill" />} className="mb-5">{t('chat.send')}</Button>
    </form>
  )
}

function ThreadPanel({ conversation, thread, outgoing, me, self, base, connected, actions, className }: {
  conversation: Conversation; thread: Load<Thread>; outgoing: readonly Outgoing[]; me: string; self?: boolean; base: string; connected: boolean; actions: ChatActions; className?: string
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const scroller = useRef<HTMLDivElement>(null)
  const data = thread.status === 'ready' ? thread.data : null
  const items = data ? threadItems(data.messages, outgoing.filter((item) => item.conversationId === conversation.id), me, data.otherReadAt) : []
  const newest = items.at(-1)?.key
  // A new message brings the thread to its end. Loading older ones leaves the reader where they were.
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight }, [newest])
  // Until the clock moves, a message's "Delete" would outlive its quarter of an hour.
  const [, tick] = useState(0)
  useEffect(() => { const timer = setInterval(() => tick((value) => value + 1), 30_000); return () => clearInterval(timer) }, [])
  const open = data?.open ?? conversation.open
  const consented = data?.consented ?? conversation.consented
  return (
    <section aria-label={t('chat.conversationWith', { name: conversation.otherName })} className={cn('flex h-[calc(100dvh-15rem)] min-h-96 flex-col overflow-clip rounded-card border border-line bg-paper shadow-rest', className)}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Link to={`${base}/messages`} aria-label={t('chat.back')} className="grid size-9 shrink-0 place-items-center rounded-control text-slate hover:bg-mist hover:text-ink desk:hidden"><ArrowLeftIcon aria-hidden className="text-xl" /></Link>
        <Avatar name={conversation.otherName} photo={conversation.otherPhoto} size={36} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-bold">{conversation.otherName || t('chat.unnamed')}</h2>
          <p className="text-sm text-slate">{t(conversation.side === 'patient' ? 'chat.yourTherapist' : 'chat.yourPatient')}</p>
        </div>
        <span role="status">{!connected && <StatusPill tone="caution">{t('chat.reconnecting')}</StatusPill>}</span>
      </header>
      <div ref={scroller} tabIndex={0} aria-label={t('chat.messages')} className="flex-1 overflow-y-auto px-4 py-4">
        <Loadable load={thread} skeleton={<SkeletonLines rows={4} />}>
          {(found) => (
            <>
              {found.more && <div className="mb-4 text-center"><Button size="sm" variant="secondary" busy={found.loadingOlder} onClick={actions.onOlder}>{t('chat.older')}</Button></div>}
              {items.length === 0 && <p className="py-10 text-center text-slate">{t(self ? 'chat.startSelf' : 'chat.start', { name: conversation.otherName })}</p>}
              {/* A log is announced as it grows, so a screen reader hears each new message without losing its place. */}
              <div role="log" aria-live="polite" aria-relevant="additions"><ol className="flex flex-col gap-3">
                {items.map((item) => (item.type === 'day'
                  ? <li key={item.key} className="self-center rounded-full bg-mist px-3 py-0.5 text-xs font-semibold text-slate">{format.date(item.at)}</li>
                  : <Bubble key={item.key} item={item} actions={actions} />))}
              </ol></div>
            </>
          )}
        </Loadable>
      </div>
      {open
        ? <Composer key={conversation.id} name={conversation.otherName} onSend={actions.onSend} />
        : <div className="border-t border-line p-3"><Notice tone="info">{t(consented ? 'chat.closed' : conversation.side === 'patient' ? 'chat.turnOnToWrite' : 'chat.waitingForPatient', { name: conversation.otherName })}</Notice></div>}
    </section>
  )
}

/** Every conversation a person has, beside the one that is open. On a narrow window they take turns. */
export function MessagesView({ base, me, self, conversations, selected, thread, outgoing, connected, actions, agreement }: Props) {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('nav.messages')} description={t(self ? 'chat.descriptionSelf' : 'chat.description')} />
      <Loadable load={conversations} skeleton={<SkeletonLines />}>
        {(list) => {
          if (list.length === 0) return <EmptyState title={t(self ? 'chat.emptySelfTitle' : 'chat.emptyTitle')} detail={t(self ? 'chat.emptySelfDetail' : 'chat.emptyDetail')} />
          const conversation = list.find((item) => item.id === selected)
          return (
            <>
              {agreement && !agreement.granted && <ChatAgreementPanel busy={agreement.busy} onAccept={agreement.onAccept} />}
              <div className="grid items-start gap-5 desk:grid-cols-[20rem_minmax(0,1fr)]">
                <ConversationList conversations={list} selected={selected} base={base} me={me} className={cn(conversation && 'hidden desk:block')} />
                {conversation && thread
                  ? <ThreadPanel conversation={conversation} thread={thread} outgoing={outgoing} me={me} self={self} base={base} connected={connected} actions={actions} />
                  : <div className="hidden min-h-96 place-items-center rounded-card border border-dashed border-line-strong p-8 text-center text-slate desk:grid">{t(selected ? 'chat.notFound' : 'chat.choose')}</div>}
              </div>
              <p className="mt-4 max-w-[70ch] text-sm text-slate">{t(self ? 'chat.urgentSelf' : 'chat.urgent')}</p>
            </>
          )
        }}
      </Loadable>
    </>
  )
}
