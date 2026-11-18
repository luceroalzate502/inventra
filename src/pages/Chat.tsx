import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { MessageSquare, Send, WifiOff } from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { markChatRead } from '../domain/chat';
import { dateLong, initials, timeShort, uid } from '../domain/format';
import { ROLES } from '../domain/types';
import type { ChatMessage } from '../domain/types';
import { Badge, Button, Card, PageHeader, cx } from '../components/ui';

const MAX_LENGTH = 2000;
const GROUP_WINDOW_MS = 5 * 60 * 1000;

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

function dayLabel(iso: string): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const key = dayKey(iso);
  if (key === dayKey(today.toISOString())) return 'Hoy';
  if (key === dayKey(yesterday.toISOString())) return 'Ayer';
  return dateLong(iso);
}

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; msg: ChatMessage; grouped: boolean };

export function Chat() {
  const { user, online, toast } = useApp();
  const messages = useLiveQuery(() => db.messages.orderBy('createdAt').toArray(), []) ?? [];
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const firstRender = useRef(true);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastDay = '';
    let previous: ChatMessage | null = null;

    for (const msg of messages) {
      const key = dayKey(msg.createdAt);
      if (key !== lastDay) {
        out.push({ kind: 'day', key: `day-${key}`, label: dayLabel(msg.createdAt) });
        lastDay = key;
        previous = null;
      }
      const grouped = Boolean(
        previous &&
          previous.authorId === msg.authorId &&
          new Date(msg.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_WINDOW_MS,
      );
      out.push({ kind: 'msg', msg, grouped });
      previous = msg;
    }

    return out;
  }, [messages]);

  const last = messages[messages.length - 1];

  /* Mantiene la vista al final cuando llega o se envía un mensaje. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (firstRender.current) {
      firstRender.current = false;
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  /* Marca la sala como leída mientras está abierta. */
  useEffect(() => {
    markChatRead(user?.id, last?.createdAt ?? new Date().toISOString());
  }, [user?.id, last?.createdAt]);

  const grow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };

  const send = async () => {
    if (!user || sending) return;
    const text = draft.trim();
    if (!text) return;
    if (text.length > MAX_LENGTH) {
      toast('Mensaje muy largo', 'warn', `Use hasta ${MAX_LENGTH} caracteres.`);
      return;
    }

    setSending(true);
    try {
      await db.messages.add({
        id: uid(),
        text,
        authorId: user.id,
        authorName: user.name,
        authorRole: user.role,
        createdAt: new Date().toISOString(),
      });
      setDraft('');
      atBottom.current = true;
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      toast(
        'No fue posible enviar',
        'error',
        err instanceof Error ? err.message : 'Intente nuevamente.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chat-page">
      <PageHeader
        title="Chat interno"
        subtitle="Sala general para coordinar entre roles"
        actions={
          <Badge tone={online ? 'ok' : 'warn'} dot>
            {online ? 'En línea' : 'Sin conexión'}
          </Badge>
        }
      />

      <Card className="chat-card">
        <div className="chat-head">
          <div className="chat-head-icon">
            <MessageSquare size={19} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="chat-head-title">Sala general</div>
            <div className="chat-head-sub">
              Todos los roles · {messages.length} {messages.length === 1 ? 'mensaje' : 'mensajes'}
            </div>
          </div>
          {!online && (
            <span className="chat-offline">
              <WifiOff size={13} /> Se enviará al recuperar la conexión
            </span>
          )}
        </div>

        <div
          className="chat-scroll"
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          {messages.length === 0 ? (
            <div className="chat-empty">
              <div className="empty-icon">
                <MessageSquare size={22} />
              </div>
              <h4>Aún no hay mensajes</h4>
              <p>Escriba el primero para coordinar con las demás áreas.</p>
            </div>
          ) : (
            rows.map((row) => {
              if (row.kind === 'day') {
                return (
                  <div className="chat-day" key={row.key}>
                    <span>{row.label}</span>
                  </div>
                );
              }

              const { msg, grouped } = row;
              const mine = msg.authorId === user?.id;

              return (
                <div
                  className={cx('chat-row', mine && 'mine', grouped && 'grouped')}
                  key={msg.id}
                >
                  {!mine &&
                    (grouped ? (
                      <div className="chat-avatar ghost" aria-hidden="true" />
                    ) : (
                      <div className="chat-avatar" title={msg.authorName}>
                        {initials(msg.authorName)}
                      </div>
                    ))}

                  <div className="chat-body">
                    {!grouped && (
                      <div className="chat-meta">
                        <span className="chat-author">{mine ? 'Usted' : msg.authorName}</span>
                        <span className={cx('chat-role', `role-${msg.authorRole}`)}>
                          {ROLES[msg.authorRole]?.short ?? msg.authorRole}
                        </span>
                        <span className="chat-time">{timeShort(msg.createdAt)}</span>
                      </div>
                    )}
                    <div className="chat-bubble">{msg.text}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="chat-composer">
          <textarea
            ref={textareaRef}
            className="textarea chat-input"
            rows={1}
            value={draft}
            maxLength={MAX_LENGTH}
            placeholder="Escriba un mensaje…"
            aria-label="Mensaje para la sala general"
            onChange={(e) => {
              setDraft(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          ></textarea>
          <Button
            variant="primary"
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            icon={<Send size={16} />}
            aria-label="Enviar mensaje"
          >
            Enviar
          </Button>
        </div>
        <div className="chat-hint">
          <span>Enter envía · Shift + Enter hace un salto de línea</span>
          <span className={cx(draft.length > MAX_LENGTH - 200 && 'near-limit')}>
            {draft.length}/{MAX_LENGTH}
          </span>
        </div>
      </Card>
    </div>
  );
}
