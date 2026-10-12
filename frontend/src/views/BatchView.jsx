import { useEffect, useRef, useState } from 'react';
import Panel from '../components/Panel.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import ThresholdControl from '../components/ThresholdControl.jsx';
import { predictBatch } from '../utils/api.js';
import { SAMPLE_APPLICANTS, parseBatchApplicants, validateThreshold } from '../utils/applicants.js';
import { formatCurrency, formatPercent, formatScore } from '../utils/format.js';

const examples = JSON.stringify(SAMPLE_APPLICANTS, null, 2);

export default function BatchView() {
  const [input, setInput] = useState(examples);
  const [threshold, setThreshold] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [run, setRun] = useState(null);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (request.current) return;
    setError('');
    let applicants;
    try {
      applicants = parseBatchApplicants(input);
      const thresholdError = validateThreshold(threshold);
      if (thresholdError) throw new Error(thresholdError);
    } catch (validationError) {
      setError(validationError.message);
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    const runThreshold = Number(threshold);
    try {
      const predictions = await predictBatch(applicants, runThreshold, { signal: controller.signal });
      if (!Array.isArray(predictions) || predictions.length !== applicants.length || predictions.some((prediction) => (
        !prediction || !Number.isFinite(prediction.default_probability) || prediction.default_probability < 0 ||
        prediction.default_probability > 1 || typeof prediction.predicted_default !== 'boolean'
      ))) {
        throw new Error('The API returned an unexpected batch response. Please try again.');
      }
      if (!controller.signal.aborted) setRun({ applicants, predictions, threshold: runThreshold });
    } catch (requestError) {
      if (requestError.name !== 'AbortError') setError(requestError.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (request.current === controller) request.current = null;
    }
  }

  function downloadResults() {
    if (!run) return;
    const content = run.predictions.map((prediction, index) => ({
      applicant_number: index + 1,
      applicant: run.applicants[index],
      ...prediction,
    }));
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'batch-predictions.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const flagged = run?.predictions.filter((prediction) => prediction.predicted_default).length ?? 0;
  const mean = run ? run.predictions.reduce((sum, prediction) => sum + prediction.default_probability, 0) / run.predictions.length : null;

  return (
    <div className="view-stack">
      <Panel title="Applicant data" description="Paste a JSON array using the example fields, then choose a threshold.">
        <form onSubmit={handleSubmit} aria-busy={loading} className="form-stack">
          <div className="form-field">
            <label htmlFor="batch-applicants">Applicants (1–100 records)</label>
            <textarea
              id="batch-applicants"
              className="input code-input"
              rows={16}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              aria-describedby="batch-help"
              spellCheck={false}
              required
            />
            <p id="batch-help" className="field-hint">Use the exact field names shown below. Employment length can be null when unknown.</p>
          </div>
          <div className="batch-controls">
            <ThresholdControl id="batch-threshold" value={threshold} onChange={setThreshold} disabled={loading} />
            <div className="button-row">
              <button type="button" className="button secondary" disabled={loading} onClick={() => { setInput(examples); setError(''); }}>Load examples</button>
              <button type="submit" className="button primary" disabled={loading}>{loading ? 'Running batch…' : 'Run batch prediction'}</button>
            </div>
          </div>
          {error && <StatusMessage type="error">{error}</StatusMessage>}
          {loading && <StatusMessage type="info">Scoring your applicants…</StatusMessage>}
        </form>
      </Panel>

      {run ? (
        <Panel
          title="Batch results"
          description={`Last completed run: ${run.predictions.length} applicants at threshold ${formatScore(run.threshold, 2)}. Run again to apply any input changes.`}
          actions={<button type="button" className="button secondary" onClick={downloadResults}>Download JSON</button>}
        >
          <div className="batch-summary">
            <div><span className="muted">Applicants scored</span><strong>{run.predictions.length}</strong></div>
            <div><span className="muted">Mean default probability</span><strong>{formatPercent(mean)}</strong></div>
            <div><span className="muted">Predicted defaults</span><strong>{flagged} / {run.predictions.length}</strong></div>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">Predictions for the last completed batch in the same order as the submitted applicants</caption>
              <thead><tr><th scope="col">Applicant</th><th scope="col">Age</th><th scope="col">Loan amount</th><th scope="col">Default probability</th><th scope="col">Prediction</th></tr></thead>
              <tbody>{run.predictions.map((prediction, index) => (
                <tr key={index}>
                  <th scope="row">#{index + 1}</th>
                  <td>{run.applicants[index].person_age}</td>
                  <td>{formatCurrency(run.applicants[index].loan_amnt)}</td>
                  <td className="mono">{formatPercent(prediction.default_probability)}</td>
                  <td><span className={`badge ${prediction.predicted_default ? 'badge-error' : 'badge-success'}`}>{prediction.predicted_default ? 'Default' : 'Non-default'}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <details className="json-details"><summary>View API response</summary><pre className="code-block">{JSON.stringify(run.predictions, null, 2)}</pre></details>
        </Panel>
      ) : <StatusMessage type="info">Run a batch to see actual model scores here. The examples contain four synthetic applicants.</StatusMessage>}
    </div>
  );
}
