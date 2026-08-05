const WINDOW_MS    = 30_000;
const VALID_WINDOWS = 4; // 4 × 30 s = 2 minutes

export function currentWindow(): number {
  return Math.floor(Date.now() / WINDOW_MS);
}

export function validateToken(w: number): void {
  const current = currentWindow();
  if (w > current)              throw new Error('TOKEN_EXPIRED');
  if (current - w > VALID_WINDOWS) throw new Error('TOKEN_EXPIRED');
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function grantSignature(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64Url(new Uint8Array(signature));
}

/** Exchange a valid rotating QR window for authorization held by an open page. */
export async function createSelectionGrant(action: string, w: number, secret: string): Promise<string> {
  const payload = `${action}:${w}`;
  return `${w}.${await grantSignature(payload, secret)}`;
}

export async function validateSelectionGrant(action: string, grant: string, secret: string): Promise<void> {
  const separator = grant.indexOf('.');
  if (separator < 1) throw new Error('INVALID_GRANT');

  const w = grant.slice(0, separator);
  const suppliedSignature = grant.slice(separator + 1);
  if (!/^\d+$/.test(w)) throw new Error('INVALID_GRANT');

  const expectedSignature = await grantSignature(`${action}:${w}`, secret);
  if (suppliedSignature !== expectedSignature) throw new Error('INVALID_GRANT');
}

export function nameToId(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}
