import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { OperationType, db, firebaseConfig, handleFirestoreError } from '../firebase';
import {
  DEFAULT_COLUMNS,
  MAX_COLUMN_LABEL_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  fromFirestoreEntryDoc,
  fromFirestoreRestEntryDoc,
  isAuthorizedEditorEmail,
  normalizeUrl,
  parseFirestoreRestFields,
  sanitizeColumns,
  sanitizeEntryId,
  sortEntriesByOrder,
  toFirestoreColumnPayload,
  toFirestoreEntryCreatePayload,
  type ColumnConfig,
  type ColumnId,
  type VaultEntry,
} from './links';

const PUBLIC_VAULT_ID = 'main';
const BATCH_CHUNK_SIZE = 400;

function prepareEntriesForCloud(rawEntries: VaultEntry[]): VaultEntry[] {
  const idMap = new Map<string, string>();
  const sanitized = rawEntries.map((entry, idx) => {
    const safeId = sanitizeEntryId(entry.id, entry.kind);
    idMap.set(entry.id, safeId);
    return {
      ...entry,
      id: safeId,
      sortOrder: entry.sortOrder ?? idx,
    };
  });

  const containerIds = new Set(
    sanitized
      .filter((e) => e.kind === 'folder' || e.kind === 'section')
      .map((e) => e.id)
  );

  return sanitized.map((entry) => {
    if (entry.kind === 'folder') {
      return { ...entry, parentId: null };
    }
    const mappedParent = entry.parentId ? idMap.get(entry.parentId) ?? entry.parentId : null;
    const validParent =
      mappedParent && mappedParent !== entry.id && containerIds.has(mappedParent)
        ? mappedParent
        : null;
    return {
      ...entry,
      parentId: validParent,
    };
  });
}

function orderContainersFirst(entries: VaultEntry[]): VaultEntry[] {
  const rank = (kind: VaultEntry['kind']) =>
    kind === 'folder' ? 0 : kind === 'section' ? 1 : 2;
  return [...entries].sort((a, b) => rank(a.kind) - rank(b.kind));
}

export async function checkUserEditorAccess(user: User | null): Promise<boolean> {
  if (!user || !user.emailVerified) return false;
  if (isAuthorizedEditorEmail(user.email)) return true;

  const path = `admins/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

async function fetchPublicVaultViaRest(): Promise<{
  entries: VaultEntry[];
  columns: ColumnConfig[];
  initialized: boolean;
}> {
  const { projectId, firestoreDatabaseId, apiKey } = firebaseConfig;
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(firestoreDatabaseId)}/documents/vault/${PUBLIC_VAULT_ID}`;

  const [colsRes, entriesRes] = await Promise.all([
    fetch(`${baseUrl}/meta/columns?key=${encodeURIComponent(apiKey)}`),
    fetch(`${baseUrl}:runQuery?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'entries' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'isPublic' },
              op: 'EQUAL',
              value: { booleanValue: true },
            },
          },
        },
      }),
    }),
  ]);

  let columns = DEFAULT_COLUMNS;
  let initialized = false;

  if (colsRes.status === 200) {
    const colsJson = (await colsRes.json()) as {
      fields?: Record<string, Record<string, unknown>>;
    };
    const parsedCols = parseFirestoreRestFields(colsJson.fields);
    columns = sanitizeColumns([
      { id: 'CRE', label: parsedCols.creLabel },
      { id: 'JAY', label: parsedCols.jayLabel },
      { id: 'OTHER', label: parsedCols.otherLabel },
    ]);
    initialized = true;
  } else if (colsRes.status !== 404) {
    const errText = await colsRes.text();
    throw new Error(`Firestore REST columns error (${colsRes.status}): ${errText}`);
  }

  if (!entriesRes.ok) {
    const errText = await entriesRes.text();
    throw new Error(`Firestore REST entries error (${entriesRes.status}): ${errText}`);
  }

  const rows = (await entriesRes.json()) as Array<{
    document?: {
      name?: string;
      fields?: Record<string, Record<string, unknown>>;
    };
  }>;

  const entries: VaultEntry[] = [];
  for (const row of rows) {
    if (!row.document) continue;
    const entry = fromFirestoreRestEntryDoc(row.document);
    if (entry) entries.push(entry);
  }

  return {
    entries: sortEntriesByOrder(entries),
    columns,
    initialized,
  };
}

const SDK_SERVER_FETCH_TIMEOUT_MS = 2000;

export async function fetchPublicVaultOnce(): Promise<{
  entries: VaultEntry[];
  columns: ColumnConfig[];
  initialized: boolean;
}> {
  const path = `vault/${PUBLIC_VAULT_ID}/entries`;
  try {
    const sdkFetchPromise = Promise.all([
      getDocsFromServer(
        query(
          collection(db, 'vault', PUBLIC_VAULT_ID, 'entries'),
          where('isPublic', '==', true)
        )
      ),
      getDocFromServer(doc(db, 'vault', PUBLIC_VAULT_ID, 'meta', 'columns')),
    ]);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Firestore server fetch timed out')), SDK_SERVER_FETCH_TIMEOUT_MS);
    });

    const [entriesSnap, colsSnap] = await Promise.race([sdkFetchPromise, timeoutPromise]);

    const parsed: VaultEntry[] = [];
    entriesSnap.forEach((docSnap) => {
      const entry = fromFirestoreEntryDoc(docSnap.id, docSnap.data());
      if (entry) parsed.push(entry);
    });

    let columns = DEFAULT_COLUMNS;
    let initialized = false;
    if (colsSnap.exists()) {
      const data = colsSnap.data();
      columns = sanitizeColumns([
        { id: 'CRE', label: data.creLabel },
        { id: 'JAY', label: data.jayLabel },
        { id: 'OTHER', label: data.otherLabel },
      ]);
      initialized = true;
    }

    return {
      entries: sortEntriesByOrder(parsed),
      columns,
      initialized,
    };
  } catch (sdkError) {
    const msg = sdkError instanceof Error ? sdkError.message : String(sdkError);
    if (msg.includes('Missing or insufficient permissions') || msg.includes('permission-denied')) {
      handleFirestoreError(sdkError, OperationType.LIST, path);
    }
    try {
      return await fetchPublicVaultViaRest();
    } catch (restError) {
      handleFirestoreError(restError, OperationType.LIST, path);
    }
  }
}

export function subscribeToPublicVaultEntries(
  onEntries: (entries: VaultEntry[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `vault/${PUBLIC_VAULT_ID}/entries`;
  const q = query(
    collection(db, 'vault', PUBLIC_VAULT_ID, 'entries'),
    where('isPublic', '==', true)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const parsed: VaultEntry[] = [];
      snapshot.forEach((docSnap) => {
        const entry = fromFirestoreEntryDoc(docSnap.id, docSnap.data());
        if (entry) {
          parsed.push(entry);
        }
      });
      onEntries(sortEntriesByOrder(parsed));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  );
}

export function subscribeToPublicColumnSettings(
  onColumns: (columns: ColumnConfig[], initialized: boolean) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `vault/${PUBLIC_VAULT_ID}/meta/columns`;
  const ref = doc(db, 'vault', PUBLIC_VAULT_ID, 'meta', 'columns');

  return onSnapshot(
    ref,
    (snapshot) => {
      if (!snapshot.exists()) {
        onColumns(DEFAULT_COLUMNS, false);
        return;
      }
      const data = snapshot.data();
      onColumns(
        sanitizeColumns([
          { id: 'CRE', label: data.creLabel },
          { id: 'JAY', label: data.jayLabel },
          { id: 'OTHER', label: data.otherLabel },
        ]),
        true
      );
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  );
}

export async function createVaultEntryInCloud(
  uid: string,
  entry: VaultEntry,
  sortOrder: number
): Promise<void> {
  const safeId = sanitizeEntryId(entry.id, entry.kind);
  const path = `vault/${PUBLIC_VAULT_ID}/entries/${safeId}`;
  const payload = toFirestoreEntryCreatePayload(
    { ...entry, id: safeId, sortOrder },
    uid,
    serverTimestamp(),
    sortOrder
  );

  try {
    await setDoc(doc(db, 'vault', PUBLIC_VAULT_ID, 'entries', safeId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateVaultEntryDetailsInCloud(
  entry: VaultEntry
): Promise<void> {
  const safeId = sanitizeEntryId(entry.id, entry.kind);
  const path = `vault/${PUBLIC_VAULT_ID}/entries/${safeId}`;
  const safeTitle = entry.title.trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled';
  const safeParentId =
    entry.kind === 'folder' || !entry.parentId
      ? ''
      : sanitizeEntryId(entry.parentId, 'parent');
  const safeSortOrder = entry.sortOrder ?? 0;

  const updates: Record<string, unknown> = {
    title: safeTitle,
    columnId: entry.columnId,
    parentId: safeParentId,
    sortOrder: safeSortOrder,
    updatedAt: serverTimestamp(),
  };

  if (entry.kind === 'link') {
    const normalized = normalizeUrl(entry.url);
    if (!normalized) return;
    updates.url = normalized.slice(0, MAX_URL_LENGTH);
  }

  try {
    await updateDoc(doc(db, 'vault', PUBLIC_VAULT_ID, 'entries', safeId), updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function reorderVaultEntriesInCloud(
  entries: Array<{
    id: string;
    columnId: ColumnId;
    parentId?: string | null;
    sortOrder: number;
    kind: VaultEntry['kind'];
  }>
): Promise<void> {
  if (entries.length === 0) return;
  const basePath = `vault/${PUBLIC_VAULT_ID}/entries`;

  try {
    for (let i = 0; i < entries.length; i += BATCH_CHUNK_SIZE) {
      const chunk = entries.slice(i, i + BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const ref = doc(db, 'vault', PUBLIC_VAULT_ID, 'entries', item.id);
        batch.update(ref, {
          columnId: item.columnId,
          parentId: item.kind === 'folder' || !item.parentId ? '' : item.parentId,
          sortOrder: item.sortOrder,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, basePath);
  }
}

export async function toggleSectionInCloud(
  sectionId: string,
  isOpen: boolean
): Promise<void> {
  const path = `vault/${PUBLIC_VAULT_ID}/entries/${sectionId}`;
  try {
    await updateDoc(doc(db, 'vault', PUBLIC_VAULT_ID, 'entries', sectionId), {
      isOpen,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function trackLinkClickInCloud(linkId: string): Promise<void> {
  const path = `vault/${PUBLIC_VAULT_ID}/entries/${linkId}`;
  try {
    await updateDoc(doc(db, 'vault', PUBLIC_VAULT_ID, 'entries', linkId), {
      clicks: increment(1),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteVaultEntriesInCloud(idsToDelete: string[]): Promise<void> {
  if (idsToDelete.length === 0) return;
  const basePath = `vault/${PUBLIC_VAULT_ID}/entries`;

  try {
    for (let i = 0; i < idsToDelete.length; i += BATCH_CHUNK_SIZE) {
      const chunk = idsToDelete.slice(i, i + BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.delete(doc(db, 'vault', PUBLIC_VAULT_ID, 'entries', id));
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, basePath);
  }
}

export async function saveColumnsToCloud(
  uid: string,
  columns: ColumnConfig[]
): Promise<void> {
  const path = `vault/${PUBLIC_VAULT_ID}/meta/columns`;
  const ref = doc(db, 'vault', PUBLIC_VAULT_ID, 'meta', 'columns');
  const safe = sanitizeColumns(columns).map((col) => ({
    ...col,
    label: col.label.trim().slice(0, MAX_COLUMN_LABEL_LENGTH),
  }));
  const payload = toFirestoreColumnPayload(safe, uid, serverTimestamp());

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        creLabel: payload.creLabel,
        jayLabel: payload.jayLabel,
        otherLabel: payload.otherLabel,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function replaceAllVaultDataInCloud(
  uid: string,
  nextEntries: VaultEntry[],
  nextColumns?: ColumnConfig[]
): Promise<void> {
  const entriesPath = `vault/${PUBLIC_VAULT_ID}/entries`;
  try {
    const existingSnap = await getDocs(
      query(
        collection(db, 'vault', PUBLIC_VAULT_ID, 'entries'),
        where('isPublic', '==', true)
      )
    );
    const existingIds = existingSnap.docs.map((d) => d.id);

    for (let i = 0; i < existingIds.length; i += BATCH_CHUNK_SIZE) {
      const chunk = existingIds.slice(i, i + BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.delete(doc(db, 'vault', PUBLIC_VAULT_ID, 'entries', id));
      }
      await batch.commit();
    }

    const prepared = orderContainersFirst(prepareEntriesForCloud(nextEntries));
    for (let i = 0; i < prepared.length; i += BATCH_CHUNK_SIZE) {
      const chunk = prepared.slice(i, i + BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const entry of chunk) {
        const ref = doc(db, 'vault', PUBLIC_VAULT_ID, 'entries', entry.id);
        batch.set(
          ref,
          toFirestoreEntryCreatePayload(entry, uid, serverTimestamp(), entry.sortOrder ?? 0)
        );
      }
      await batch.commit();
    }

    if (nextColumns) {
      await saveColumnsToCloud(uid, nextColumns);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, entriesPath);
  }
}

export async function initializePublicVaultIfNeeded(
  uid: string,
  fallbackEntries: VaultEntry[],
  fallbackColumns: ColumnConfig[]
): Promise<boolean> {
  const entriesPath = `vault/${PUBLIC_VAULT_ID}/entries`;
  try {
    const [publicEntriesSnap, publicColsSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'vault', PUBLIC_VAULT_ID, 'entries'),
          where('isPublic', '==', true)
        )
      ),
      getDoc(doc(db, 'vault', PUBLIC_VAULT_ID, 'meta', 'columns')),
    ]);

    if (!publicEntriesSnap.empty || publicColsSnap.exists()) {
      return false;
    }

    // Check legacy per-user vault first so previously saved entries are preserved
    let sourceEntries = fallbackEntries;
    let sourceColumns = fallbackColumns;

    try {
      const [legacyEntriesSnap, legacyColsSnap] = await Promise.all([
        getDocs(query(collection(db, 'users', uid, 'entries'), where('ownerId', '==', uid))),
        getDoc(doc(db, 'users', uid, 'meta', 'columns')),
      ]);

      if (!legacyEntriesSnap.empty) {
        const legacyParsed: VaultEntry[] = [];
        legacyEntriesSnap.forEach((docSnap) => {
          const entry = fromFirestoreEntryDoc(docSnap.id, docSnap.data());
          if (entry) legacyParsed.push(entry);
        });
        if (legacyParsed.length > 0) {
          sourceEntries = sortEntriesByOrder(legacyParsed);
        }
      }

      if (legacyColsSnap.exists()) {
        const data = legacyColsSnap.data();
        sourceColumns = sanitizeColumns([
          { id: 'CRE', label: data.creLabel },
          { id: 'JAY', label: data.jayLabel },
          { id: 'OTHER', label: data.otherLabel },
        ]);
      }
    } catch {
      // Ignore legacy lookup issues and fall back cleanly
    }

    const prepared = orderContainersFirst(prepareEntriesForCloud(sourceEntries));
    for (let i = 0; i < prepared.length; i += BATCH_CHUNK_SIZE) {
      const chunk = prepared.slice(i, i + BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const entry of chunk) {
        const ref = doc(db, 'vault', PUBLIC_VAULT_ID, 'entries', entry.id);
        batch.set(
          ref,
          toFirestoreEntryCreatePayload(entry, uid, serverTimestamp(), entry.sortOrder ?? 0)
        );
      }
      await batch.commit();
    }

    await saveColumnsToCloud(uid, sourceColumns);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, entriesPath);
  }
}
