import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2, X } from 'lucide-react';
import {
  validateEntryInput,
  type ColumnConfig,
  type ColumnId,
  type EntryFormInput,
  type EntryKind,
  type ValidationErrors,
  type VaultEntry,
} from '../utils/links';

interface LinkModalProps {
  isOpen: boolean;
  columns: ColumnConfig[];
  allEntries: VaultEntry[];
  initialColumnId: ColumnId;
  initialParentId: string | null;
  initialKind?: EntryKind;
  editingEntry: VaultEntry | null;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMove?: (id: string, direction: 'up' | 'down') => void;
  onDelete?: (entry: VaultEntry) => void;
  onClose: () => void;
  onSave: (input: EntryFormInput, editingId?: string) => void;
}

export function LinkModal({
  isOpen,
  columns,
  allEntries,
  initialColumnId,
  initialParentId,
  initialKind = 'link',
  editingEntry,
  canMoveUp = false,
  canMoveDown = false,
  onMove,
  onDelete,
  onClose,
  onSave,
}: LinkModalProps) {
  const [kind, setKind] = useState<EntryKind>(initialKind);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [columnId, setColumnId] = useState<ColumnId>(initialColumnId);
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [errors, setErrors] = useState<ValidationErrors>({});

  const parentEntry = useMemo(
    () => (parentId ? allEntries.find((e) => e.id === parentId) ?? null : null),
    [allEntries, parentId]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (editingEntry) {
      setKind(editingEntry.kind);
      setTitle(editingEntry.title);
      setUrl(editingEntry.kind === 'link' ? editingEntry.url : '');
      setColumnId(editingEntry.columnId);
      setParentId(editingEntry.parentId ?? null);
    } else {
      setKind(initialKind);
      setTitle('');
      setUrl('');
      setColumnId(initialColumnId);
      setParentId(initialParentId);
    }
    setErrors({});
  }, [isOpen, editingEntry, initialColumnId, initialParentId, initialKind]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const availableContainers = useMemo(() => {
    return allEntries.filter((e) => {
      if (e.columnId !== columnId) return false;
      if (e.kind === 'link') return false;
      if (editingEntry && e.id === editingEntry.id) return false;
      // Folders can only contain links or sections; sections only contain links
      if (kind === 'folder') return false;
      if (kind === 'section' && e.kind !== 'folder') return false;
      return true;
    });
  }, [allEntries, columnId, editingEntry, kind]);

  if (!isOpen) return null;

  const allowedCreateKinds: { id: EntryKind; label: string }[] =
    parentEntry?.kind === 'section'
      ? [{ id: 'link', label: 'Link' }]
      : parentEntry?.kind === 'folder'
        ? [
            { id: 'link', label: 'Link' },
            { id: 'section', label: 'Expandable Layer' },
          ]
        : [
            { id: 'link', label: 'Link' },
            { id: 'folder', label: 'Folder Page' },
            { id: 'section', label: 'Expandable Layer' },
          ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: EntryFormInput = {
      kind,
      title,
      url,
      columnId,
      parentId,
    };
    const nextErrors = validateEntryInput(input);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    onSave(input, editingEntry?.id);
  };

  const modalHeading = editingEntry
    ? editingEntry.kind === 'folder'
      ? 'Edit Folder'
      : editingEntry.kind === 'section'
        ? 'Edit Expandable Layer'
        : 'Edit Link'
    : kind === 'folder'
      ? 'Create Folder Page'
      : kind === 'section'
        ? 'Create Expandable Layer'
        : 'Save a New Link';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-modal-title"
        className="w-full max-w-md rounded-2xl border-2 border-black bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-zinc-200">
          <h2 id="link-modal-title" className="text-lg font-bold text-zinc-950">
            {modalHeading}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 hover:text-black cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
          {/* Entry Type Switcher (only when creating and >1 option exists) */}
          {!editingEntry && allowedCreateKinds.length > 1 && (
            <div>
              <span className="block text-sm font-semibold text-zinc-900 mb-1.5">
                Type
              </span>
              <div
                className={`grid gap-1.5 p-1 bg-zinc-100 rounded-xl border border-zinc-200 ${
                  allowedCreateKinds.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
                }`}
              >
                {allowedCreateKinds.map((opt) => {
                  const active = kind === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setKind(opt.id);
                        setErrors({});
                      }}
                      aria-pressed={active}
                      className={`h-9 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap truncate px-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-black ${
                        active
                          ? 'bg-black text-white shadow-xs'
                          : 'text-zinc-700 hover:text-black'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Column selector (when creating at top-level or editing) */}
          {(!parentEntry || editingEntry) && (
            <div>
              <span className="block text-sm font-semibold text-zinc-900 mb-1.5">
                Column
              </span>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-zinc-100 rounded-xl border border-zinc-200">
                {columns.map((col) => {
                  const active = columnId === col.id;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => {
                        setColumnId(col.id);
                        if (parentEntry && parentEntry.columnId !== col.id) {
                          setParentId(null);
                        }
                      }}
                      aria-pressed={active}
                      className={`h-9 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap truncate px-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-black ${
                        active
                          ? 'bg-black text-white shadow-xs'
                          : 'text-zinc-700 hover:text-black'
                      }`}
                    >
                      {col.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Destination / Container selector when editing a link or section */}
          {editingEntry && availableContainers.length > 0 && (
            <div>
              <label
                htmlFor="entry-parent-select"
                className="block text-sm font-semibold text-zinc-900 mb-1.5"
              >
                Inside Folder / Layer
              </label>
              <select
                id="entry-parent-select"
                value={parentId ?? ''}
                onChange={(e) => setParentId(e.target.value || null)}
                className="w-full h-11 px-3.5 text-sm bg-white border border-zinc-300 rounded-xl text-zinc-950 focus:outline-none focus:border-black"
              >
                <option value="">Top level ({columnId})</option>
                {availableContainers.map((container) => (
                  <option key={container.id} value={container.id}>
                    {container.kind === 'folder' ? 'Folder: ' : 'Layer: '}
                    {container.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Contextual hint when adding directly inside a Folder or Layer */}
          {!editingEntry && parentEntry && (
            <p className="text-xs font-medium text-zinc-600 bg-zinc-100 rounded-lg px-3 py-2">
              Saving inside{' '}
              <span className="font-semibold text-zinc-950">
                {parentEntry.title}
              </span>
            </p>
          )}

          {/* Name */}
          <div>
            <label
              htmlFor="link-title-input"
              className="block text-sm font-semibold text-zinc-900 mb-1.5"
            >
              {kind === 'folder'
                ? 'Folder Name'
                : kind === 'section'
                  ? 'Layer Name'
                  : 'Link Name'}
            </label>
            <input
              id="link-title-input"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
              }}
              placeholder={
                kind === 'folder'
                  ? 'e.g. Work Tools'
                  : kind === 'section'
                    ? 'e.g. swq'
                    : 'e.g. Google Drive'
              }
              autoFocus
              className="w-full h-11 px-3.5 text-sm bg-white border border-zinc-300 rounded-xl text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:border-black"
            />
            {errors.title && (
              <p className="mt-1 text-xs font-medium text-red-700" role="alert">
                {errors.title}
              </p>
            )}
          </div>

          {/* URL (only for links) */}
          {kind === 'link' && (
            <div>
              <label
                htmlFor="link-url-input"
                className="block text-sm font-semibold text-zinc-900 mb-1.5"
              >
                URL
              </label>
              <input
                id="link-url-input"
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (errors.url) setErrors((prev) => ({ ...prev, url: undefined }));
                }}
                placeholder="https://example.com"
                className="w-full h-11 px-3.5 text-sm font-mono bg-white border border-zinc-300 rounded-xl text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:border-black"
              />
              <p className="mt-1 text-xs text-zinc-500">
                You can omit https:// and it will be added automatically.
              </p>
              {errors.url && (
                <p className="mt-1 text-xs font-medium text-red-700" role="alert">
                  {errors.url}
                </p>
              )}
            </div>
          )}

          {kind === 'folder' && (
            <p className="text-xs text-zinc-600">
              Clicking a folder opens its own dedicated single-page view where you can store links and layers.
            </p>
          )}
          {kind === 'section' && (
            <p className="text-xs text-zinc-600">
              An expandable layer stays compact until you click it to reveal and add links underneath.
            </p>
          )}

          {/* Edit utilities (move & delete) */}
          {editingEntry && (
            <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!canMoveUp}
                  onClick={() => onMove?.(editingEntry.id, 'up')}
                  aria-label="Move item up"
                  className="inline-flex items-center gap-1 h-9 px-2.5 text-xs font-medium rounded-lg border border-zinc-300 text-zinc-800 hover:border-black disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Move Up</span>
                </button>
                <button
                  type="button"
                  disabled={!canMoveDown}
                  onClick={() => onMove?.(editingEntry.id, 'down')}
                  aria-label="Move item down"
                  className="inline-flex items-center gap-1 h-9 px-2.5 text-xs font-medium rounded-lg border border-zinc-300 text-zinc-800 hover:border-black disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Move Down</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  onDelete?.(editingEntry);
                  onClose();
                }}
                className="inline-flex items-center gap-1 h-9 px-3 text-xs font-semibold rounded-lg text-red-700 hover:bg-red-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Delete</span>
              </button>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-xl hover:border-black hover:text-black cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-10 px-5 text-sm font-semibold text-white bg-black rounded-xl hover:bg-zinc-800 cursor-pointer"
            >
              {editingEntry
                ? 'Save Changes'
                : kind === 'folder'
                  ? 'Create Folder'
                  : kind === 'section'
                    ? 'Create Layer'
                    : 'Save Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
