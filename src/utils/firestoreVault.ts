import {
  collection,
  doc,
  getDoc,
  getDocs,
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
import { OperationType, db, handleFirestoreError } from '../firebase';
import {
  DEFAULT_COLUMNS,
  MAX_COLUMN_LABEL_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  fromFirestoreEntryDoc,
  normalizeUrl,
  sanitizeColumns,
  sanitizeEntryId,
  sortEntriesByOrder,
  toFirestoreColumnPayload,
  toFirestoreEntryCreatePayload,
  type ColumnConfig,
  type ColumnId,
  type VaultEntry,
} from './links';

const BATCH_CHUNK_SIZE = 400;

function prepareEntriesForCloud(rawEntries: VaultEntry[]): VaultEntry[] {
  // Ensure IDs match Firestore rules regex and repair any orphaned parent references
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

export function subscribeToVaultEntries(
  uid: string,
  onEntries: (entries: VaultEntry[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${uid}/entries`;
  const q = query(collection(db, 'users', uid, 'entries'), where('ownerId', '==', uid));

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

export function subscribeToColumnSettings(
  uid: string,
  onColumns: (columns: ColumnConfig[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${uid}/meta/columns`;
  const ref = doc(db, 'users', uid, 'meta', 'columns');

  return onSnapshot(
    ref,
    (snapshot) => {
      if (!snapshot.exists()) {
        onColumns(DEFAULT_COLUMNS);
        return;
      }
      const data = snapshot.data();
      onColumns(
        sanitizeColumns([
          { id: 'CRE', label: data.creLabel },
          { id: 'JAY', label: data.jayLabel },
          { id: 'OTHER', label: data.otherLabel },
        ])
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
  const path = `users/${uid}/entries/${safeId}`;
  const payload = toFirestoreEntryCreatePayload(
    { ...entry, id: safeId, sortOrder },
    uid,
    serverTimestamp(),
    sortOrder
  );

  try {
    await setDoc(doc(db, 'users', uid, 'entries', safeId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateVaultEntryDetailsInCloud(
  uid: string,
  entry: VaultEntry
): Promise<void> {
  const safeId = sanitizeEntryId(entry.id, entry.kind);
  const path = `users/${uid}/entries/${safeId}`;
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
    await updateDoc(doc(db, 'users', uid, 'entries', safeId), updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function reorderVaultEntriesInCloud(
  uid: string,
  entries: Array<{ id: string; columnId: ColumnId; parentId?: string | null; sortOrder: number; kind: VaultEntry['kind'] }>
): Promise<void> {
  if (entries.length === 0) return;
  const basePath = `users/${uid}/entries`;

  try {
    for (let i = 0; i < entries.length; i += BATCH_CHUNK_SIZE) {
      const chunk = entries.slice(i, i + BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const ref = doc(db, 'users', uid, 'entries', item.id);
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
  uid: string,
  sectionId: string,
  isOpen: boolean
): Promise<void> {
  const path = `users/${uid}/entries/${sectionId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'entries', sectionId), {
      isOpen,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function trackLinkClickInCloud(
  uid: string,
  linkId: string
): Promise<void> {
  const path = `users/${uid}/entries/${linkId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'entries', linkId), {
      clicks: increment(1),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteVaultEntriesInCloud(
  uid: string,
  idsToDelete: string[]
): Promise<void> {
  if (idsToDelete.length === 0) return;
  const basePath = `users/${uid}/entries`;

  try {
    for (let i = 0; i < idsToDelete.length; i += BATCH_CHUNK_SIZE) {
      const chunk = idsToDelete.slice(i, i + BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.delete(doc(db, 'users', uid, 'entries', id));
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
  const path = `users/${uid}/meta/columns`;
  const ref = doc(db, 'users', uid, 'meta', 'columns');
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
  const entriesPath = `users/${uid}/entries`;
  try {
    const existingSnap = await getDocs(
      query(collection(db, 'users', uid, 'entries'), where('ownerId', '==', uid))
    );
    const existingIds = existingSnap.docs.map((d) => d.id);

    for (let i = 0; i < existingIds.length; i += BATCH_CHUNK_SIZE) {
      const chunk = existingIds.slice(i, i + BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.delete(doc(db, 'users', uid, 'entries', id));
      }
      await batch.commit();
    }

    const prepared = orderContainersFirst(prepareEntriesForCloud(nextEntries));
    for (let i = 0; i < prepared.length; i += BATCH_CHUNK_SIZE) {
      const chunk = prepared.slice(i, i + BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const entry of chunk) {
        const ref = doc(db, 'users', uid, 'entries', entry.id);
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

export async function migrateLocalDataIfCloudEmpty(
  uid: string,
  localEntries: VaultEntry[],
  localColumns: ColumnConfig[]
): Promise<boolean> {
  const entriesPath = `users/${uid}/entries`;
  try {
    const existingSnap = await getDocs(
      query(collection(db, 'users', uid, 'entries'), where('ownerId', '==', uid))
    );
    const columnsSnap = await getDoc(doc(db, 'users', uid, 'meta', 'columns'));

    let migrated = false;

    if (existingSnap.empty && localEntries.length > 0) {
      const prepared = orderContainersFirst(prepareEntriesForCloud(localEntries));
      for (let i = 0; i < prepared.length; i += BATCH_CHUNK_SIZE) {
        const chunk = prepared.slice(i, i + BATCH_CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const entry of chunk) {
          const ref = doc(db, 'users', uid, 'entries', entry.id);
          batch.set(
            ref,
            toFirestoreEntryCreatePayload(entry, uid, serverTimestamp(), entry.sortOrder ?? 0)
          );
        }
        await batch.commit();
      }
      migrated = true;
    }

    if (!columnsSnap.exists()) {
      await saveColumnsToCloud(uid, localColumns);
    }

    return migrated;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, entriesPath);
  }
}
