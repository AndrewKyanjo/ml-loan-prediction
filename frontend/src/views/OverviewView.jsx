import { useEffect, useState } from 'react';
import DistributionBars from '../components/DistributionBars.jsx';
import MetricCard from '../components/MetricCard.jsx';
import Panel from '../components/Panel.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { apiRequest } from '../utils/api.js';
import { formatNumber, formatPercent } from '../utils/format.js';

const endpoints = {
  overview: '/api/v1/data/overview',
  distributions: '/api/v1/data/distributions',
  rates: '/api/v1/data/default-rates',
};

const featureLabels = {
  person_income: 'Annual income',
  loan_amnt: 'Loan amount',
  person_age: 'Age',
  loan_to_income_ratio: 'Loan-to-income ratio',
  person_home_ownership: 'Home ownership',
  loan_intent: 'Loan purpose',
  cb_person_default_on_file: 'Previous default on file',
};

const categoryLabels = {
  MORTGAGE: 'Mortgage', OTHER: 'Other', OWN: 'Own', RENT: 'Rent',
  DEBTCONSOLIDATION: 'Debt consolidation', EDUCATION: 'Education',
  HOMEIMPROVEMENT: 'Home improvement', MEDICAL: 'Medical', PERSONAL: 'Personal',
  VENTURE: 'Venture', Y: 'Yes', N: 'No',
};

function featureLabel(feature) {
  return featureLabels[feature] || feature.replaceAll('_', ' ');
}

export default function OverviewView() {
  const [data, setData] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [distributionFeature, setDistributionFeature] = useState('loan_amnt');
  const [rateFeature, setRateFeature] = useState('person_home_ownership');

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
          else nextErrors[key] = result.reason.message || 'Could not load this data.';
        });
        setData(nextData);
        setErrors(nextErrors);
        setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);

  const overview = data.overview;
  const histogramFeatures = Object.keys(data.distributions?.histograms || {});
  const selectedDistribution = histogramFeatures.includes(distributionFeature) ? distributionFeature : histogramFeatures[0];
  const rateFeatures = Object.keys(data.rates?.groups || {});
  const selectedRate = rateFeatures.includes(rateFeature) ? rateFeature : rateFeatures[0];
  const rates = data.rates?.groups?.[selectedRate] || [];
  const balanceTotal = overview ? overview.default_count + overview.nondefault_count : 0;
  const defaultShare = balanceTotal > 0 ? overview.default_count / balanceTotal : 0;
  const retry = <button type="button" className="button secondary small" disabled={loading} onClick={() => setReload((value) => value + 1)}>{loading ? 'Loading…' : 'Refresh data'}</button>;

  return (
    <div className="stack">
      <div className="section-heading"><p className="muted">Explore the exported training data and its recorded default patterns.</p>{retry}</div>
      {loading && <StatusMessage type="info">Loading dataset artifacts…</StatusMessage>}
      {errors.overview && <StatusMessage>Dataset overview: {errors.overview}</StatusMessage>}
      {overview && (
        <div className="metrics-grid">
          <MetricCard label="Training observations" value={formatNumber(overview.observations)} hint={`Exported split: ${overview.split}`} />
          <MetricCard label="Recorded defaults" value={formatNumber(overview.default_count)} hint="Positive class · loan_status = 1" />
          <MetricCard label="Non-defaults" value={formatNumber(overview.nondefault_count)} hint="Negative class · loan_status = 0" tone="teal" />
          <MetricCard label="Default rate" value={formatPercent(overview.default_rate)} hint="Share of training observations" />
        </div>
      )}
      <div className="two-column">
        <Panel title="Class balance" description="Recorded loan outcomes in the training split.">
          {overview ? (
            <div className="stack">
              <div className="balance-track" role="img" aria-label={`${formatPercent(defaultShare)} defaults and ${formatPercent(1 - defaultShare)} non-defaults`}>
                <div className="balance-nondefault" style={{ width: `${(1 - defaultShare) * 100}%` }} />
                <div className="balance-default" style={{ width: `${defaultShare * 100}%` }} />
              </div>
              <div className="balance-legend">
                <div><span className="legend-dot teal" />Non-default<strong>{formatNumber(overview.nondefault_count)}</strong></div>
                <div><span className="legend-dot primary" />Default<strong>{formatNumber(overview.default_count)}</strong></div>
              </div>
              <p className="muted data-note">The classes are imbalanced. Precision and recall help explain the model's behavior alongside its overall scores.</p>
            </div>
          ) : <p className="empty-state">{loading ? 'Loading class balance…' : 'Class balance is unavailable.'}</p>}
        </Panel>
        <Panel title="Default rates by group" description="Observed defaults within each training group." actions={selectedRate && (
          <select className="compact-select" aria-label="Group default rates by" value={selectedRate} onChange={(event) => setRateFeature(event.target.value)}>
            {rateFeatures.map((feature) => <option value={feature} key={feature}>{featureLabel(feature)}</option>)}
          </select>
        )}>
          {errors.rates ? <StatusMessage>{errors.rates}</StatusMessage> : rates.length ? (
            <div className="table-wrap"><table>
              <caption className="sr-only">Default rates by {featureLabel(selectedRate)}</caption>
              <thead><tr><th scope="col">Group</th><th scope="col">Count</th><th scope="col">Default rate</th></tr></thead>
              <tbody>{rates.map((row) => (
                <tr key={row.category}>
                  <td>{categoryLabels[row.category] || row.category}</td><td>{formatNumber(row.count)}</td>
                  <td className="rate-cell"><span>{formatPercent(row.default_rate)}</span><div className="progress-track rate-bar" aria-hidden="true"><div className="progress-fill" style={{ width: `${Math.min(1, Math.max(0, row.default_rate)) * 100}%` }} /></div></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <p className="empty-state">{loading ? 'Loading group rates…' : 'No group rates were exported.'}</p>}
        </Panel>
      </div>
      <Panel title="Feature distribution" description="Observation counts across the exported training ranges." actions={selectedDistribution && (
        <select className="compact-select" aria-label="Distribution feature" value={selectedDistribution} onChange={(event) => setDistributionFeature(event.target.value)}>
          {histogramFeatures.map((feature) => <option value={feature} key={feature}>{featureLabel(feature)}</option>)}
        </select>
      )}>
        {errors.distributions ? <StatusMessage>{errors.distributions}</StatusMessage> : selectedDistribution ? (
          <DistributionBars
            bins={data.distributions.histograms[selectedDistribution]}
            label={featureLabel(selectedDistribution)}
            formatBoundary={(value) => selectedDistribution === 'loan_to_income_ratio' ? formatPercent(value) : formatNumber(value, selectedDistribution === 'person_age' ? 1 : 0)}
          />
        ) : <p className="empty-state">{loading ? 'Loading distributions…' : 'No distributions were exported.'}</p>}
      </Panel>
    </div>
  );
}
