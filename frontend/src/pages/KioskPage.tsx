import { useEffect, useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { buildQrUrl, msUntilNextWindow, WINDOW_MS, type PageType } from '../utils/token';
import './KioskPage.css';

interface Props { type: PageType }

export default function KioskPage({ type }: Props) {
  const isSignIn = type === 'signin';
  const label    = isSignIn ? 'SIGN IN' : 'SIGN OUT';

  const [qrValue,     setQrValue]     = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(msUntilNextWindow() / 1000));
  const [refreshKey,  setRefreshKey]  = useState(0);

  const refreshToken = useCallback(async () => {
    try {
      const res = await fetch('/api/qr-window', { cache: 'no-store' });
      if (!res.ok) throw new Error('QR_WINDOW_FAILED');
      const data = await res.json() as { w: number };
      setQrValue(buildQrUrl(type, data.w));
      setRefreshKey(k => k + 1);
    } catch {
      // Keep the last server-issued QR visible through brief network failures.
    }
  }, [type]);

  // Fetch QR windows from Cloudflare so kiosk clock skew cannot expire scans.
  useEffect(() => {
    void refreshToken();
    const interval = setInterval(() => { void refreshToken(); }, WINDOW_MS);
    return () => clearInterval(interval);
  }, [refreshToken]);

  useEffect(() => {
    const tick = setInterval(() => setSecondsLeft(Math.ceil(msUntilNextWindow() / 1000)), 500);
    return () => clearInterval(tick);
  }, []);

  return (
    <div className={`kiosk kiosk--${type}`}>
      <div className="scanlines" aria-hidden="true" />
      <div className="kiosk__content">
        <h1 className="kiosk__label">{label}</h1>

        <div className="kiosk__qr-wrapper">
          <div className="kiosk__qr-frame" key={refreshKey}>
            {qrValue && (
              <QRCodeSVG
                value={qrValue}
                size={460}
                bgColor="transparent"
                fgColor={isSignIn ? '#00ff88' : '#ff3344'}
                level="M"
              />
            )}
          </div>
        </div>

        <div className="kiosk__timer">
          <span className="kiosk__timer-label">NEW CODE IN</span>
          <span className="kiosk__timer-seconds">{secondsLeft}s</span>
        </div>
      </div>
    </div>
  );
}
