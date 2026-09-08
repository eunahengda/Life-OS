import { Component, PropsWithChildren, ReactNode } from 'react';

import { ErrorState } from './ErrorState';

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) {
      return <ErrorState message={this.state.error.message} onRetry={this.reset} />;
    }

    return this.props.children;
  }
}
