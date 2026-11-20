import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Folder,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  countDescendantLinks,
  extractDomain,
  getSectionChildren,
  type FolderEntry,
  type LinkEntry,
  type SectionEntry,
  type VaultEntry,
} from '../utils/links';

interface SharedEditHandlers {
  isEditMode: boolean;
  draggedId: string | null;
  dragOverId: string | null;
  onTrackClick: (id: string) => void;
  onOpenFolder: (folder: FolderEntry) => void;
  onToggleSection: (id: string) => void;
  onAddInsideSection: (section: SectionEntry) => void;
  onEdit: (entry: VaultEntry) => void;
  onDelete: (entry: VaultEntry) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onDragStart: (id: string) => void;
  onDragOverSlot: (e: React.DragEvent, id: string) => void;
  onDropOnSlot: (e: React.DragEvent, targetId: string) => void;
  onDragEnd: () => void;
}

interface EntryRowProps extends SharedEditHandlers {
  entry: VaultEntry;
  allEntries: VaultEntry[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  disableReorder?: boolean;
}

function EditControls({
  entry,
  canMoveUp,
  canMoveDown,
  onMove,
  onEdit,
  onDelete,
}: {
  entry: VaultEntry;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onEdit: (entry: VaultEntry) => void;
  onDelete: (entry: VaultEntry) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        type="button"
        disabled={!canMoveUp}
        onClick={() => onMove(entry.id, 'up')}
        aria-label={`Move ${entry.title} up`}
        title="Move up"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-200/80 hover:text-black disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
      >
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        disabled={!canMoveDown}
        onClick={() => onMove(entry.id, 'down')}
        aria-label={`Move ${entry.title} down`}
        title="Move down"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-200/80 hover:text-black disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
      >
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onEdit(entry)}
        aria-label={`Edit ${entry.title} details`}
        title="Edit"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-200/80 hover:text-black cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onDelete(entry)}
        aria-label={`Delete ${entry.title}`}
        title="Delete"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 hover:bg-red-100 hover:text-red-700 cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function EntryRow(props: EntryRowProps) {
  const {
    entry,
    allEntries,
    canMoveUp,
    canMoveDown,
    disableReorder = false,
    isEditMode,
    draggedId,
    dragOverId,
    onTrackClick,
    onOpenFolder,
    onToggleSection,
    onAddInsideSection,
    onEdit,
    onDelete,
    onMove,
    onDragStart,
    onDragOverSlot,
    onDropOnSlot,
    onDragEnd,
  } = props;

  const isDragging = draggedId === entry.id;
  const isDragTarget = dragOverId === entry.id && draggedId !== entry.id;

  const dragProps = isEditMode
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', entry.id);
          onDragStart(entry.id);
        },
        onDragOver: (e: React.DragEvent) => onDragOverSlot(e, entry.id),
        onDrop: (e: React.DragEvent) => onDropOnSlot(e, entry.id),
        onDragEnd,
      }
    : {};

  // 1. Direct clickable Link
  if (entry.kind === 'link') {
    const link: LinkEntry = entry;
    const domain = extractDomain(link.url);

    if (!isEditMode) {
      return (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onTrackClick(link.id)}
          aria-label={`Open ${link.title} (${domain})`}
          className="group flex flex-col justify-center w-full px-5 py-2.5 min-h-[58px] rounded-[22px] border-[1.5px] border-zinc-900/80 filled-slot-gradient shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-black hover:shadow-[0_3px_10px_rgba(0,0,0,0.08)] transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          <span className="truncate text-[15px] font-semibold text-zinc-950 leading-snug">
            {link.title}
          </span>
          <span className="truncate text-xs font-mono text-zinc-600">
            {domain}
          </span>
        </a>
      );
    }

    return (
      <div
        {...dragProps}
        className={`flex items-center gap-2 px-3.5 py-2 min-h-[58px] rounded-[22px] border-[1.5px] filled-slot-gradient transition-all duration-150 cursor-grab active:cursor-grabbing ${
          isDragging
            ? 'opacity-45 border-dashed border-black'
            : isDragTarget
              ? 'border-black ring-2 ring-black/20 bg-zinc-100'
              : 'border-zinc-900/80 shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
        }`}
      >
        <GripVertical className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
        <button
          type="button"
          onClick={() => onEdit(link)}
          aria-label={`Edit ${link.title}`}
          className="flex flex-1 min-w-0 flex-col text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-black rounded"
        >
          <span className="truncate text-[15px] font-semibold text-zinc-950 leading-snug">
            {link.title}
          </span>
          <span className="truncate text-xs font-mono text-zinc-600">
            {domain}
          </span>
        </button>
        <EditControls
          entry={link}
          canMoveUp={!disableReorder && canMoveUp}
          canMoveDown={!disableReorder && canMoveDown}
          onMove={onMove}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    );
  }

  // 2. Single-Page Folder Entry
  if (entry.kind === 'folder') {
    const folder: FolderEntry = entry;
    const itemCount = countDescendantLinks(allEntries, folder.id);

    if (!isEditMode) {
      return (
        <button
          type="button"
          onClick={() => onOpenFolder(folder)}
          aria-label={`Open folder ${folder.title} (${itemCount} links)`}
          className="group flex items-center justify-between gap-3 w-full px-5 py-2.5 min-h-[58px] rounded-[22px] border-[1.5px] border-black bg-zinc-100/90 hover:bg-zinc-200/80 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all duration-150 cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          <span className="flex flex-1 min-w-0 flex-col">
            <span className="truncate text-[15px] font-bold text-zinc-950 leading-snug">
              {folder.title}
            </span>
            <span className="truncate text-xs text-zinc-600 tabular-nums">
              Folder · {itemCount} {itemCount === 1 ? 'link' : 'links'}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 shrink-0 text-zinc-700 group-hover:text-black">
            <Folder className="h-4 w-4" aria-hidden="true" />
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </button>
      );
    }

    return (
      <div
        {...dragProps}
        className={`flex items-center gap-2 px-3.5 py-2 min-h-[58px] rounded-[22px] border-[1.5px] bg-zinc-100/90 transition-all duration-150 cursor-grab active:cursor-grabbing ${
          isDragging
            ? 'opacity-45 border-dashed border-black'
            : isDragTarget
              ? 'border-black ring-2 ring-black/20 bg-zinc-200'
              : 'border-black shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
        }`}
      >
        <GripVertical className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
        <button
          type="button"
          onClick={() => onOpenFolder(folder)}
          aria-label={`Open folder ${folder.title}`}
          className="flex flex-1 min-w-0 flex-col text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-black rounded"
        >
          <span className="truncate text-[15px] font-bold text-zinc-950 leading-snug">
            {folder.title}
          </span>
          <span className="truncate text-xs text-zinc-600 tabular-nums">
            Folder · {itemCount} {itemCount === 1 ? 'link' : 'links'}
          </span>
        </button>
        <EditControls
          entry={folder}
          canMoveUp={!disableReorder && canMoveUp}
          canMoveDown={!disableReorder && canMoveDown}
          onMove={onMove}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    );
  }

  // 3. Expandable / Collapsible Layer (e.g. "swq")
  const section: SectionEntry = entry;
  const childEntries = getSectionChildren(allEntries, section.id);

  return (
    <div className="space-y-2.5">
      {!isEditMode ? (
        <button
          type="button"
          aria-expanded={section.isOpen}
          onClick={() => onToggleSection(section.id)}
          className="group flex items-center justify-between gap-3 w-full px-5 py-2.5 min-h-[58px] rounded-[22px] border-[1.5px] border-zinc-900 bg-zinc-50 hover:bg-zinc-100 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-150 cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          <span className="flex flex-1 min-w-0 flex-col">
            <span className="truncate text-[15px] font-bold text-zinc-950 leading-snug">
              {section.title}
            </span>
            <span className="truncate text-xs text-zinc-600 tabular-nums">
              {section.isOpen ? 'Expanded' : 'Collapsed'} · {childEntries.length}{' '}
              {childEntries.length === 1 ? 'link' : 'links'}
            </span>
          </span>
          {section.isOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-800" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-700" aria-hidden="true" />
          )}
        </button>
      ) : (
        <div
          {...dragProps}
          className={`flex items-center gap-2 px-3.5 py-2 min-h-[58px] rounded-[22px] border-[1.5px] bg-zinc-50 transition-all duration-150 cursor-grab active:cursor-grabbing ${
            isDragging
              ? 'opacity-45 border-dashed border-black'
              : isDragTarget
                ? 'border-black ring-2 ring-black/20 bg-zinc-100'
                : 'border-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
          }`}
        >
          <GripVertical className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
          <button
            type="button"
            aria-expanded={section.isOpen}
            onClick={() => onToggleSection(section.id)}
            className="flex flex-1 min-w-0 items-center gap-2 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-black rounded"
          >
            {section.isOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-zinc-700" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-zinc-700" aria-hidden="true" />
            )}
            <span className="flex flex-1 min-w-0 flex-col">
              <span className="truncate text-[15px] font-bold text-zinc-950 leading-snug">
                {section.title}
              </span>
              <span className="truncate text-xs text-zinc-600 tabular-nums">
                {childEntries.length} {childEntries.length === 1 ? 'link' : 'links'}
              </span>
            </span>
          </button>
          <EditControls
            entry={section}
            canMoveUp={!disableReorder && canMoveUp}
            canMoveDown={!disableReorder && canMoveDown}
            onMove={onMove}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      )}

      {/* Expanded child links + Add Link under this layer */}
      {section.isOpen && (
        <div className="pl-4 ml-3 border-l border-zinc-300 space-y-2.5">
          {childEntries.map((child, childIdx) => (
            <EntryRow
              key={child.id}
              entry={child}
              allEntries={allEntries}
              canMoveUp={childIdx > 0}
              canMoveDown={childIdx < childEntries.length - 1}
              disableReorder={disableReorder}
              isEditMode={isEditMode}
              draggedId={draggedId}
              dragOverId={dragOverId}
              onTrackClick={onTrackClick}
              onOpenFolder={onOpenFolder}
              onToggleSection={onToggleSection}
              onAddInsideSection={onAddInsideSection}
              onEdit={onEdit}
              onDelete={onDelete}
              onMove={onMove}
              onDragStart={onDragStart}
              onDragOverSlot={onDragOverSlot}
              onDropOnSlot={onDropOnSlot}
              onDragEnd={onDragEnd}
            />
          ))}

          <button
            type="button"
            onClick={() => onAddInsideSection(section)}
            className="flex items-center justify-center gap-1.5 w-full h-11 px-4 rounded-[18px] border border-dashed border-zinc-400 bg-white/80 text-xs font-semibold text-zinc-700 hover:border-black hover:text-black hover:bg-white transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add link to {section.title}</span>
          </button>
        </div>
      )}
    </div>
  );
}

interface EmptyLinkSlotProps {
  label: string;
  slotIndex: number;
  onAdd: () => void;
}

export function EmptyLinkSlot({
  label,
  slotIndex,
  onAdd,
}: EmptyLinkSlotProps) {
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={`Add item to ${label} slot ${slotIndex + 1}`}
      className="group flex w-full items-center justify-between px-4 h-[58px] rounded-[22px] empty-slot-gradient transition-all duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-900 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150">
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Add to {label}</span>
      </span>
    </button>
  );
}
