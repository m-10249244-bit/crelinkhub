export type ColumnId = 'CRE' | 'JAY' | 'OTHER';
export type EntryKind = 'link' | 'folder' | 'section';

export interface ColumnConfig {
  id: ColumnId;
  label: string;
}

interface BaseEntry {
  id: string;
  kind: EntryKind;
  columnId: ColumnId;
  parentId?: string | null;
  title: string;
  sortOrder?: number;
  createdAt: number;
}

export interface LinkEntry extends BaseEntry {
  kind: 'link';
  url: string;
  clicks: number;
}

export interface FolderEntry extends BaseEntry {
  kind: 'folder';
}

export interface SectionEntry extends BaseEntry {
  kind: 'section';
  isOpen: boolean;
}

export type VaultEntry = LinkEntry | FolderEntry | SectionEntry;

export interface EntryFormInput {
  kind: EntryKind;
  title: string;
  url: string;
  columnId: ColumnId;
  parentId?: string | null;
}

export interface ValidationErrors {
  title?: string;
  url?: string;
  columnId?: string;
}

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'CRE', label: 'CRE' },
  { id: 'JAY', label: 'JAY' },
  { id: 'OTHER', label: 'OTHER' },
];

export const MIN_SLOTS_PER_COLUMN = 8;
export const MIN_SLOTS_IN_FOLDER = 6;

export const SEED_ENTRIES: VaultEntry[] = [
  {
    id: 'seed-cre-1',
    kind: 'link',
    columnId: 'CRE',
    parentId: null,
    title: 'Google Drive',
    url: 'https://drive.google.com',
    clicks: 0,
    createdAt: 1700000001000,
  },
  {
    id: 'seed-cre-2',
    kind: 'link',
    columnId: 'CRE',
    parentId: null,
    title: 'Canva Studio',
    url: 'https://www.canva.com',
    clicks: 0,
    createdAt: 1700000002000,
  },
  {
    id: 'seed-jay-1',
    kind: 'link',
    columnId: 'JAY',
    parentId: null,
    title: 'YouTube',
    url: 'https://www.youtube.com',
    clicks: 0,
    createdAt: 1700000003000,
  },
  {
    id: 'seed-jay-2',
    kind: 'link',
    columnId: 'JAY',
    parentId: null,
    title: 'Gmail',
    url: 'https://mail.google.com',
    clicks: 0,
    createdAt: 1700000004000,
  },
  {
    id: 'seed-other-1',
    kind: 'link',
    columnId: 'OTHER',
    parentId: null,
    title: 'Notion',
    url: 'https://www.notion.so',
    clicks: 0,
    createdAt: 1700000005000,
  },
  {
    id: 'seed-other-2',
    kind: 'link',
    columnId: 'OTHER',
    parentId: null,
    title: 'GitHub',
    url: 'https://github.com',
    clicks: 0,
    createdAt: 1700000006000,
  },
];

const VALID_COLUMN_IDS: ReadonlySet<string> = new Set(['CRE', 'JAY', 'OTHER']);

// Synchronized verbatim with firebase-blueprint.json and firestore.rules
export const MAX_TITLE_LENGTH = 80;
export const MAX_URL_LENGTH = 2048;
export const MAX_COLUMN_LABEL_LENGTH = 24;
export const MAX_ID_LENGTH = 128;
export const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidColumnId(value: string): value is ColumnId {
  return VALID_COLUMN_IDS.has(value);
}

export function sanitizeEntryId(rawId: string, prefix = 'entry'): string {
  const trimmed = rawId.trim();
  if (VALID_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const cleaned = trimmed.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, MAX_ID_LENGTH);
  if (VALID_ID_PATTERN.test(cleaned)) {
    return cleaned;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Normalizes a user-entered URL by trimming whitespace and adding https:// if missing.
 * Rejects non-http(s) protocols such as javascript: or data:.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const explicitSchemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):/);
  if (explicitSchemeMatch) {
    const scheme = explicitSchemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return null;
    }
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      if (parsed.hostname !== 'localhost') {
        return null;
      }
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

export function validateEntryInput(input: EntryFormInput): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!input.title.trim()) {
    errors.title =
      input.kind === 'folder'
        ? 'Please enter a folder name.'
        : input.kind === 'section'
          ? 'Please enter a layer name.'
          : 'Please enter a name for this link.';
  } else if (input.title.trim().length > 80) {
    errors.title = 'Name must be 80 characters or fewer.';
  }

  if (input.kind === 'link') {
    const normalized = normalizeUrl(input.url);
    if (!input.url.trim()) {
      errors.url = 'Please enter a URL.';
    } else if (!normalized) {
      errors.url = 'Enter a valid web address (e.g. https://example.com).';
    }
  }

  if (!isValidColumnId(input.columnId)) {
    errors.columnId = 'Select a valid column.';
  }

  return errors;
}

export function getScopeEntries(
  entries: VaultEntry[],
  columnId: ColumnId,
  parentId: string | null = null
): VaultEntry[] {
  return entries.filter(
    (item) => item.columnId === columnId && (item.parentId ?? null) === parentId
  );
}

export function getFolderChildren(
  entries: VaultEntry[],
  folderId: string
): VaultEntry[] {
  return entries.filter((item) => (item.parentId ?? null) === folderId);
}

export function getSectionChildren(
  entries: VaultEntry[],
  sectionId: string
): VaultEntry[] {
  return entries.filter((item) => (item.parentId ?? null) === sectionId);
}

export function countDescendantLinks(
  entries: VaultEntry[],
  containerId: string
): number {
  let count = 0;
  for (const item of entries) {
    if ((item.parentId ?? null) === containerId) {
      if (item.kind === 'link') {
        count += 1;
      } else {
        count += countDescendantLinks(entries, item.id);
      }
    }
  }
  return count;
}

export function filterEntries(entries: VaultEntry[], query: string): VaultEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return entries;
  }
  return entries.filter((item) => {
    if (item.title.toLowerCase().includes(q)) {
      return true;
    }
    if (item.kind === 'link') {
      const domain = extractDomain(item.url).toLowerCase();
      return item.url.toLowerCase().includes(q) || domain.includes(q);
    }
    return false;
  });
}

export function moveEntryInScope(
  entries: VaultEntry[],
  id: string,
  direction: 'up' | 'down'
): VaultEntry[] {
  const target = entries.find((l) => l.id === id);
  if (!target) return entries;

  const targetParent = target.parentId ?? null;
  const siblingIndices: number[] = [];
  entries.forEach((item, idx) => {
    if (
      item.columnId === target.columnId &&
      (item.parentId ?? null) === targetParent
    ) {
      siblingIndices.push(idx);
    }
  });

  const posInScope = siblingIndices.findIndex((idx) => entries[idx].id === id);
  if (posInScope === -1) return entries;

  const swapPos = direction === 'up' ? posInScope - 1 : posInScope + 1;
  if (swapPos < 0 || swapPos >= siblingIndices.length) {
    return entries;
  }

  const idxA = siblingIndices[posInScope];
  const idxB = siblingIndices[swapPos];
  const next = [...entries];
  [next[idxA], next[idxB]] = [next[idxB], next[idxA]];
  return next;
}

function isDescendant(
  entries: VaultEntry[],
  potentialParentId: string,
  targetId: string
): boolean {
  let current = entries.find((e) => e.id === targetId);
  const visited = new Set<string>();
  while (current && current.parentId) {
    if (current.parentId === potentialParentId) return true;
    if (visited.has(current.parentId)) break;
    visited.add(current.parentId);
    current = entries.find((e) => e.id === current?.parentId);
  }
  return false;
}

/**
 * Moves a dragged entry before/after a target sibling or into target's scope.
 */
export function reorderEntryOntoTarget(
  entries: VaultEntry[],
  draggedId: string,
  targetId: string
): VaultEntry[] {
  if (draggedId === targetId) return entries;
  const dragged = entries.find((l) => l.id === draggedId);
  const target = entries.find((l) => l.id === targetId);
  if (!dragged || !target) return entries;

  // Prevent dropping a folder/section into its own descendant
  if (dragged.kind !== 'link' && isDescendant(entries, dragged.id, target.id)) {
    return entries;
  }

  const draggedIdx = entries.findIndex((l) => l.id === draggedId);
  const originalTargetIdx = entries.findIndex((l) => l.id === targetId);

  const withoutDragged = entries.filter((l) => l.id !== draggedId);
  const targetIdx = withoutDragged.findIndex((l) => l.id === targetId);
  if (targetIdx === -1) return entries;

  const sameScope =
    dragged.columnId === target.columnId &&
    (dragged.parentId ?? null) === (target.parentId ?? null);

  const updatedDragged: VaultEntry = {
    ...dragged,
    columnId: target.columnId,
    parentId: target.parentId ?? null,
  };

  const insertAt =
    sameScope && draggedIdx < originalTargetIdx ? targetIdx + 1 : targetIdx;

  const next = [...withoutDragged];
  next.splice(insertAt, 0, updatedDragged);
  return next;
}

/**
 * Moves a dragged entry to a target column (and optional parent container).
 */
export function moveEntryToScope(
  entries: VaultEntry[],
  draggedId: string,
  targetColumnId: ColumnId,
  targetParentId: string | null = null
): VaultEntry[] {
  const dragged = entries.find((l) => l.id === draggedId);
  if (!dragged) return entries;
  if (draggedId === targetParentId) return entries;
  if (
    targetParentId &&
    dragged.kind !== 'link' &&
    isDescendant(entries, dragged.id, targetParentId)
  ) {
    return entries;
  }

  const withoutDragged = entries.filter((l) => l.id !== draggedId);
  const updatedDragged: VaultEntry = {
    ...dragged,
    columnId: targetColumnId,
    parentId: targetParentId,
  };
  return [...withoutDragged, updatedDragged];
}

export function deleteEntryCascade(
  entries: VaultEntry[],
  id: string
): VaultEntry[] {
  const toDelete = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of entries) {
      if (item.parentId && toDelete.has(item.parentId) && !toDelete.has(item.id)) {
        toDelete.add(item.id);
        changed = true;
      }
    }
  }
  return entries.filter((item) => !toDelete.has(item.id));
}

export function sanitizeColumns(rawColumns: unknown): ColumnConfig[] {
  if (!Array.isArray(rawColumns)) {
    return DEFAULT_COLUMNS;
  }
  const map = new Map<ColumnId, string>();
  for (const col of rawColumns) {
    if (
      col &&
      typeof col === 'object' &&
      'id' in col &&
      'label' in col &&
      typeof col.id === 'string' &&
      isValidColumnId(col.id) &&
      typeof col.label === 'string' &&
      col.label.trim().length > 0
    ) {
      map.set(col.id, col.label.trim().slice(0, 24));
    }
  }
  return DEFAULT_COLUMNS.map((def) => ({
    id: def.id,
    label: map.get(def.id) ?? def.label,
  }));
}

export function sanitizeEntries(rawEntries: unknown): VaultEntry[] {
  if (!Array.isArray(rawEntries)) {
    return [];
  }
  const sanitized: VaultEntry[] = [];
  for (const item of rawEntries) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title =
      typeof rec.title === 'string'
        ? rec.title.trim().slice(0, MAX_TITLE_LENGTH)
        : '';
    if (!title) continue;

    const columnId =
      typeof rec.columnId === 'string' && isValidColumnId(rec.columnId)
        ? rec.columnId
        : 'OTHER';
    const parentId =
      typeof rec.parentId === 'string' && rec.parentId.trim()
        ? sanitizeEntryId(rec.parentId.trim(), 'parent')
        : null;
    const id =
      typeof rec.id === 'string' && rec.id.trim()
        ? sanitizeEntryId(rec.id, 'imp')
        : `imp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const createdAt =
      typeof rec.createdAt === 'number' && Number.isFinite(rec.createdAt)
        ? rec.createdAt
        : Date.now();
    const sortOrder =
      typeof rec.sortOrder === 'number' &&
      Number.isFinite(rec.sortOrder) &&
      rec.sortOrder >= -1000000 &&
      rec.sortOrder <= 1000000000
        ? rec.sortOrder
        : undefined;

    const rawKind = rec.kind;
    if (rawKind === 'folder') {
      sanitized.push({
        id,
        kind: 'folder',
        columnId,
        parentId: null,
        title,
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        createdAt,
      });
    } else if (rawKind === 'section') {
      sanitized.push({
        id,
        kind: 'section',
        columnId,
        parentId,
        title,
        isOpen: typeof rec.isOpen === 'boolean' ? rec.isOpen : true,
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        createdAt,
      });
    } else {
      const url = typeof rec.url === 'string' ? normalizeUrl(rec.url) : null;
      if (!url || url.length > MAX_URL_LENGTH) continue;
      sanitized.push({
        id,
        kind: 'link',
        columnId,
        parentId,
        title,
        url,
        clicks:
          typeof rec.clicks === 'number' && Number.isFinite(rec.clicks) && rec.clicks >= 0
            ? Math.min(1000000000, Math.floor(rec.clicks))
            : 0,
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        createdAt,
      });
    }
  }
  return sanitized;
}

export function withReindexedSortOrder(entries: VaultEntry[]): VaultEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    sortOrder: index,
  }));
}

export function sortEntriesByOrder(entries: VaultEntry[]): VaultEntry[] {
  return [...entries].sort((a, b) => {
    const orderA = a.sortOrder ?? a.createdAt;
    const orderB = b.sortOrder ?? b.createdAt;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.createdAt - b.createdAt;
  });
}

export const VAULT_EDITOR_EMAIL = 'm-10249244@moe-dl.edu.my';

export function isAuthorizedEditorEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === VAULT_EDITOR_EMAIL.toLowerCase();
}

export interface FirestoreVaultEntryPayload<TTime = unknown> {
  ownerId: string;
  isPublic: boolean;
  kind: EntryKind;
  columnId: ColumnId;
  parentId: string;
  title: string;
  url: string;
  clicks: number;
  isOpen: boolean;
  sortOrder: number;
  createdAt: TTime;
  updatedAt: TTime;
}

export function toFirestoreEntryCreatePayload<TTime>(
  entry: VaultEntry,
  ownerId: string,
  timestampValue: TTime,
  fallbackSortOrder = 0
): FirestoreVaultEntryPayload<TTime> {
  const safeTitle = entry.title.trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled';
  const safeParentId =
    entry.kind === 'folder' || !entry.parentId
      ? ''
      : sanitizeEntryId(entry.parentId, 'parent');
  const rawOrder = entry.sortOrder ?? fallbackSortOrder;
  const safeSortOrder =
    Number.isFinite(rawOrder) && rawOrder >= -1000000 && rawOrder <= 1000000000
      ? rawOrder
      : fallbackSortOrder;

  if (entry.kind === 'link') {
    const safeUrl = (normalizeUrl(entry.url) ?? 'https://example.com').slice(0, MAX_URL_LENGTH);
    return {
      ownerId,
      isPublic: true,
      kind: 'link',
      columnId: isValidColumnId(entry.columnId) ? entry.columnId : 'OTHER',
      parentId: safeParentId,
      title: safeTitle,
      url: safeUrl,
      clicks:
        Number.isFinite(entry.clicks) && entry.clicks >= 0
          ? Math.min(1000000000, Math.floor(entry.clicks))
          : 0,
      isOpen: true,
      sortOrder: safeSortOrder,
      createdAt: timestampValue,
      updatedAt: timestampValue,
    };
  }

  return {
    ownerId,
    isPublic: true,
    kind: entry.kind,
    columnId: isValidColumnId(entry.columnId) ? entry.columnId : 'OTHER',
    parentId: safeParentId,
    title: safeTitle,
    url: '',
    clicks: 0,
    isOpen: entry.kind === 'section' ? entry.isOpen : true,
    sortOrder: safeSortOrder,
    createdAt: timestampValue,
    updatedAt: timestampValue,
  };
}

export function toFirestoreColumnPayload<TTime>(
  columns: ColumnConfig[],
  ownerId: string,
  timestampValue: TTime
): {
  ownerId: string;
  isPublic: boolean;
  creLabel: string;
  jayLabel: string;
  otherLabel: string;
  updatedAt: TTime;
} {
  const safe = sanitizeColumns(columns);
  const getLabel = (id: ColumnId, def: string) =>
    (safe.find((c) => c.id === id)?.label ?? def).trim().slice(0, MAX_COLUMN_LABEL_LENGTH) || def;
  return {
    ownerId,
    isPublic: true,
    creLabel: getLabel('CRE', 'CRE'),
    jayLabel: getLabel('JAY', 'JAY'),
    otherLabel: getLabel('OTHER', 'OTHER'),
    updatedAt: timestampValue,
  };
}

function coerceTimestampMillis(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: unknown }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export function fromFirestoreEntryDoc(
  docId: string,
  rawData: Record<string, unknown>
): VaultEntry | null {
  const createdAt = coerceTimestampMillis(rawData.createdAt);
  const list = sanitizeEntries([
    {
      ...rawData,
      id: docId,
      createdAt,
      parentId: rawData.parentId === '' ? null : rawData.parentId,
    },
  ]);
  return list[0] ?? null;
}

export function parseFirestoreRestFields(
  fields: Record<string, Record<string, unknown>> | undefined
): Record<string, unknown> {
  if (!fields || typeof fields !== 'object') return {};
  const result: Record<string, unknown> = {};
  for (const [key, typedVal] of Object.entries(fields)) {
    if (!typedVal || typeof typedVal !== 'object') continue;
    if ('stringValue' in typedVal && typeof typedVal.stringValue === 'string') {
      result[key] = typedVal.stringValue;
    } else if ('booleanValue' in typedVal && typeof typedVal.booleanValue === 'boolean') {
      result[key] = typedVal.booleanValue;
    } else if ('integerValue' in typedVal) {
      const n = Number(typedVal.integerValue);
      if (Number.isFinite(n)) result[key] = n;
    } else if ('doubleValue' in typedVal) {
      const n = Number(typedVal.doubleValue);
      if (Number.isFinite(n)) result[key] = n;
    } else if ('timestampValue' in typedVal && typeof typedVal.timestampValue === 'string') {
      const ms = Date.parse(typedVal.timestampValue);
      result[key] = Number.isFinite(ms) ? ms : Date.now();
    }
  }
  return result;
}

export function fromFirestoreRestEntryDoc(doc: {
  name?: string;
  fields?: Record<string, Record<string, unknown>>;
}): VaultEntry | null {
  if (!doc.name || !doc.fields) return null;
  const segments = doc.name.split('/');
  const docId = segments[segments.length - 1];
  if (!docId) return null;
  return fromFirestoreEntryDoc(docId, parseFirestoreRestFields(doc.fields));
}

export function parseImportedBackup(rawJson: string): {
  entries: VaultEntry[];
  columns: ColumnConfig[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid JSON file. Please choose a valid JAYTINSTORE backup.');
  }

  let rawEntries: unknown;
  let rawColumns: unknown;

  if (Array.isArray(parsed)) {
    rawEntries = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if ('entries' in obj) {
      rawEntries = obj.entries;
      rawColumns = obj.columns;
    } else if ('links' in obj) {
      rawEntries = obj.links;
      rawColumns = obj.columns;
    } else {
      throw new Error('Backup file must contain an "entries" or "links" array.');
    }
  } else {
    throw new Error('Backup file must contain an "entries" or "links" array.');
  }

  if (!Array.isArray(rawEntries)) {
    throw new Error('Backup entries field must be a list.');
  }

  return {
    entries: sanitizeEntries(rawEntries),
    columns: sanitizeColumns(rawColumns),
  };
}
