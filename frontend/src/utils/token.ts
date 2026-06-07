export type PageType = 'signin' | 'signout';

export const WINDOW_MS   = 30_000;
export const VALID_WINDOWS = 4; // 4 × 30s = 2 minutes

export function currentWindow(): number {
  return Math.floor(Date.now() / WINDOW_MS);
}

export function msUntilNextWindow(): number {
  return WINDOW_MS - (Date.now() % WINDOW_MS);
}

/** URL encoded into the QR code — scanned by student's phone */
export function buildQrUrl(type: PageType): string {
  const origin = window.location.origin; // e.g. https://g3signin.johnrachwalski.com
  return `${origin}/?action=${type}&w=${currentWindow()}`;
}
