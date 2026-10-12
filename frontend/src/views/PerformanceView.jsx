import { useEffect, useState } from 'react';
import CurveChart from '../components/CurveChart.jsx';
import MetricCard from '../components/MetricCard.jsx';
import Panel from '../components/Panel.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../utils/api.js';
import { formatNumber, formatPercent, formatScore } from '../utils/format.js';

const endpoints = {
  info: '/api/v1/model/info',
  metrics: '/api/v1/model/metrics',
  curves: '/api/v1/model/curves',
};

export default function PerformanceView() {
  const [data, setData] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [curve, setCurve] = useState('roc');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const entries = Object.entries(endpoints);
    Promise.allSettled(entries.map(([, path]) => apiRequest(path, { signal: controller.signal })))
      .then((results) => {
        if (controller.signal.aborted) return;
        const nextData = {};
        const nextErrors = {};
        results.forEach((result, index) => {
          const key = entries[index][0];
          if (result.status === 'fulfilled') nextData[key] = result.value;
          else nextErrors[key] = result.reason.message || 'Could not load this artifact.';
        });
        setData(nextData);
        setErrors(nextErrors);
        setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);

  const info = data.info;
  const metrics = data.metrics;
  const matrix = metrics?.confusion_matrix;
  const hasMatrix = Array.isArray(matrix) && matrix.length === 2 && matrix.every((row) => Array.isArray(row) && row.length === 2 && row.every(Number.isFinite));
  const positiveCount = hasMatrix ? matrix[1][0] + matrix[1][1] : null;
  const matrixCount = hasMatrix ? matrix.flat().reduce((total, count) => total + count, 0) : 0;
  const baseline = matrixCount > 0 ? positiveCount / matrixCount : undefined;
  const accuracy = matrixCount > 0 ? (matrix[0][0] + matrix[1][1]) / matrixCount : null;

  return (
    <div className="stack">
      <div className="section-heading"><p className="muted">Inspect the saved model's holdout evaluation.</p><button type="button" className="button secondary small" disabled={loading} onClick={() => setReload((value) => value + 1)}>{loading ? 'Loading…' : 'Refresh metrics'}</button></div>
      {loading && <StatusMessage type="info">Loading model artifacts…</StatusMessage>}
      {errors.info && <StatusMessage>Model information: {errors.info}</StatusMessage>}
      {info && (
        <Panel title={info.name} description={`Version ${info.version} · target: ${info.target}`} actions={<span className="badge">Exported model</span>}>
          <dl className="detail-list">
            <div><dt>Model features</dt><dd>{formatNumber(info.features?.length)}</dd></div>
            <div><dt>Default threshold</dt><dd>{formatScore(info.default_threshold, 2)}</dd></div>
            <div><dt>Cross-validation average precision</dt><dd>{formatScore(info.cv_average_precision)}</dd></div>
          </dl>
        </Panel>
      )}
      {errors.metrics && <StatusMessage>Evaluation metrics: {errors.metrics}</StatusMessage>}
      {metrics && (
        <div className="metrics-grid">
          <MetricCard label="ROC AUC" value={formatScore(metrics.roc_auc)} hint="Ranking across classification thresholds" />
          <MetricCard label="Average precision" value={formatScore(metrics.average_precision)} hint="Precision–recall summary" tone="teal" />
          <MetricCard label="Default precision" value={formatPercent(metrics.precision_default)} hint="Recorded defaults among flagged loans" />
          <MetricCard label="Default recall" value={formatPercent(metrics.recall_default)} hint="Recorded defaults successfully detected" tone="teal" />
        </div>
      )}
      <div className="two-column">
        <Panel title="Confusion matrix" description={metrics ? `${formatNumber(metrics.support)} ${metrics.split.replaceAll('_', ' ')} observations · threshold ${formatScore(metrics.threshold, 2)}` : 'Recorded outcomes versus predicted outcomes.'}>
          {errors.metrics ? <StatusMessage>{errors.metrics}</StatusMessage> : hasMatrix ? (
            <div className="stack">
              <div className="table-wrap"><table className="confusion-table">
                <caption className="sr-only">Actual outcomes by row and predicted outcomes by column</caption>
                <thead><tr><th scope="col">Actual / Predicted</th><th scope="col">Non-default</th><th scope="col">Default</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Non-default</th><td className="matrix-correct"><strong>{formatNumber(matrix[0][0])}</strong><span>True negatives</span></td><td><strong>{formatNumber(matrix[0][1])}</strong><span>False positives</span></td></tr>
                  <tr><th scope="row">Default</th><td className="matrix-missed"><strong>{formatNumber(matrix[1][0])}</strong><span>False negatives</span></td><td className="matrix-correct"><strong>{formatNumber(matrix[1][1])}</strong><span>True positives</span></td></tr>
                </tbody>
              </table></div>
              <dl className="detail-list"><div><dt>Accuracy</dt><dd>{formatPercent(accuracy)}</dd></div><div><dt>Default F1 score</dt><dd>{formatScore(metrics.f1_default)}</dd></div></dl>
              <p className="muted data-note">False negatives are recorded defaults that the model did not flag at this threshold. Changing the prediction threshold does not recalculate these saved metrics.</p>
            </div>
          ) : <p className="empty-state">{loading ? 'Loading confusion matrix…' : 'No confusion matrix was exported.'}</p>}
        </Panel>
        <Panel title="Evaluation curves" description={data.curves ? `Exported ${data.curves.split.replaceAll('_', ' ')} curves.` : 'Discrimination across classification thresholds.'} actions={
          <div className="chart-switch" role="group" aria-label="Evaluation curve">
            <button type="button" className={`button small ${curve === 'roc' ? 'primary' : 'ghost'}`} aria-pressed={curve === 'roc'} onClick={() => setCurve('roc')}>ROC</button>
            <button type="button" className={`button small ${curve === 'pr' ? 'primary' : 'ghost'}`} aria-pressed={curve === 'pr'} onClick={() => setCurve('pr')}>Precision–recall</button>
          </div>
        }>
          {errors.curves ? <StatusMessage>{errors.curves}</StatusMessage> : data.curves ? (
            <div>
              <CurveChart points={curve === 'roc' ? data.curves.roc : data.curves.precision_recall} kind={curve} baseline={baseline} />
              <p className="muted data-note">{curve === 'roc' ? 'Dashed line: random ranking. The curve plots true positive rate against false positive rate.' : `The curve plots precision against recall.${Number.isFinite(baseline) ? ` Dashed line: test-set default prevalence (${formatPercent(baseline)}).` : ''}`}</p>
            </div>
          ) : <p className="empty-state">{loading ? 'Loading curves…' : 'No evaluation curves were exported.'}</p>}
        </Panel>
      </div>
      {info && (
        <Panel title="Model details" description="Features and parameters stored with the exported model.">
          <div className="two-column">
            <div><h3 className="card-title">Features</h3><div className="feature-tags">{(info.features || []).map((feature) => <span className="badge" key={feature}>{feature.replaceAll('_', ' ')}</span>)}</div></div>
            <div><h3 className="card-title">Parameters</h3><dl className="detail-list">{Object.entries(info.parameters || {}).map(([name, value]) => <div key={name}><dt>{name.replaceAll('_', ' ')}</dt><dd>{value === null ? 'Unlimited' : String(value)}</dd></div>)}</dl></div>
          </div>
        </Panel>
      )}
    </div>
  );
}
