/** URL-safe base64 encode */
function b64url(input: string | ArrayBuffer): string {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);

  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));

  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/** Convert base64 → Uint8Array */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Clean PEM for WebCrypto */
function extractPrivateKey(pem: string): Uint8Array {
  // STEP 1: convert escaped JSON newlines into real string content
  const normalized = pem
    .trim()
    .replace(/^"|"$/g, '')     // remove wrapping quotes if any
    .replace(/\\n/g, '\n');    // IMPORTANT: convert \n → real newline

  // STEP 2: extract only base64 part between headers
  const match = normalized.match(
    /-----BEGIN PRIVATE KEY-----\s*([\s\S]*?)\s*-----END PRIVATE KEY-----/
  );

  if (!match) {
    throw new Error("PEM format invalid: missing headers");
  }

  const base64 = match[1]
    .replace(/\s/g, ''); // remove ALL whitespace/newlines

  // STEP 3: strict base64 validation
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new Error("Invalid base64 in private key");
  }

  // STEP 4: decode
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

let tokenCache: { value: string; exp: number } | null = null;

export async function getAccessToken(
  clientEmail: string,
  privateKey: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // cache (avoid re-signing every request)
  if (tokenCache && tokenCache.exp > now + 60) {
    return tokenCache.value;
  }

  /** JWT HEADER */
  const header = b64url(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' })
  );

  /** JWT PAYLOAD */
  const payload = b64url(
    JSON.stringify({
      iss: clientEmail,
      sub: clientEmail,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );

  const signingInput = `${header}.${payload}`;

  /** IMPORT PRIVATE KEY */
  const keyData = extractPrivateKey(privateKey);

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  /** SIGN JWT */
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${b64url(signature)}`;

  /** GET ACCESS TOKEN */
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  if (!json.access_token) {
    throw new Error('Failed to get access token: ' + JSON.stringify(json));
  }

  tokenCache = {
    value: json.access_token,
    exp: now + json.expires_in,
  };

  return tokenCache.value;
}