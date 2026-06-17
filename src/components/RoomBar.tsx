// P3 room connection status bar. Sits between the header and the canvas area.
//
// Shows: room ID input, connection status pill, peer count.
// The user can type or paste a UUID to join a room; "New" generates a fresh
// one; "Copy link" writes a shareable URL to the clipboard.
//
// Design reference: claudedocs/design_p3_multiplayer_p2p.md §9

import React, { useCallback, useRef, useState } from 'react';
import './RoomBar.css';

interface RoomBarProps {
  roomId: string | null;
  // Accepts string (not the relay RoomStatus union) so both the relay and P2P
  // room hooks can pass their status without a shared type dependency. The
  // CSS class and label record handle any unknown status gracefully. §11.1
  status: string;
  peerCount: number;
  onChange: (roomId: string | null) => void;
}

const STATUS_LABELS: Record<string, string> = {
  // Relay statuses
  idle: 'offline',
  // P2P statuses (disconnected replaces idle)
  disconnected: 'offline',
  connecting: 'connecting…',
  reconnecting: 'reconnecting…',
  'awaiting-snapshot': '◑ receiving…',
  connected: 'live',
  error: 'error',
};

export function RoomBar({ roomId, status, peerCount, onChange }: RoomBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // "Copied!" flash state for the copy button.
  const [copied, setCopied] = useState(false);

  const handleNew = useCallback(() => {
    const id = crypto.randomUUID();
    onChange(id);
  }, [onChange]);

  const handleLeave = useCallback(() => {
    onChange(null);
  }, [onChange]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.trim();
      const UUID_V4_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (UUID_V4_RE.test(val)) {
        onChange(val);
        return;
      }
      // Also accept a full URL with ?room=<uuid> so pasting the "Copy link"
      // output directly into the input field works.
      try {
        const rid = new URL(val).searchParams.get('room');
        if (rid && UUID_V4_RE.test(rid)) { onChange(rid); return; }
      } catch { /* not a URL */ }
      if (val === '') onChange(null);
    },
    [onChange],
  );

  const handleCopy = useCallback(() => {
    if (!roomId) return;
    // App.tsx keeps window.location.href in sync with roomId (replaceState),
    // so the current href already contains ?room=<uuid> plus the hash path of
    // the current map. Copying it gives the recipient a link that lands on the
    // right map AND auto-joins the room. §11.2
    const url = window.location.href;

    const execCopy = () => {
      const el = document.createElement('textarea');
      el.value = url;
      el.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      try { document.execCommand('copy'); } catch { /* best-effort */ }
      document.body.removeChild(el);
    };

    navigator.clipboard.writeText(url).then(() => {
      execCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      execCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [roomId]);

  return (
    <div className="RoomBar" role="toolbar" aria-label="Multiplayer room">
      <span className="RoomBar-label">Room</span>
      <input
        ref={inputRef}
        className="RoomBar-input"
        type="text"
        placeholder="paste room ID to join…"
        value={roomId ?? ''}
        onChange={handleInputChange}
        // Selecting the text on focus makes it easy to paste over
        onFocus={(e) => e.currentTarget.select()}
        spellCheck={false}
        aria-label="Room ID"
      />
      {!roomId ? (
        <button className="RoomBar-btn" onClick={handleNew} title="Create a new room">
          New
        </button>
      ) : (
        <>
          <button className="RoomBar-btn" onClick={handleCopy} title="Copy shareable link">
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button className="RoomBar-btn RoomBar-btn--leave" onClick={handleLeave} title="Leave room">
            Leave
          </button>
        </>
      )}
      <span
        className={`RoomBar-status RoomBar-status--${status}`}
        aria-live="polite"
        aria-label={`Connection status: ${STATUS_LABELS[status] ?? status}`}
      >
        {STATUS_LABELS[status] ?? status}
      </span>
      {status === 'connected' && (
        <span className="RoomBar-peers" aria-label={`${peerCount} peer${peerCount !== 1 ? 's' : ''} connected`}>
          {peerCount} peer{peerCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
