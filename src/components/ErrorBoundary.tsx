import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { FirestoreErrorInfo } from '../firebase';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function parseFirestoreError(message: string): FirestoreErrorInfo | null {
  try {
    const parsed = JSON.parse(message) as Partial<FirestoreErrorInfo>;
    if (parsed && typeof parsed.error === 'string' && typeof parsed.operationType === 'string') {
      return parsed as FirestoreErrorInfo;
    }
  } catch {
    // Standard non-JSON runtime error
  }
  return null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application ErrorBoundary caught error:', error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const parsed = parseFirestoreError(this.state.error.message);
    const rawMsg = parsed ? parsed.error : this.state.error.message;
    const isQuotaError = rawMsg.includes('Quota exceeded');

    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6 text-zinc-950">
        <div className="w-full max-w-md rounded-2xl border-2 border-black bg-white p-6 shadow-xl space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-700 shrink-0">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-950">
                {isQuotaError ? 'Database quota reached' : 'Something went wrong'}
              </h1>
              <p className="text-xs text-zinc-600">
                {isQuotaError
                  ? 'Daily free-tier read units were exceeded. Quota resets the next day.'
                  : 'An unexpected error interrupted your session.'}
              </p>
            </div>
          </div>

          <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs font-mono text-zinc-700 break-words">
            {rawMsg}
          </p>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-semibold text-white bg-black rounded-xl hover:bg-zinc-800 cursor-pointer"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>Reload App</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
