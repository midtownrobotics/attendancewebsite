import { useEffect, useState } from 'react';
import { type PageType } from '../utils/token';
import './SelectPage.css';

interface Props {
  action: PageType;
  w: string;
}

type Status =
  | { kind: 'loading-names' }
  | { kind: 'ready'; names: string[] }
  | { kind: 'submitting'; name: string }
  | { kind: 'success'; name: string; action: PageType; durationMs?: number; totalHours?: number } | { kind: 'error'; message: string };

const API = (import.meta.env.VITE_API_URL as string) || '/api';

function tokenWellFormed(w: string): boolean {
  return /^\d+$/.test(w) && Number.isSafeInteger(Number(w));
}

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor((ms % 60_000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function SelectPage({ action, w }: Props) {
  const isSignIn = action === 'signin';
  const [status, setStatus] = useState<Status>({ kind: 'loading-names' });
  const [grant, setGrant] = useState<string | null>(null);

  // Only check the token's shape here. Expiration must be decided by the API's
  // clock; using the visitor's phone clock causes valid scans to be rejected on
  // devices whose clocks are even slightly out of sync.
  useEffect(() => {
    if (!tokenWellFormed(w)) {
      setStatus({ kind: 'error', message: 'QR CODE EXPIRED\nASK FOR A FRESH SCAN' });
      return;
    }
    fetch(`${API}/members?action=${action}&w=${encodeURIComponent(w)}`)
      .then(async r => {
        const data = await r.json() as { names?: string[]; grant?: string; error?: string };
        if (!r.ok || !data.names || !data.grant) throw new Error(data.error ?? 'LOAD_FAILED');
        return data as { names: string[]; grant: string };
      })
      .then(data => {
        setGrant(data.grant);
        setStatus({ kind: 'ready', names: data.names });
      })
      .catch((error: unknown) => setStatus({
        kind: 'error',
        message: error instanceof Error && error.message === 'TOKEN_EXPIRED'
          ? 'QR CODE EXPIRED\nASK FOR A FRESH SCAN'
          : 'CONNECTION ERROR\nTRY AGAIN',
      }));
  }, [action, w]);

  async function handleSelect(name: string) {
    if (!grant) {
      setStatus({ kind: 'error', message: 'QR CODE EXPIRED\nASK FOR A FRESH SCAN' });
      return;
    }
    setStatus({ kind: 'submitting', name });
    try {
      const res = await fetch(`${API}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, grant }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; durationMs?: number; totalHours?: number }; if (!res.ok || data.error) {
        const msg =
          data.error === 'ALREADY_SIGNED_IN' ? 'ALREADY SIGNED IN' :
            data.error === 'NOT_SIGNED_IN' ? 'NOT SIGNED IN\nSIGN IN FIRST' :
              data.error === 'TOKEN_EXPIRED' ? 'QR CODE EXPIRED\nASK FOR A FRESH SCAN' :
                (data.error ?? 'SOMETHING WENT WRONG');
        setStatus({ kind: 'error', message: msg });
      } else {
        setStatus({ kind: 'success', name, action, durationMs: data.durationMs, totalHours: data.totalHours });
      }
    } catch {
      setStatus({ kind: 'error', message: 'CONNECTION ERROR\nTRY AGAIN' });
    }
  }

  const variant = isSignIn ? 'signin' : 'signout';

  return (
    <div className={`select select--${variant}`}>
      <div className="scanlines" aria-hidden="true" />

      <div className="select__inner">

        {/* ── Loading names ── */}
        {status.kind === 'loading-names' && (
          <div className="select__state">
            <div className="select__spinner" />
            <p className="select__state-text">LOADING…</p>
          </div>
        )}

        {/* ── Name grid ── */}
        {status.kind === 'ready' && (
          <>
            <h1 className="select__title">
              {isSignIn ? 'SIGN IN' : 'SIGN OUT'}
            </h1>
            <p className="select__subtitle">SELECT YOUR NAME</p>
            <div className="select__grid">
              {status.names.map(name => (
                <button
                  key={name}
                  className="select__name-btn"
                  onClick={() => handleSelect(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── Submitting ── */}
        {status.kind === 'submitting' && (
          <div className="select__state">
            <div className="select__spinner" />
            <p className="select__state-text">{status.name}</p>
          </div>
        )}

        {/* ── Success ── */}
        {status.kind === 'success' && (
          <div className="select__state select__state--success">
            <div className="select__check">✓</div>
            <p className="select__state-name">{status.name}</p>
            <p className="select__state-action">
              {status.action === 'signin' ? 'SIGNED IN' : 'SIGNED OUT'}
            </p>
            {status.durationMs != null && (
              <p className="select__state-duration">
                SESSION — {formatDuration(status.durationMs)}
              </p>
            )}
            {status.action === 'signout' && status.totalHours != null && (
              <p className="select__state-duration">
                TOTAL THIS YEAR — {status.totalHours.toFixed(2)}h
              </p>
            )}
          </div>
        )}

        {/* ── Error ── */}
        {status.kind === 'error' && (
          <div className="select__state select__state--error">
            <div className="select__exclaim">!</div>
            {status.message.split('\n').map((line, i) => (
              <p key={i} className={i === 0 ? 'select__state-name' : 'select__state-action'}>
                {line}
              </p>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
