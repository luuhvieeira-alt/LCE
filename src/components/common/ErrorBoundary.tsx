import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let readable = error.message || 'Erro inesperado na aplicação.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; path?: string };
      if (parsed.error) {
        readable = `${parsed.error}${parsed.path ? ` (${parsed.path})` : ''}`;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, message: readable };
  }

  componentDidCatch(error: Error): void {
    console.error('[LCE ErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-[#090B10] p-6 text-slate-100">
          <div className="w-full max-w-md border border-white/10 bg-[#11151E] p-6">
            <div className="mb-4 flex items-center gap-3 text-amber-500">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <h2 className="font-display text-2xl font-bold tracking-wide text-slate-100">
                Falha de Execução
              </h2>
            </div>
            <p className="mb-6 text-sm leading-relaxed text-slate-300">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 bg-amber-600 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-500"
            >
              <RefreshCw className="h-4 w-4" />
              Recarregar Aplicação
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
