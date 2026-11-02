import { Component, type ReactNode } from 'react';

/** An error while rendering would unmount the whole app and leave a blank window; this says what happened instead. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" style={{ padding: 32 }}>
        <h1>Falcon hit a problem</h1>
        <p>{error.message}</p>
        <p>Reload to continue. With crash recovery on, unsaved work comes back.</p>
        <button style={{ border: '1px solid currentColor', borderRadius: 6, padding: '4px 12px' }} onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
