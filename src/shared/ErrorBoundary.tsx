import { Component, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error?: Error;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('YG Easy render failed', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-shell">
          <section className="surface error-fallback">
            <strong>YG Easy не смог открыть интерфейс.</strong>
            <span>{this.state.error.message}</span>
            <span>Обновите расширение в chrome://extensions и заново откройте popup.</span>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
