import { getAccessToken } from './auth';

type FSValue = any;

// ── converters ─────────────────────────────

export function toFS(v: unknown): FSValue {
  if (v === null || v === undefined) return { nullValue: 'NULL_VALUE' };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFS) } };

  if (typeof v === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(([k, val]) => [
            k,
            toFS(val),
          ])
        ),
      },
    };
  }

  return { stringValue: String(v) };
}

export function fromFS(v: FSValue): unknown {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v)
    return (v.arrayValue.values ?? []).map(fromFS);
  if ('mapValue' in v)
    return Object.fromEntries(
      Object.entries((v.mapValue.fields ?? {}) as Record<string, FSValue>).map(
        ([k, val]) => [k, fromFS(val)]
      )
    );

  return null;
}

function fieldsToObj(fields: Record<string, FSValue>) {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, fromFS(v)])
  );
}

// ── SAFE RESPONSE TYPES ─────────────────────────────

type FirestoreDoc = {
  name?: string;
  fields?: Record<string, FSValue>;
};

type FirestoreRunQueryRow = {
  document?: FirestoreDoc;
};

// ── SAFE ID HELPERS (NO split anywhere) ─────────────

function getSafeId(name?: string): string {
  if (!name || typeof name !== 'string') return 'UNKNOWN';

  let last = '';
  for (let i = name.length - 1; i >= 0; i--) {
    if (name[i] === '/') break;
    last = name[i] + last;
  }
  return last || 'UNKNOWN';
}

function getSafePath(name?: string): string {
  return typeof name === 'string' ? name : '';
}

// ── CLIENT ─────────────────────────────────────────────

export interface DocSnapshot {
  id: string;
  path: string;
  data: Record<string, unknown>;
}

export class Firestore {
  private base: string;

  constructor(
    private projectId: string,
    private clientEmail: string,
    private privateKey: string
  ) {
    this.base =
      `https://firestore.googleapis.com/v1/projects/${projectId}` +
      `/databases/(default)/documents`;
  }

  private async headers() {
    const token = await getAccessToken(
      this.clientEmail,
      this.privateKey
    );

    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async getDoc(path: string): Promise<DocSnapshot | null> {
    const url = path.startsWith('projects/')
      ? `https://firestore.googleapis.com/v1/${path}`
      : `${this.base}/${path}`;

    const res = await fetch(url, { headers: await this.headers() });
    if (res.status === 404) return null;

    const doc = (await res.json()) as FirestoreDoc;
    return {
      id: getSafeId(doc.name),
      path: getSafePath(doc.name),
      data: fieldsToObj(doc.fields ?? {}),
    };
  }

  async setDoc(path: string, data: Record<string, unknown>) {
    const fields = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, toFS(v)])
    );

    await fetch(`${this.base}/${path}`, {
      method: 'PATCH',
      headers: await this.headers(),
      body: JSON.stringify({ fields }),
    });
  }

  async updateDoc(path: string, data: Record<string, unknown>) {
    const fields = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, toFS(v)])
    );

    const mask = Object.keys(data)
      .map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
      .join('&');

    const url = path.startsWith('projects/')
      ? `https://firestore.googleapis.com/v1/${path}?${mask}`
      : `${this.base}/${path}?${mask}`;

    await fetch(url, {
      method: 'PATCH',
      headers: await this.headers(),
      body: JSON.stringify({ fields }),
    });
  }

  async addDoc(collectionPath: string, data: Record<string, unknown>) {
    const fields = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, toFS(v)])
    );

    const res = await fetch(`${this.base}/${collectionPath}`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ fields }),
    });

    const doc = (await res.json()) as FirestoreDoc;

    return getSafeId(doc.name);
  }

  async query(
    collectionPath: string,
    filters: Array<{ field: string; op: string; value: unknown }>,
    orderBy?: { field: string; dir?: 'ASCENDING' | 'DESCENDING' },
    limit?: number
  ): Promise<DocSnapshot[]> {
    const parts = collectionPath.split('/');
    const collectionId = parts.pop()!;
    const parentPath = parts.join('/');
    const url = parentPath ? `${this.base}/${parentPath}:runQuery` : `${this.base}:runQuery`;

    const res = await fetch(url, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          where: filters.length === 1
            ? { fieldFilter: { field: { fieldPath: filters[0].field }, op: filters[0].op, value: toFS(filters[0].value) } }
            : { compositeFilter: { op: 'AND', filters: filters.map(f => ({ fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: toFS(f.value) } })) } },
          ...(orderBy ? { orderBy: [{ field: { fieldPath: orderBy.field }, direction: orderBy.dir ?? 'ASCENDING' }] } : {}),
          ...(limit ? { limit } : {}),
        },
      }),
    });

    const rawJson = await res.json();
    console.log('QUERY URL:', url);
    console.log('QUERY RESPONSE:', JSON.stringify(rawJson));
    const rows = rawJson as FirestoreRunQueryRow[];
    return rows
      .filter(r => r?.document)
      .map(r => ({
        id: getSafeId(r.document!.name),
        path: getSafePath(r.document!.name),
        data: fieldsToObj(r.document!.fields ?? {}),
      }));
  }





  async collectionGroupQuery(
    collectionId: string,
    filters: Array<{ field: string; op: string; value: unknown }>
  ): Promise<DocSnapshot[]> {
    const res = await fetch(`${this.base}:runQuery`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId, allDescendants: true }],
          where:
            filters.length === 1
              ? {
                fieldFilter: {
                  field: { fieldPath: filters[0].field },
                  op: filters[0].op,
                  value: toFS(filters[0].value),
                },
              }
              : {
                compositeFilter: {
                  op: 'AND',
                  filters: filters.map(f => ({
                    fieldFilter: {
                      field: { fieldPath: f.field },
                      op: f.op,
                      value: toFS(f.value),
                    },
                  })),
                },
              },
        },
      }),
    });

    const rows = (await res.json()) as FirestoreRunQueryRow[];

    return rows
      .filter(r => r?.document)
      .map(r => ({
        id: getSafeId(r.document!.name),
        path: getSafePath(r.document!.name),
        data: fieldsToObj(r.document!.fields ?? {}),
      }));
  }
}