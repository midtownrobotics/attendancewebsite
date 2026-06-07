const WINDOW_MS    = 30_000;
const VALID_WINDOWS = 4; // 4 × 30 s = 2 minutes

export function validateToken(w: number): void {
  const current = Math.floor(Date.now() / WINDOW_MS);
  if (w > current)              throw new Error('TOKEN_EXPIRED');
  if (current - w > VALID_WINDOWS) throw new Error('TOKEN_EXPIRED');
}

export function nameToId(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}
