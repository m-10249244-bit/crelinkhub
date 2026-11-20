import type { User } from 'firebase/auth';
import { useEffect, useRef, useState } from 'react';
import { Cloud, Download, LogOut, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import {
  DEFAULT_COLUMNS,
  parseImportedBackup,
  type ColumnConfig,
  type VaultEntry,
} from '../utils/links';

interface BackupModalProps {
  isOpen: boolean;
  entries: VaultEntry[];
  columns: ColumnConfig[];
  user: User | null;
  authBusy: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onClose: () => void;
  onUpdateColumns: (next: ColumnConfig[]) => void;
  onImportData: (data: { entries: VaultEntry[]; columns: ColumnConfig[] }) => void;
  onClearAll: () => void;
  onResetSamples: () => void;
}

export function BackupModal({
  isOpen,
  entries,
  columns,
  user,
  authBusy,
  onSignIn,
  onSignOut,
  onClose,
  onUpdateColumns,
  onImportData,
  onClearAll,
  onResetSamples,
}: BackupModalProps) {
  const [draftColumns, setDraftColumns] = useState<ColumnConfig[]>(columns);
  const [importError, setImportError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraftColumns(columns);
    setImportError(null);
    setStatusMessage(null);
    setConfirmClear(false);
  }, [isOpen, columns]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleExport = () => {
    const payload = JSON.stringify(
      {
        version: 2,
        exportedAt: new Date().toISOString(),
        columns,
        entries,
      },
      null,
      2
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `jaytinstore-links-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatusMessage(`Exported ${entries.length} items to JSON.`);
    setImportError(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseImportedBackup(text);
      onImportData(parsed);
      setImportError(null);
      setStatusMessage(`Imported ${parsed.entries.length} items successfully.`);
    } catch (err) {
      setStatusMessage(null);
      setImportError(
        err instanceof Error ? err.message : 'Unable to read backup file.'
      );
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveColumnNames = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = draftColumns.map((col, idx) => ({
      id: col.id,
      label: col.label.trim() || DEFAULT_COLUMNS[idx].label,
    }));
    onUpdateColumns(cleaned);
    setStatusMessage('Column headings updated.');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-modal-title"
        className="w-full max-w-lg rounded-2xl border-2 border-black bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-zinc-200">
          <h2 id="backup-modal-title" className="text-lg font-bold text-zinc-950">
            Manage Columns & Backup
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close manage dialog"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 hover:text-black cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 space-y-6">
          {statusMessage && (
            <p
              role="status"
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-900"
            >
              {statusMessage}
            </p>
          )}
          {importError && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800"
            >
              {importError}
            </p>
          )}

          {/* Cloud Database Sync */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-zinc-950">Cloud Database</h3>
              <p className="text-xs text-zinc-600 truncate">
                {user
                  ? `Synced with ${user.email ?? user.displayName ?? 'your Google account'}`
                  : 'Currently saved in this browser. Sign in to sync across devices.'}
              </p>
            </div>
            {user ? (
              <button
                type="button"
                onClick={onSignOut}
                disabled={authBusy}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-zinc-800 bg-white border border-zinc-300 rounded-lg hover:border-black cursor-pointer disabled:opacity-60"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                disabled={authBusy}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-black rounded-lg hover:bg-zinc-800 cursor-pointer disabled:opacity-60"
              >
                <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{authBusy ? 'Connecting...' : 'Sign in with Google'}</span>
              </button>
            )}
          </div>

          {/* Column Labels */}
          <form onSubmit={handleSaveColumnNames} className="space-y-3">
            <h3 className="text-sm font-bold text-zinc-950">Column Headings</h3>
            <div className="grid grid-cols-3 gap-2.5">
              {draftColumns.map((col, index) => (
                <div key={col.id}>
                  <label
                    htmlFor={`col-name-${col.id}`}
                    className="block text-xs font-medium text-zinc-600 mb-1"
                  >
                    Column {index + 1}
                  </label>
                  <input
                    id={`col-name-${col.id}`}
                    type="text"
                    maxLength={24}
                    value={col.label}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraftColumns((prev) =>
                        prev.map((item) =>
                          item.id === col.id ? { ...item, label: val } : item
                        )
                      );
                    }}
                    className="w-full h-10 px-3 text-sm font-semibold bg-white border border-zinc-300 rounded-xl text-zinc-950 focus:outline-none focus:border-black"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="h-9 px-4 text-xs font-semibold text-white bg-black rounded-lg hover:bg-zinc-800 cursor-pointer"
              >
                Update Headings
              </button>
            </div>
          </form>

          {/* Export / Import */}
          <div className="pt-4 border-t border-zinc-200 space-y-3">
            <h3 className="text-sm font-bold text-zinc-950">Backup & Restore</h3>
            <p className="text-xs text-zinc-600">
              {user
                ? 'Your links, folders, and expandable layers sync automatically with Firestore. Export a JSON file anytime to back them up.'
                : 'Your links, folders, and expandable layers are saved automatically in this browser. Export a JSON file anytime to back them up.'}
            </p>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-2 h-10 px-4 text-sm font-semibold text-zinc-900 bg-zinc-100 border border-zinc-300 rounded-xl hover:border-black cursor-pointer"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>Export JSON ({entries.length})</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 h-10 px-4 text-sm font-semibold text-zinc-900 bg-white border border-zinc-300 rounded-xl hover:border-black cursor-pointer"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>Import JSON</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                className="hidden"
                aria-label="Choose backup JSON file"
              />
            </div>
          </div>

          {/* Reset / Clear */}
          <div className="pt-4 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={() => {
                onResetSamples();
                setStatusMessage('Restored starter links.');
                setConfirmClear(false);
              }}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-zinc-700 border border-zinc-300 rounded-lg hover:border-black hover:text-black cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Restore Starter Links</span>
            </button>

            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-red-700 border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Clear All</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClearAll();
                    setConfirmClear(false);
                    setStatusMessage('All items cleared.');
                  }}
                  className="h-9 px-3 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 cursor-pointer"
                >
                  Confirm Clear All
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="h-9 px-3 text-xs font-medium text-zinc-700 border border-zinc-300 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
