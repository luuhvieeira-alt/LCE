/**
 * Typed Cloud Firestore REST API v1 client for Spark-tier Node.js server authority.
 *
 * Uses the caller's verified Firebase ID Token as the Bearer credential so every
 * atomic multi-document commit is simultaneously validated by Node.js business rules
 * AND enforced cryptographically by Cloud Firestore Security Rules.
 */

export interface FsValue {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Record<string, FsValue> };
}

export interface FsDocument {
  name: string;
  fields?: Record<string, FsValue>;
  createTime?: string;
  updateTime?: string;
}

export interface FsFieldTransform {
  fieldPath: string;
  setToServerValue?: 'REQUEST_TIME';
  increment?: FsValue;
}

export interface FirestoreCommitWrite {
  /** Collection + doc path relative to `/documents`, e.g. `wallets/uid123` */
  path: string;
  /** Fields to write (for full set or masked partial update) */
  fields?: Record<string, unknown>;
  /** When present, performs a partial merge of ONLY these top-level field paths */
  updateMask?: string[];
  /** Atomic server transforms (REQUEST_TIME, increment) */
  transforms?: FsFieldTransform[];
  /** Optimistic/existence precondition */
  precondition?: { exists: boolean };
}

export interface FirestoreQueryDoc {
  id: string;
  data: Record<string, unknown>;
}

export interface FirestoreBackend {
  getDoc(path: string, idToken: string): Promise<Record<string, unknown> | null>;
  listCollection(
    collectionId: string,
    idToken: string,
    pageSize?: number
  ): Promise<FirestoreQueryDoc[]>;
  queryByField(
    collectionId: string,
    fieldPath: string,
    op: 'EQUAL' | 'ARRAY_CONTAINS',
    value: unknown,
    idToken: string,
    limit?: number
  ): Promise<FirestoreQueryDoc[]>;
  commit(writes: FirestoreCommitWrite[], idToken: string): Promise<void>;
}

export class FirestoreRestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'FirestoreRestError';
    this.status = status;
    this.code = code;
  }
}

export function toFsNumber(value: number): FsValue {
  if (Number.isInteger(value) && Number.isSafeInteger(value)) {
    return { integerValue: String(value) };
  }
  return { doubleValue: value };
}

export function toFsValue(value: unknown): FsValue {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    return toFsNumber(value);
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => toFsValue(item)) } };
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('__timestamp' in obj && typeof obj.__timestamp === 'string') {
      return { timestampValue: obj.__timestamp };
    }
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        fields[k] = toFsValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export function toFsFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFsValue(v);
    }
  }
  return fields;
}

export function fromFsValue(val: FsValue | undefined): unknown {
  if (!val) return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) {
    return (val.arrayValue?.values ?? []).map((item) => fromFsValue(item));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue?.fields ?? {})) {
      out[k] = fromFsValue(v);
    }
    return out;
  }
  return null;
}

export function fromFsDocument(doc: FsDocument): FirestoreQueryDoc {
  const segments = doc.name.split('/');
  const id = segments[segments.length - 1] ?? '';
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields ?? {})) {
    data[k] = fromFsValue(v);
  }
  return { id, data };
}

export function timestampToMs(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (val && typeof val === 'object') {
    const rec = val as Record<string, unknown>;
    if (typeof rec.seconds === 'number') {
      return rec.seconds * 1000;
    }
    if (typeof rec.toMillis === 'function') {
      return (rec.toMillis as () => number)();
    }
  }
  return 0;
}

export class FirestoreRestClient implements FirestoreBackend {
  private readonly docBasePath: string;
  private readonly apiBaseUrl: string;

  constructor(projectId: string, databaseId: string = '(default)') {
    this.docBasePath = `projects/${projectId}/databases/${databaseId}/documents`;
    this.apiBaseUrl = `https://firestore.googleapis.com/v1/${this.docBasePath}`;
  }

  private async parseError(res: Response): Promise<FirestoreRestError> {
    let code = 'FIRESTORE_ERROR';
    let message = `Firestore HTTP ${res.status}`;
    try {
      const json = (await res.json()) as {
        error?: { status?: string; message?: string };
      };
      if (json?.error?.status) code = json.error.status;
      if (json?.error?.message) message = json.error.message;
    } catch {
      // keep generic error
    }
    return new FirestoreRestError(res.status, code, message);
  }

  async getDoc(path: string, idToken: string): Promise<Record<string, unknown> | null> {
    const cleanPath = path.replace(/^\/+/, '');
    const res = await fetch(`${this.apiBaseUrl}/${cleanPath}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw await this.parseError(res);
    }
    const doc = (await res.json()) as FsDocument;
    return fromFsDocument(doc).data;
  }

  async listCollection(
    collectionId: string,
    idToken: string,
    pageSize = 50
  ): Promise<FirestoreQueryDoc[]> {
    const cleanCol = collectionId.replace(/^\/+/, '');
    const res = await fetch(`${this.apiBaseUrl}/${cleanCol}?pageSize=${pageSize}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (res.status === 404) return [];
    if (!res.ok) {
      throw await this.parseError(res);
    }
    const json = (await res.json()) as { documents?: FsDocument[] };
    return (json.documents ?? []).map((doc) => fromFsDocument(doc));
  }

  async queryByField(
    collectionId: string,
    fieldPath: string,
    op: 'EQUAL' | 'ARRAY_CONTAINS',
    value: unknown,
    idToken: string,
    limit = 50
  ): Promise<FirestoreQueryDoc[]> {
    const structuredQuery = {
      from: [{ collectionId }],
      where: {
        fieldFilter: {
          field: { fieldPath },
          op,
          value: toFsValue(value),
        },
      },
      limit,
    };

    const res = await fetch(`${this.apiBaseUrl}:runQuery`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ structuredQuery }),
    });

    if (!res.ok) {
      throw await this.parseError(res);
    }

    const rows = (await res.json()) as Array<{ document?: FsDocument }>;
    const results: FirestoreQueryDoc[] = [];
    for (const row of rows) {
      if (row.document) {
        results.push(fromFsDocument(row.document));
      }
    }
    return results;
  }

  async commit(writes: FirestoreCommitWrite[], idToken: string): Promise<void> {
    if (writes.length === 0) return;

    const restWrites = writes.map((w) => {
      const fullName = `${this.docBasePath}/${w.path.replace(/^\/+/, '')}`;
      const payload: Record<string, unknown> = {
        update: {
          name: fullName,
          fields: toFsFields(w.fields ?? {}),
        },
      };

      if (w.updateMask) {
        payload.updateMask = { fieldPaths: w.updateMask };
      }

      if (w.transforms && w.transforms.length > 0) {
        payload.updateTransforms = w.transforms;
      }

      if (w.precondition) {
        payload.currentDocument = w.precondition;
      }

      return payload;
    });

    const res = await fetch(`${this.apiBaseUrl}:commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ writes: restWrites }),
    });

    if (!res.ok) {
      throw await this.parseError(res);
    }
  }
}
