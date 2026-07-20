import type { ReactNode } from 'react';
import './app.css';

type AppShellProps = {
  title: string;
  subtitle: string;
  headerAction?: ReactNode;
  children: ReactNode;
};

export function AppShell({ title, subtitle, headerAction, children }: AppShellProps) {
  return (
    <main className="app-shell">
      <section className="app-header">
        <div className="app-header-top">
          <span className="app-kicker">YG Easy</span>
          {headerAction}
        </div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </section>
      {children}
    </main>
  );
}
