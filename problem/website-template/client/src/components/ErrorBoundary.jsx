import { Component } from 'react';

// If anything crashes while rendering, reload the page instead of leaving a black screen.
// A sessionStorage guard stops it from reloading forever if the error happens on every load.
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('App crashed, reloading:', error);
    const last = Number(sessionStorage.getItem('void_reload_at') || 0);
    if (Date.now() - last > 10000) {
      sessionStorage.setItem('void_reload_at', String(Date.now()));
      window.location.reload();
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="section page-top center">
        <h1 className="page-title">Something broke.</h1>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
      </section>
    );
  }
}
