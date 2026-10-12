import { useEffect, useRef, useState } from 'react';
import Icon from './components/Icon.jsx';
import PredictionView from './views/PredictionView.jsx';
import BatchView from './views/BatchView.jsx';
import OverviewView from './views/OverviewView.jsx';
import PerformanceView from './views/PerformanceView.jsx';
import { apiRequest, API_DOCS_URL } from './utils/api.js';

const views = [
  { id: 'prediction', label: 'Prediction playground', icon: 'predict', description: 'Change applicant details and explore the model’s default predictions.', component: PredictionView },
  { id: 'batch', label: 'Batch predictions', icon: 'batch', description: 'Compare multiple applicants with a single model request.', component: BatchView },
  { id: 'overview', label: 'Dataset overview', icon: 'chart', description: 'Explore the training data, class balance, and patterns in default rates.', component: OverviewView },
  { id: 'performance', label: 'Model performance', icon: 'performance', description: 'Inspect the saved model and its results on the holdout test set.', component: PerformanceView },
];

function currentView() {
  const id = window.location.hash.slice(1);
  return views.some((view) => view.id === id) ? id : 'prediction';
}

export default function App() {
  const [active, setActive] = useState(currentView);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [checkingHealth, setCheckingHealth] = useState(true);
  const healthRequest = useRef(null);

  async function checkHealth() {
    healthRequest.current?.abort();
    const controller = new AbortController();
    healthRequest.current = controller;
    setCheckingHealth(true);
    setHealthError('');
    try {
      const response = await apiRequest('/health', { signal: controller.signal, timeoutMs: 10000 });
      if (!controller.signal.aborted) setHealth(response);
    } catch (error) {
      if (error.name !== 'AbortError') {
        setHealth(null);
        setHealthError(error.message);
      }
    } finally {
      if (!controller.signal.aborted) setCheckingHealth(false);
    }
  }

  useEffect(() => {
    const onHashChange = () => setActive(currentView());
    window.addEventListener('hashchange', onHashChange);
    checkHealth();
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      healthRequest.current?.abort();
    };
  }, []);

  const view = views.find((item) => item.id === active);
  const View = view.component;
  const status = checkingHealth ? 'checking' : health?.model_loaded ? 'online' : health ? 'missing' : 'offline';
  const statusLabel = { checking: 'Connecting…', online: 'Model ready', missing: 'Model missing', offline: 'API unavailable' }[status];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
      <aside className="sidebar">
        <a className="brand" href="#prediction" aria-label="RiskML Explorer home">
          <span className="brand-mark"><Icon name="chart" size={24} /></span>
          <span><strong>RiskML Explorer</strong><small>Credit risk research lab</small></span>
        </a>
        <div className="nav-label">EXPLORE THE MODEL</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {views.map((item) => (
            <a key={item.id} href={`#${item.id}`} className={`nav-item ${active === item.id ? 'active' : ''}`} aria-current={active === item.id ? 'page' : undefined}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <div className="connection-heading"><span className={`status-dot ${status}`} /><strong>Backend connection</strong></div>
            <p className="connection-status" aria-live="polite">{statusLabel}</p>
            {healthError && <p className="connection-help">{healthError}</p>}
            {status === 'missing' && <p className="connection-help">The API is running. Export the trained model to enable predictions.</p>}
            <button type="button" className="button ghost small" onClick={checkHealth} disabled={checkingHealth}><Icon name="refresh" size={15} />Refresh status</button>
          </div>
          <p className="sidebar-footnote">A simple workspace for exploring credit risk.</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong>Credit risk</strong></div>
          <div className="topbar-actions">
            <button type="button" className={`connection-badge ${status}`} onClick={checkHealth} disabled={checkingHealth} title="Refresh backend connection" aria-label={`${statusLabel}. Refresh backend connection`}><span className={`status-dot ${status}`} />{statusLabel}</button>
            <a className="button secondary small" href={API_DOCS_URL} target="_blank" rel="noreferrer">API docs<Icon name="external" size={14} /></a>
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div><p className="eyebrow">CREDIT RISK LAB</p><h1>{view.label}</h1><p className="page-description">{view.description}</p></div>
            <span className="demo-label">Educational demo</span>
          </div>
          <View key={active} />
          <footer className="workspace-footer"><span>RiskML Explorer</span><span>Model predictions are for exploration, not credit approval.</span></footer>
        </main>
      </div>
    </div>
  );
}
