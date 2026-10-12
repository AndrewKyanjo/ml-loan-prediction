import { useEffect, useRef, useState } from 'react';
import Panel from '../components/Panel.jsx';
import ApplicantForm from '../components/ApplicantForm.jsx';
import ThresholdControl from '../components/ThresholdControl.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import Icon from '../components/Icon.jsx';
import { DEFAULT_APPLICANT, SAMPLE_APPLICANTS, parseApplicantForm, validateApplicant } from '../utils/applicants.js';
import { predictApplicant } from '../utils/api.js';
import { formatPercent, formatScore, formatCurrency } from '../utils/format.js';

export default function PredictionView() {
  const [values, setValues] = useState({ ...DEFAULT_APPLICANT });
  const [threshold, setThreshold] = useState(0.5);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [run, setRun] = useState(null);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  function changeField(key, value) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setError('');
  }

  function loadExample(index) {
    setValues({ ...SAMPLE_APPLICANTS[index] });
    setErrors({});
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (request.current) return;
    const applicant = parseApplicantForm(values);
    const validation = validateApplicant(applicant);
    setErrors(validation);
    setError('');
    if (Object.keys(validation).length) {
      setError('Check the highlighted fields before running a prediction.');
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const prediction = await predictApplicant(applicant, threshold, { signal: controller.signal });
      if (!prediction || !Number.isFinite(prediction.default_probability) || prediction.default_probability < 0 || prediction.default_probability > 1 || typeof prediction.predicted_default !== 'boolean') {
        throw new Error('The API returned an unexpected prediction response.');
      }
      if (!controller.signal.aborted) setRun({ applicant, prediction });
    } catch (requestError) {
      if (requestError.name !== 'AbortError') setError(requestError.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (request.current === controller) request.current = null;
    }
  }

  const prediction = run?.prediction;
  const changed = run && (JSON.stringify(parseApplicantForm(values)) !== JSON.stringify(run.applicant) || threshold !== prediction.threshold);

  return (
    <div className="prediction-layout">
      <Panel title="Applicant details" description="Enter an applicant’s information or start with an example.">
        <form onSubmit={submit} noValidate aria-busy={loading} className="form-stack">
          <div className="example-controls">
            <span className="muted">Try an example</span>
            <div className="button-row">
              <button type="button" className="button secondary small" disabled={loading} onClick={() => loadExample(0)}>Everyday borrower</button>
              <button type="button" className="button secondary small" disabled={loading} onClick={() => loadExample(2)}>Larger loan</button>
            </div>
          </div>
          <ApplicantForm values={values} onChange={changeField} errors={errors} disabled={loading} />
          <ThresholdControl value={threshold} onChange={setThreshold} disabled={loading} id="single-threshold" />
          {error && <StatusMessage>{error}</StatusMessage>}
          <div className="form-submit-row">
            <span className="field-hint">Eight inputs. One model prediction.</span>
            <button className="button primary" type="submit" disabled={loading}><Icon name="predict" size={18} />{loading ? 'Running prediction…' : 'Run prediction'}{!loading && <Icon name="arrow" size={16} />}</button>
          </div>
        </form>
      </Panel>
      <div className="stack result-column">
        <Panel title="Prediction result" description="The model’s estimated probability of default." className="prediction-result">
          <div aria-live="polite" aria-busy={loading}>
            {loading ? (
              <div className="empty-state"><span className="loading-spinner" /><h3>Scoring applicant…</h3><p>The model is processing your inputs.</p></div>
            ) : prediction ? (
              <>
                <div className="result-heading"><span className={`badge ${prediction.predicted_default ? 'badge-error' : 'badge-success'}`}>{prediction.predicted_default ? 'Predicted default' : 'Predicted non-default'}</span><span className="muted">Last completed run</span></div>
                <div className="probability-display">{formatPercent(prediction.default_probability)}</div>
                <p className="probability-label">Default probability</p>
                <div className="probability-meter" role="img" aria-label={`Default probability ${formatPercent(prediction.default_probability)}, threshold ${formatPercent(prediction.threshold)}`}>
                  <div className={`probability-fill ${prediction.predicted_default ? 'flagged' : ''}`} style={{ width: `${prediction.default_probability * 100}%` }} />
                  <span className="threshold-marker" style={{ left: `${prediction.threshold * 100}%` }} />
                </div>
                <div className="meter-labels"><span>0%</span><span>Threshold {formatPercent(prediction.threshold, 0)}</span><span>100%</span></div>
                <dl className="detail-list result-details"><div><dt>Threshold used</dt><dd>{formatScore(prediction.threshold, 2)}</dd></div><div><dt>Model version</dt><dd>{prediction.model_version}</dd></div><div><dt>Loan amount</dt><dd>{formatCurrency(run.applicant.loan_amnt)}</dd></div></dl>
                {changed && <StatusMessage type="info">Inputs have changed. Run a new prediction to update this result.</StatusMessage>}
                <details className="json-details"><summary>View request and response</summary><h3 className="code-label">Applicant sent</h3><pre className="code-block">{JSON.stringify(run.applicant, null, 2)}</pre><h3 className="code-label">API response</h3><pre className="code-block">{JSON.stringify(prediction, null, 2)}</pre></details>
              </>
            ) : (
              <div className="empty-state"><span className="empty-state-icon"><Icon name="predict" size={28} /></span><h3>Your prediction starts here</h3><p>Fill in the applicant details and run a prediction to see the model’s score.</p></div>
            )}
          </div>
        </Panel>
        <div className="tips-card"><span className="eyebrow">HOW TO EXPLORE</span><h3>Change one input at a time.</h3><p>Try a different loan amount, income, or threshold and compare the next result. A higher threshold flags fewer applicants as predicted defaults.</p></div>
      </div>
    </div>
  );
}
