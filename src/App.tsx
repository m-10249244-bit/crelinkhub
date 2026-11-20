import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Plus, SearchX, X } from 'lucide-react';
import { BackupModal } from './components/BackupModal';
import { HeaderBar } from './components/HeaderBar';
import { LinkModal } from './components/LinkModal';
import { EmptyLinkSlot, EntryRow } from './components/LinkSlot';
import { StickerHeading } from './components/StickerHeading';
import { WatermarkBackground } from './components/WatermarkBackground';
import { auth, googleProvider } from './firebase';
import {
  createVaultEntryInCloud,
  deleteVaultEntriesInCloud,
  migrateLocalDataIfCloudEmpty,
  reorderVaultEntriesInCloud,
  replaceAllVaultDataInCloud,
  saveColumnsToCloud,
  subscribeToColumnSettings,
  subscribeToVaultEntries,
  toggleSectionInCloud,
  trackLinkClickInCloud,
  updateVaultEntryDetailsInCloud,
} from './utils/firestoreVault';
import {
  DEFAULT_COLUMNS,
  MIN_SLOTS_IN_FOLDER,
  MIN_SLOTS_PER_COLUMN,
  SEED_ENTRIES,
  deleteEntryCascade,
  filterEntries,
  getFolderChildren,
  getScopeEntries,
  moveEntryInScope,
  moveEntryToScope,
  normalizeUrl,
  reorderEntryOntoTarget,
  sanitizeColumns,
  sanitizeEntries,
  withReindexedSortOrder,
  type ColumnConfig,
  type ColumnId,
  type EntryFormInput,
  type EntryKind,
  type FolderEntry,
  type SectionEntry,
  type VaultEntry,
} from './utils/links';

const LINKS_STORAGE_KEY = 'jaytinstore.links.v1';
const COLUMNS_STORAGE_KEY = 'jaytinstore.columns.v1';

function loadInitialEntries(): VaultEntry[] {
  try {
    const raw = localStorage.getItem(LINKS_STORAGE_KEY);
    if (raw === null) {
      return SEED_ENTRIES;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return sanitizeEntries(parsed);
    }
  } catch {
    // Fall back to seed data if storage is unavailable or corrupted
  }
  return SEED_ENTRIES;
}

function loadInitialColumns(): ColumnConfig[] {
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    return sanitizeColumns(JSON.parse(raw));
  } catch {
    return DEFAULT_COLUMNS;
  }
}

export default function App() {
  const [entries, setEntries] = useState<VaultEntry[]>(loadInitialEntries);
  const [columns, setColumns] = useState<ColumnConfig[]>(loadInitialColumns);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileColumn, setMobileColumn] = useState<ColumnId>('CRE');
  const [isEditMode, setIsEditMode] = useState(false);

  // Single-page Folder navigation state
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  // Drag-and-drop state (active in Edit Mode)
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<ColumnId | null>(null);

  // Add / Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalColumnId, setModalColumnId] = useState<ColumnId>('CRE');
  const [modalParentId, setModalParentId] = useState<string | null>(null);
  const [modalInitialKind, setModalInitialKind] = useState<EntryKind>('link');
  const [editingEntry, setEditingEntry] = useState<VaultEntry | null>(null);

  // Manage / Backup modal state
  const [backupModalOpen, setBackupModalOpen] = useState(false);

  // Firebase Auth & Cloud Sync state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [asyncError, setAsyncError] = useState<Error | null>(null);
  const migratedUidRef = useRef<Set<string>>(new Set());

  if (asyncError) {
    throw asyncError;
  }

  const isCloudActive = Boolean(user && user.emailVerified);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser && !nextUser.emailVerified) {
        setAuthNotice('Please verify your Google account email to enable cloud sync.');
      } else {
        setAuthNotice(null);
      }
      if (!nextUser) {
        setEntries(loadInitialEntries());
        setColumns(loadInitialColumns());
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !user.emailVerified) return;
    const uid = user.uid;

    let cancelled = false;
    let unsubEntries: (() => void) | undefined;
    let unsubColumns: (() => void) | undefined;

    const startSync = async () => {
      if (!migratedUidRef.current.has(uid)) {
        migratedUidRef.current.add(uid);
        try {
          await migrateLocalDataIfCloudEmpty(uid, entries, columns);
        } catch (err) {
          if (!cancelled) {
            setAsyncError(err instanceof Error ? err : new Error(String(err)));
          }
          return;
        }
      }

      if (cancelled) return;

      unsubEntries = subscribeToVaultEntries(
        uid,
        (cloudEntries) => {
          setEntries(cloudEntries);
        },
        (err) => setAsyncError(err)
      );

      unsubColumns = subscribeToColumnSettings(
        uid,
        (cloudColumns) => {
          setColumns(cloudColumns);
        },
        (err) => setAsyncError(err)
      );
    };

    void startSync();

    return () => {
      cancelled = true;
      unsubEntries?.();
      unsubColumns?.();
    };
    // Intentionally keyed to authenticated verified UID so initial local entries snapshot is migrated once on sign-in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, user?.emailVerified]);

  useEffect(() => {
    if (isCloudActive) return;
    try {
      localStorage.setItem(LINKS_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Ignore storage quota errors
    }
  }, [entries, isCloudActive]);

  useEffect(() => {
    if (isCloudActive) return;
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns));
    } catch {
      // Ignore storage quota errors
    }
  }, [columns, isCloudActive]);

  // If the active folder was deleted or removed, return safely to main 3-column view
  const activeFolder = useMemo(
    () =>
      activeFolderId
        ? (entries.find(
            (e): e is FolderEntry => e.id === activeFolderId && e.kind === 'folder'
          ) ?? null)
        : null,
    [activeFolderId, entries]
  );

  useEffect(() => {
    if (activeFolderId && !activeFolder) {
      setActiveFolderId(null);
    }
  }, [activeFolderId, activeFolder]);

  const filteredEntries = useMemo(
    () => filterEntries(entries, searchQuery),
    [entries, searchQuery]
  );

  const isSearching = searchQuery.trim().length > 0;

  const openAddModal = (
    columnId: ColumnId = 'CRE',
    parentId: string | null = null,
    kind: EntryKind = 'link'
  ) => {
    setEditingEntry(null);
    setModalColumnId(columnId);
    setModalParentId(parentId);
    setModalInitialKind(kind);
    setModalOpen(true);
  };

  const openEditModal = (entry: VaultEntry) => {
    setEditingEntry(entry);
    setModalColumnId(entry.columnId);
    setModalParentId(entry.parentId ?? null);
    setModalInitialKind(entry.kind);
    setModalOpen(true);
  };

  const handleSignIn = async () => {
    setAuthBusy(true);
    setAuthNotice(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : '';
      if (
        code !== 'auth/popup-closed-by-user' &&
        code !== 'auth/cancelled-popup-request'
      ) {
        setAuthNotice(
          err instanceof Error
            ? err.message
            : 'Unable to complete Google sign-in.'
        );
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setAuthBusy(true);
    setAuthNotice(null);
    try {
      await signOut(auth);
      setActiveFolderId(null);
    } catch (err) {
      setAuthNotice(
        err instanceof Error ? err.message : 'Unable to sign out right now.'
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const runCloudTask = (task: Promise<unknown>) => {
    void task.catch((err) => {
      setAsyncError(err instanceof Error ? err : new Error(String(err)));
    });
  };

  const handleSaveEntry = (input: EntryFormInput, editingId?: string) => {
    const cleanedTitle = input.title.trim();
    const nextSortOrder =
      entries.reduce((max, item) => Math.max(max, item.sortOrder ?? -1), -1) + 1;

    if (input.kind === 'link') {
      const normalized = normalizeUrl(input.url);
      if (!normalized) return;

      if (editingId) {
        const existing = entries.find(
          (item): item is VaultEntry & { kind: 'link' } =>
            item.id === editingId && item.kind === 'link'
        );
        if (!existing) return;
        const updated: VaultEntry = {
          ...existing,
          title: cleanedTitle,
          url: normalized,
          columnId: input.columnId,
          parentId: input.parentId ?? null,
        };
        setEntries((prev) =>
          prev.map((item) => (item.id === editingId ? updated : item))
        );
        if (isCloudActive && user) {
          runCloudTask(updateVaultEntryDetailsInCloud(user.uid, updated));
        }
      } else {
        const newLink: VaultEntry = {
          id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind: 'link',
          columnId: input.columnId,
          parentId: input.parentId ?? null,
          title: cleanedTitle,
          url: normalized,
          clicks: 0,
          sortOrder: nextSortOrder,
          createdAt: Date.now(),
        };
        setEntries((prev) => [...prev, newLink]);
        if (isCloudActive && user) {
          runCloudTask(createVaultEntryInCloud(user.uid, newLink, nextSortOrder));
        }
      }
    } else if (input.kind === 'folder') {
      if (editingId) {
        const existing = entries.find(
          (item): item is FolderEntry =>
            item.id === editingId && item.kind === 'folder'
        );
        if (!existing) return;
        const updated: FolderEntry = {
          ...existing,
          title: cleanedTitle,
          columnId: input.columnId,
        };
        setEntries((prev) =>
          prev.map((item) => (item.id === editingId ? updated : item))
        );
        if (isCloudActive && user) {
          runCloudTask(updateVaultEntryDetailsInCloud(user.uid, updated));
        }
      } else {
        const newFolder: VaultEntry = {
          id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind: 'folder',
          columnId: input.columnId,
          parentId: null,
          title: cleanedTitle,
          sortOrder: nextSortOrder,
          createdAt: Date.now(),
        };
        setEntries((prev) => [...prev, newFolder]);
        if (isCloudActive && user) {
          runCloudTask(createVaultEntryInCloud(user.uid, newFolder, nextSortOrder));
        }
      }
    } else {
      if (editingId) {
        const existing = entries.find(
          (item): item is SectionEntry =>
            item.id === editingId && item.kind === 'section'
        );
        if (!existing) return;
        const updated: SectionEntry = {
          ...existing,
          title: cleanedTitle,
          columnId: input.columnId,
          parentId: input.parentId ?? null,
        };
        setEntries((prev) =>
          prev.map((item) => (item.id === editingId ? updated : item))
        );
        if (isCloudActive && user) {
          runCloudTask(updateVaultEntryDetailsInCloud(user.uid, updated));
        }
      } else {
        const newSection: VaultEntry = {
          id: `section-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind: 'section',
          columnId: input.columnId,
          parentId: input.parentId ?? null,
          title: cleanedTitle,
          isOpen: true,
          sortOrder: nextSortOrder,
          createdAt: Date.now(),
        };
        setEntries((prev) => [...prev, newSection]);
        if (isCloudActive && user) {
          runCloudTask(createVaultEntryInCloud(user.uid, newSection, nextSortOrder));
        }
      }
    }

    setModalOpen(false);
    setEditingEntry(null);
  };

  const handleDeleteEntry = (entry: VaultEntry) => {
    const next = deleteEntryCascade(entries, entry.id);
    const remainingIds = new Set(next.map((item) => item.id));
    const deletedIds = entries
      .filter((item) => !remainingIds.has(item.id))
      .map((item) => item.id);

    setEntries(next);
    if (isCloudActive && user && deletedIds.length > 0) {
      runCloudTask(deleteVaultEntriesInCloud(user.uid, deletedIds));
    }
  };

  const handleTrackClick = (id: string) => {
    setEntries((prev) =>
      prev.map((item) =>
        item.id === id && item.kind === 'link'
          ? { ...item, clicks: item.clicks + 1 }
          : item
      )
    );
    if (isCloudActive && user) {
      runCloudTask(trackLinkClickInCloud(user.uid, id));
    }
  };

  const handleToggleSection = (id: string) => {
    const target = entries.find(
      (item): item is SectionEntry => item.id === id && item.kind === 'section'
    );
    if (!target) return;
    const nextOpen = !target.isOpen;
    setEntries((prev) =>
      prev.map((item) =>
        item.id === id && item.kind === 'section'
          ? { ...item, isOpen: nextOpen }
          : item
      )
    );
    if (isCloudActive && user) {
      runCloudTask(toggleSectionInCloud(user.uid, id, nextOpen));
    }
  };

  const commitReorderedEntries = (nextList: VaultEntry[]) => {
    const reindexed = withReindexedSortOrder(nextList);
    const prevMap = new Map(entries.map((item) => [item.id, item]));
    const changed = reindexed.filter((item) => {
      const prev = prevMap.get(item.id);
      return (
        !prev ||
        prev.columnId !== item.columnId ||
        (prev.parentId ?? null) !== (item.parentId ?? null) ||
        prev.sortOrder !== item.sortOrder
      );
    });

    setEntries(reindexed);
    if (isCloudActive && user && changed.length > 0) {
      runCloudTask(
        reorderVaultEntriesInCloud(
          user.uid,
          changed.map((item) => ({
            id: item.id,
            columnId: item.columnId,
            parentId: item.parentId ?? null,
            sortOrder: item.sortOrder ?? 0,
            kind: item.kind,
          }))
        )
      );
    }
  };

  const handleMoveEntry = (id: string, direction: 'up' | 'down') => {
    commitReorderedEntries(moveEntryInScope(entries, id, direction));
  };

  const clearDragState = () => {
    setDraggedId(null);
    setDragOverId(null);
    setDragOverColumnId(null);
  };

  const handleDropOnSlot = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId = draggedId || e.dataTransfer.getData('text/plain');
    if (sourceId && sourceId !== targetId) {
      commitReorderedEntries(reorderEntryOntoTarget(entries, sourceId, targetId));
    }
    clearDragState();
  };

  const handleDropOnScope = (
    e: React.DragEvent,
    columnId: ColumnId,
    parentId: string | null = null
  ) => {
    e.preventDefault();
    const sourceId = draggedId || e.dataTransfer.getData('text/plain');
    if (sourceId) {
      commitReorderedEntries(
        moveEntryToScope(entries, sourceId, columnId, parentId)
      );
    }
    clearDragState();
  };

  const editingScopePosition = useMemo(() => {
    if (!editingEntry) return { canMoveUp: false, canMoveDown: false };
    const siblings = getScopeEntries(
      entries,
      editingEntry.columnId,
      editingEntry.parentId ?? null
    );
    const idx = siblings.findIndex((e) => e.id === editingEntry.id);
    return {
      canMoveUp: idx > 0,
      canMoveDown: idx !== -1 && idx < siblings.length - 1,
    };
  }, [editingEntry, entries]);

  const totalLinksCount = useMemo(
    () => entries.filter((e) => e.kind === 'link').length,
    [entries]
  );

  const sharedRowHandlers = {
    isEditMode,
    draggedId,
    dragOverId,
    onTrackClick: handleTrackClick,
    onOpenFolder: (folder: FolderEntry) => {
      setSearchQuery('');
      setActiveFolderId(folder.id);
    },
    onToggleSection: handleToggleSection,
    onAddInsideSection: (section: SectionEntry) =>
      openAddModal(section.columnId, section.id, 'link'),
    onEdit: openEditModal,
    onDelete: handleDeleteEntry,
    onMove: handleMoveEntry,
    onDragStart: (id: string) => setDraggedId(id),
    onDragOverSlot: (e: React.DragEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverId(id);
    },
    onDropOnSlot: handleDropOnSlot,
    onDragEnd: clearDragState,
  };

  return (
    <div id="top" className="relative min-h-screen flex flex-col bg-white text-zinc-950">
      <WatermarkBackground />

      <HeaderBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isEditMode={isEditMode}
        onToggleEditMode={() => {
          setIsEditMode((prev) => !prev);
          clearDragState();
        }}
        onOpenAddModal={() =>
          activeFolder
            ? openAddModal(activeFolder.columnId, activeFolder.id, 'link')
            : openAddModal(mobileColumn, null, 'link')
        }
        onOpenBackupModal={() => setBackupModalOpen(true)}
        totalLinks={totalLinksCount}
        user={user}
        authReady={authReady}
        authBusy={authBusy}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
      />

      {authNotice && (
        <div
          role="alert"
          className="relative z-10 flex items-center justify-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-950"
        >
          <span>{authNotice}</span>
          <button
            type="button"
            onClick={() => setAuthNotice(null)}
            aria-label="Dismiss notification"
            className="p-0.5 rounded hover:bg-amber-200/60 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {isEditMode && (
        <div
          role="status"
          className="relative z-10 border-b border-zinc-300 bg-zinc-100/95 px-4 py-2 text-center text-xs font-medium text-zinc-800"
        >
          Edit Mode active — drag items to reorder or move between columns, or use the arrow, edit, and delete controls. Click <strong>Done</strong> when finished.
        </div>
      )}

      {/* Main Content: Either Search Results, Single-Page Folder View, or 3-Column Home */}
      <main className="relative z-10 flex-1 flex flex-col">
        {isSearching ? (
          filteredEntries.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
              <div className="rounded-2xl border-2 border-black bg-white/95 p-8 max-w-md w-full shadow-sm">
                <SearchX className="h-9 w-9 mx-auto text-zinc-700 mb-3" aria-hidden="true" />
                <h2 className="text-lg font-bold text-zinc-950">No matching items</h2>
                <p className="mt-1.5 text-sm text-zinc-600">
                  Nothing matched &ldquo;{searchQuery}&rdquo;. Try another keyword or clear your search.
                </p>
                <div className="mt-5 flex items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="h-10 px-4 text-sm font-semibold text-white bg-black rounded-xl hover:bg-zinc-800 cursor-pointer"
                  >
                    Clear Search
                  </button>
                  <button
                    type="button"
                    onClick={() => openAddModal('CRE', null, 'link')}
                    className="h-10 px-4 text-sm font-medium text-zinc-800 bg-white border border-zinc-300 rounded-xl hover:border-black cursor-pointer"
                  >
                    Add New Link
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-2xl px-5 sm:px-8 py-8 space-y-4">
              <div className="flex items-center justify-between border-b-2 border-black pb-3">
                <h2 className="text-base font-bold text-zinc-950 tabular-nums">
                  Search Results ({filteredEntries.length})
                </h2>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs font-semibold text-zinc-700 hover:text-black cursor-pointer"
                >
                  Clear search
                </button>
              </div>
              <div className="space-y-3.5">
                {filteredEntries.map((entry) => {
                  const colLabel =
                    columns.find((c) => c.id === entry.columnId)?.label ??
                    entry.columnId;
                  const parentLabel = entry.parentId
                    ? entries.find((e) => e.id === entry.parentId)?.title
                    : null;
                  return (
                    <div key={entry.id} className="space-y-1">
                      <p className="px-2 text-xs font-medium text-zinc-500">
                        {colLabel}
                        {parentLabel ? ` / ${parentLabel}` : ''}
                      </p>
                      <EntryRow
                        entry={entry}
                        allEntries={entries}
                        canMoveUp={false}
                        canMoveDown={false}
                        disableReorder
                        {...sharedRowHandlers}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : activeFolder ? (
          /* Single-Page Folder View */
          <div
            onDragOver={(e) => {
              if (!isEditMode) return;
              e.preventDefault();
            }}
            onDrop={(e) => {
              if (!isEditMode) return;
              handleDropOnScope(e, activeFolder.columnId, activeFolder.id);
            }}
            className="flex-1 flex flex-col"
          >
            {/* Single-page Folder Top Bar */}
            <div className="border-b-[3px] border-black bg-white/75 px-4 sm:px-8 py-3.5">
              <div className="mx-auto max-w-2xl flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setActiveFolderId(null)}
                  className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-semibold text-zinc-900 bg-white border border-zinc-300 rounded-xl hover:border-black cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-black"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span>Back</span>
                </button>

                <div className="min-w-0 text-center">
                  <p className="text-xs font-semibold text-zinc-500 truncate">
                    {columns.find((c) => c.id === activeFolder.columnId)?.label ??
                      activeFolder.columnId}{' '}
                    / Folder
                  </p>
                  <h2 className="text-lg sm:text-xl font-bold text-zinc-950 truncate">
                    {activeFolder.title}
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    openAddModal(activeFolder.columnId, activeFolder.id, 'link')
                  }
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-semibold text-white bg-black rounded-xl hover:bg-zinc-800 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-black"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Add</span>
                </button>
              </div>
            </div>

            {/* Single-page Folder Contents */}
            <div className="mx-auto w-full max-w-2xl px-5 sm:px-8 py-6 space-y-4">
              {(() => {
                const folderItems = getFolderChildren(entries, activeFolder.id);
                const emptyFolderSlots = Math.max(
                  0,
                  MIN_SLOTS_IN_FOLDER - folderItems.length
                );

                return (
                  <>
                    {folderItems.map((entry, idx) => (
                      <EntryRow
                        key={entry.id}
                        entry={entry}
                        allEntries={entries}
                        canMoveUp={idx > 0}
                        canMoveDown={idx < folderItems.length - 1}
                        {...sharedRowHandlers}
                      />
                    ))}

                    {Array.from({ length: emptyFolderSlots }).map((_, idx) => (
                      <EmptyLinkSlot
                        key={`folder-empty-${idx}`}
                        label={activeFolder.title}
                        slotIndex={folderItems.length + idx}
                        onAdd={() =>
                          openAddModal(
                            activeFolder.columnId,
                            activeFolder.id,
                            'link'
                          )
                        }
                      />
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        ) : (
          /* Main 3-Column Store Grid */
          <>
            {/* Mobile Column Switcher (< md) */}
            <div className="md:hidden border-b-[3px] border-black bg-white/95 px-4 py-2.5">
              <div
                role="tablist"
                aria-label="Link columns"
                className="grid grid-cols-3 gap-1.5 p-1 bg-zinc-100 rounded-xl border border-zinc-200"
              >
                {columns.map((col) => {
                  const active = mobileColumn === col.id;
                  const count = getScopeEntries(entries, col.id, null).length;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setMobileColumn(col.id)}
                      className={`h-10 rounded-lg text-sm font-bold transition-colors whitespace-nowrap truncate px-2 cursor-pointer ${
                        active
                          ? 'bg-black text-white shadow-xs'
                          : 'text-zinc-700 hover:text-black'
                      }`}
                    >
                      {col.label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 grid grid-cols-1 md:grid-cols-3">
              {columns.map((col, colIndex) => {
                const colEntries = getScopeEntries(entries, col.id, null);
                const emptyCount = Math.max(
                  0,
                  MIN_SLOTS_PER_COLUMN - colEntries.length
                );
                const isLastCol = colIndex === columns.length - 1;
                const isVisibleOnMobile = mobileColumn === col.id;
                const isDropHighlight = isEditMode && dragOverColumnId === col.id;

                return (
                  <section
                    key={col.id}
                    aria-label={`${col.label} links column`}
                    data-testid={`column-${col.id}`}
                    onDragOver={(e) => {
                      if (!isEditMode) return;
                      e.preventDefault();
                      setDragOverColumnId(col.id);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDragOverColumnId((prev) =>
                          prev === col.id ? null : prev
                        );
                      }
                    }}
                    onDrop={(e) => {
                      if (!isEditMode) return;
                      handleDropOnScope(e, col.id, null);
                    }}
                    className={`flex-col transition-colors ${
                      isVisibleOnMobile ? 'flex' : 'hidden md:flex'
                    } ${!isLastCol ? 'md:border-r-[3px] md:border-black' : ''} ${
                      isDropHighlight ? 'bg-zinc-100/70' : ''
                    }`}
                  >
                    {/* Column Header Row */}
                    <div className="relative flex items-center justify-center px-6 py-3.5 border-b-[3px] border-black bg-white/55">
                      <StickerHeading text={col.label} as="h2" size="md" />
                      {isEditMode && (
                        <button
                          type="button"
                          onClick={() => openAddModal(col.id, null, 'link')}
                          aria-label={`Add item to ${col.label}`}
                          title={`Add item to ${col.label}`}
                          className="absolute right-4 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-300 bg-white text-zinc-700 hover:border-black hover:text-black transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    {/* Entries Stack */}
                    <div className="flex-1 px-5 sm:px-7 py-6 space-y-4">
                      {colEntries.map((entry, idx) => (
                        <EntryRow
                          key={entry.id}
                          entry={entry}
                          allEntries={entries}
                          canMoveUp={idx > 0}
                          canMoveDown={idx < colEntries.length - 1}
                          {...sharedRowHandlers}
                        />
                      ))}

                      {Array.from({ length: emptyCount }).map((_, idx) => (
                        <EmptyLinkSlot
                          key={`${col.id}-empty-${idx}`}
                          label={col.label}
                          slotIndex={colEntries.length + idx}
                          onAdd={() => openAddModal(col.id, null, 'link')}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </main>

      <LinkModal
        isOpen={modalOpen}
        columns={columns}
        allEntries={entries}
        initialColumnId={modalColumnId}
        initialParentId={modalParentId}
        initialKind={modalInitialKind}
        editingEntry={editingEntry}
        canMoveUp={editingScopePosition.canMoveUp}
        canMoveDown={editingScopePosition.canMoveDown}
        onMove={handleMoveEntry}
        onDelete={handleDeleteEntry}
        onClose={() => {
          setModalOpen(false);
          setEditingEntry(null);
        }}
        onSave={handleSaveEntry}
      />

      <BackupModal
        isOpen={backupModalOpen}
        entries={entries}
        columns={columns}
        user={user}
        authBusy={authBusy}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onClose={() => setBackupModalOpen(false)}
        onUpdateColumns={(nextCols) => {
          setColumns(nextCols);
          if (isCloudActive && user) {
            runCloudTask(saveColumnsToCloud(user.uid, nextCols));
          }
        }}
        onImportData={({ entries: nextEntries, columns: nextCols }) => {
          const indexed = withReindexedSortOrder(nextEntries);
          setEntries(indexed);
          setColumns(nextCols);
          if (isCloudActive && user) {
            runCloudTask(replaceAllVaultDataInCloud(user.uid, indexed, nextCols));
          }
        }}
        onClearAll={() => {
          setEntries([]);
          setActiveFolderId(null);
          if (isCloudActive && user) {
            runCloudTask(replaceAllVaultDataInCloud(user.uid, []));
          }
        }}
        onResetSamples={() => {
          const indexed = withReindexedSortOrder(SEED_ENTRIES);
          setEntries(indexed);
          setColumns(DEFAULT_COLUMNS);
          setActiveFolderId(null);
          if (isCloudActive && user) {
            runCloudTask(
              replaceAllVaultDataInCloud(user.uid, indexed, DEFAULT_COLUMNS)
            );
          }
        }}
      />
    </div>
  );
}
