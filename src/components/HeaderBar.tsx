import type { User } from 'firebase/auth';
import { Check, Cloud, FolderArchive, LogOut, Pencil, Plus, Search, X } from 'lucide-react';
import { StickerHeading } from './StickerHeading';

interface HeaderBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  isEditMode: boolean;
  onToggleEditMode: () => void;
  onOpenAddModal: () => void;
  onOpenBackupModal: () => void;
  totalLinks: number;
  user: User | null;
  authReady: boolean;
  authBusy: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function HeaderBar({
  searchQuery,
  onSearchChange,
  isEditMode,
  onToggleEditMode,
  onOpenAddModal,
  onOpenBackupModal,
  totalLinks,
  user,
  authReady,
  authBusy,
  onSignIn,
  onSignOut,
}: HeaderBarProps) {
  return (
    <header className="relative z-20 border-b-[3px] border-black bg-white/80 backdrop-blur-xs">
      <div className="mx-auto max-w-[1440px] px-4 sm:px-8 py-3 sm:py-3.5">
        <div className="flex flex-col md:grid md:grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-4">
          {/* Brand Logo (Center on Desktop, Top on Mobile) */}
          <div className="order-1 md:order-2 flex items-center justify-center">
            <a
              href="#top"
              className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black rounded-lg"
              aria-label="JAYTINSTORE home"
            >
              <StickerHeading text="JAYTINSTORE" as="h1" size="lg" />
            </a>
          </div>

          {/* Left Zone: Live Search */}
          <div className="order-2 md:order-1 w-full md:w-auto flex items-center justify-start">
            <div className="relative w-full md:max-w-[230px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={`Search ${totalLinks} links...`}
                aria-label="Search saved links"
                className="w-full h-10 pl-9 pr-8 text-sm bg-white/90 border border-zinc-300 rounded-lg text-zinc-950 placeholder:text-zinc-500 focus:outline-none focus:border-black focus:bg-white transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  aria-label="Clear search query"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-zinc-500 hover:text-black focus-visible:outline-2 focus-visible:outline-black"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* Right Zone: Cloud Sign-in/out, Edit Mode, Manage, Add Link */}
          <div className="order-3 w-full md:w-auto grid grid-cols-2 sm:grid-cols-4 md:flex items-center justify-end gap-2 shrink-0">
            {authReady && (
              user ? (
                <button
                  type="button"
                  onClick={onSignOut}
                  disabled={authBusy}
                  title={`Cloud Synced: ${user.email ?? user.displayName ?? 'Google Account'} (click to sign out)`}
                  className="inline-flex items-center justify-center gap-1.5 h-10 px-3 text-sm font-medium text-zinc-800 bg-white border border-zinc-300 rounded-lg hover:border-black hover:text-black transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSignIn}
                  disabled={authBusy}
                  title="Sign in with Google to sync your links across devices"
                  className="inline-flex items-center justify-center gap-1.5 h-10 px-3 text-sm font-medium text-zinc-800 bg-white border border-zinc-300 rounded-lg hover:border-black hover:text-black transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                >
                  <Cloud className="h-4 w-4" aria-hidden="true" />
                  <span>{authBusy ? 'Signing in...' : 'Sign in'}</span>
                </button>
              )
            )}
            <button
              type="button"
              onClick={onToggleEditMode}
              aria-pressed={isEditMode}
              className={`inline-flex items-center justify-center gap-1.5 h-10 px-3 text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${
                isEditMode
                  ? 'bg-zinc-900 text-white border-black'
                  : 'bg-white text-zinc-800 border-zinc-300 hover:border-black hover:text-black'
              }`}
            >
              {isEditMode ? (
                <>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <span>Done</span>
                </>
              ) : (
                <>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Edit Mode</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onOpenBackupModal}
              className="inline-flex items-center justify-center gap-1.5 h-10 px-3 text-sm font-medium text-zinc-800 bg-white border border-zinc-300 rounded-lg hover:border-black hover:text-black transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              <FolderArchive className="h-4 w-4" aria-hidden="true" />
              <span>Manage</span>
            </button>
            <button
              type="button"
              onClick={onOpenAddModal}
              className="inline-flex items-center justify-center gap-1.5 h-10 px-3.5 text-sm font-semibold text-white bg-black rounded-lg hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add Link</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
