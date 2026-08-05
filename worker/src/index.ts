import { Hono } from 'hono';
import { Firestore } from './firestore';
import { createSelectionGrant, currentWindow, validateSelectionGrant, validateToken, nameToId } from './token';

const AUTO_SIGNOUT_MS = 12 * 60 * 60 * 1000;

type Env = {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();

/* ─────────────────────────────
   GLOBAL ERROR HANDLING
──────────────────────────── */

addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  console.log('🔥 UNHANDLED PROMISE:', event.reason);
});

/* ─────────────────────────────
   CORS
──────────────────────────── */


/* ─────────────────────────────
   DB
──────────────────────────── */

function db(env: Env) {
  return new Firestore(
    env.FIREBASE_PROJECT_ID,
    env.FIREBASE_CLIENT_EMAIL,
    env.FIREBASE_PRIVATE_KEY
  );
}

/* QR timestamps must come from the same clock that validates them. */
app.get('/qr-window', (c) => c.json({ w: currentWindow() }));

/* ─────────────────────────────
   /members
──────────────────────────── */

app.get('/members', async (c) => {
  try {
    const action = c.req.query('action');
    const w = Number(c.req.query('w'));
    if ((action !== 'signin' && action !== 'signout') || !Number.isSafeInteger(w)) {
      return c.json({ error: 'TOKEN_EXPIRED' }, 400);
    }
    try { validateToken(w); }
    catch { return c.json({ error: 'TOKEN_EXPIRED' }, 400); }

    const doc = await db(c.env).getDoc('config/members');
    const names = (doc?.data.names as string[]) ?? [];
    const grant = await createSelectionGrant(action, w, c.env.FIREBASE_PRIVATE_KEY);
    return c.json({ names, grant });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('GET /members error:', msg);
    return c.json({ error: msg }, 500);
  }
});

/* ─────────────────────────────
   /signin
──────────────────────────── */

app.post('/signin', async (c) => {
  const { name, grant } = await c.req.json<{ name: string; grant: string }>();

  try { await validateSelectionGrant('signin', grant, c.env.FIREBASE_PRIVATE_KEY); }
  catch { return c.json({ error: 'TOKEN_EXPIRED' }, 400); }

  const fs = db(c.env);
  const memberId = nameToId(name);
  const sessionsPath = `members/${memberId}/sessions`;

  await fs.setDoc(`members/${memberId}`, { displayName: name });

  const open = await fs.query(sessionsPath, [
    { field: 'status', op: 'EQUAL', value: 'open' }
  ]);

  if (open.length > 0) {
    return c.json({ error: 'ALREADY_SIGNED_IN' }, 409);
  }

  await fs.addDoc(sessionsPath, {
    signIn: new Date(),
    signOut: null,
    durationMs: null,
    status: 'open',
    year: String(new Date().getFullYear()),
  });

  return c.json({ ok: true });
});

/* ─────────────────────────────
   /signout
──────────────────────────── */

app.post('/signout', async (c) => {
  const { name, grant } = await c.req.json<{ name: string; grant: string }>();

  try { await validateSelectionGrant('signout', grant, c.env.FIREBASE_PRIVATE_KEY); }
  catch { return c.json({ error: 'TOKEN_EXPIRED' }, 400); }

  const fs = db(c.env);
  const memberId = nameToId(name);
  const sessionsPath = `members/${memberId}/sessions`;

  const open = await fs.query(
    sessionsPath,
    [{ field: 'status', op: 'EQUAL', value: 'open' }]
  );

  console.log('OPEN SESSIONS:', JSON.stringify(open));

  if (!open.length) {
    return c.json({ error: 'NOT_SIGNED_IN' }, 404);
  }

  const session = open[0];

  const signInRaw = session?.data?.signIn;
  const signInMs =
    signInRaw instanceof Date
      ? signInRaw.getTime()
      : new Date(signInRaw as any).getTime();

  const durationMs = Date.now() - signInMs;

  // A forgotten sign-out never earns attendance time, even if the scheduled
  // cleanup has not reached this session yet.
  if (!Number.isFinite(signInMs) || durationMs >= AUTO_SIGNOUT_MS) {
    await fs.updateDoc(session.path, {
      signOut: new Date(),
      durationMs: 0,
      status: 'auto-closed',
    });

    const year = String(new Date().getFullYear());
    const existing = await fs.getDoc(`members/${memberId}/totals/${year}`);
    return c.json({
      ok: true,
      durationMs: 0,
      totalHours: ((existing?.data?.totalMs as number) ?? 0) / 3_600_000,
    });
  }

  await fs.updateDoc(session.path, {
    signOut: new Date(),
    durationMs,
    status: 'completed',
  });

  const year = String(new Date().getFullYear());
  const totalPath = `members/${memberId}/totals/${year}`;
  const existing = await fs.getDoc(totalPath);

  await fs.setDoc(totalPath, {
    totalMs: ((existing?.data?.totalMs as number) ?? 0) + durationMs,
    totalHours: (((existing?.data?.totalMs as number) ?? 0) + durationMs) / 3_600_000,
    sessions: ((existing?.data?.sessions as number) ?? 0) + 1,
    year,
  });

  return c.json({ ok: true, durationMs, totalHours: (((existing?.data?.totalMs as number) ?? 0) + durationMs) / 3_600_000 });
});

/* ─────────────────────────────
   /status
──────────────────────────── */

app.get('/status', async (c) => {
  const fs = db(c.env);

  const open = await fs.collectionGroupQuery('sessions', [
    { field: 'signOut', op: 'EQUAL', value: null },
  ]);

  const signedIn = await Promise.all(
    open.map(async (s: any) => {
      const path =
        s?.path ||
        s?.ref?.path ||
        s?.document?.name ||
        s?.name;

      if (!path || typeof path !== 'string') {
        console.log('BAD SESSION:', s);
        return 'UNKNOWN';
      }

      const parts = path.split('/');
      const memberId = parts[1];

      if (!memberId) return 'UNKNOWN';

      const member = await fs.getDoc(`members/${memberId}`);

      return (member?.data?.displayName as string) ?? memberId;
    })
  );

  return c.json({ signedIn });
});

/* ─────────────────────────────
   AUTO SIGNOUT
──────────────────────────── */

async function autoSignOut(env: Env) {
  const fs = db(env);
  const cutoff = new Date(Date.now() - AUTO_SIGNOUT_MS);

  const stale = await fs.collectionGroupQuery('sessions', [
    { field: 'signOut', op: 'EQUAL', value: null },
    { field: 'signIn', op: 'LESS_THAN', value: cutoff },
  ]);

  await Promise.all(stale.map((session: any) => {
    return fs.updateDoc(session.path, {
      signOut: new Date(),
      durationMs: 0,
      status: 'auto-closed',
    });
  }));

  console.log(`Auto-closed ${stale.length} sessions`);
}

/* ─────────────────────────────
   EXPORT
──────────────────────────── */

export default {
  async fetch(request: Request, env: Env & { ASSETS: Fetcher }, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // API requests → Hono (same domain, no CORS needed)
    if (url.pathname.startsWith('/api/')) {
      const stripped = new Request(
        request.url.replace('/api/', '/'),
        request
      );
      return app.fetch(stripped, env, ctx);
    }

    // Static assets
    const host = url.hostname;
    const folder = host.includes('signout') ? 'signout' : 'signin';
    const assetPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const assetUrl = new URL(request.url);
    assetUrl.pathname = `/${folder}${assetPath}`;

    const res = await env.ASSETS.fetch(assetUrl.toString());
    if (res.status === 404) {
      assetUrl.pathname = `/${folder}/index.html`;
      return env.ASSETS.fetch(assetUrl.toString());
    }
    return res;
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(autoSignOut(env));
  },
};
