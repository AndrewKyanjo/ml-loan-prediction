import { useId } from 'react';
import { formatNumber } from '../utils/format.js';

export default function DistributionBars({ bins, label, formatBoundary = formatNumber }) {
  const titleId = useId();
  const values = (Array.isArray(bins) ? bins : []).filter(
    (bin) => Number.isFinite(bin.start) && Number.isFinite(bin.end) && Number.isFinite(bin.count),
  );

  if (values.length === 0) {
    return <p className="empty-state">No distribution bins were exported for this feature.</p>;
  }

  const plot = { left: 58, top: 20, width: 710, height: 172 };
  const maximum = Math.max(...values.map((bin) => bin.count), 1);
  const step = plot.width / values.length;
  const middle = Math.floor(values.length / 2);

  return (
    <div>
      <svg className="chart-svg chart-primary histogram-svg" viewBox="0 0 800 248" role="img" aria-labelledby={titleId}>
        <title id={titleId}>{`${label} distribution. Each bar shows the number of training observations in its range. Exact counts are available in the table below.`}</title>
        {[0, 0.5, 1].map((fraction) => {
          const y = plot.top + (1 - fraction) * plot.height;
          return (
            <g key={fraction}>
              <line className="chart-grid" x1={plot.left} x2={plot.left + plot.width} y1={y} y2={y} />
              <text className="chart-tick" x={plot.left - 10} y={y + 4} textAnchor="end">{formatNumber(maximum * fraction)}</text>
            </g>
          );
        })}
        {values.map((bin, index) => {
          const height = (bin.count / maximum) * plot.height;
          return (
            <rect className="chart-bar" key={`${bin.start}-${index}`} x={plot.left + index * step + 2} y={plot.top + plot.height - height} width={Math.max(step - 4, 1)} height={height} rx="3">
              <title>{`${formatBoundary(bin.start)} to ${formatBoundary(bin.end)}: ${formatNumber(bin.count)} observations`}</title>
            </rect>
          );
        })}
        <line className="chart-axis" x1={plot.left} x2={plot.left + plot.width} y1={plot.top + plot.height} y2={plot.top + plot.height} />
        <text className="chart-tick" x={plot.left} y="214">{formatBoundary(values[0].start)}</text>
        <text className="chart-tick" x={plot.left + middle * step} y="214" textAnchor="middle">{formatBoundary(values[middle].start)}</text>
        <text className="chart-tick" x={plot.left + plot.width} y="214" textAnchor="end">{formatBoundary(values.at(-1).end)}</text>
        <text className="chart-label" x={plot.left + plot.width / 2} y="242" textAnchor="middle">{label}</text>
      </svg>
      <details className="chart-data-table">
        <summary>View ranges and counts</summary>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{label} training distribution</caption>
            <thead><tr><th scope="col">Range</th><th scope="col">Observations</th></tr></thead>
            <tbody>{values.map((bin, index) => (
              <tr key={`${bin.start}-${index}`}>
                <td>{formatBoundary(bin.start)} – {formatBoundary(bin.end)}</td>
                <td>{formatNumber(bin.count)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
