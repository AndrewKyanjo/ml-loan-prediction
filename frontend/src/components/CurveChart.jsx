import { useId } from 'react';

const ticks = [0, 0.25, 0.5, 0.75, 1];
const plot = { left: 54, top: 18, width: 432, height: 188 };

export default function CurveChart({ points, kind = 'roc', baseline }) {
  const titleId = useId();
  const isRoc = kind === 'roc';
  const xKey = isRoc ? 'fpr' : 'recall';
  const yKey = isRoc ? 'tpr' : 'precision';
  const values = (Array.isArray(points) ? points : []).filter(
    (point) => Number.isFinite(point[xKey]) && Number.isFinite(point[yKey]),
  );
  const x = (value) => plot.left + Math.max(0, Math.min(1, value)) * plot.width;
  const y = (value) => plot.top + (1 - Math.max(0, Math.min(1, value))) * plot.height;
  const path = values.map((point, index) => `${index ? 'L' : 'M'} ${x(point[xKey])} ${y(point[yKey])}`).join(' ');
  const title = isRoc ? 'ROC curve' : 'Precision–recall curve';

  if (values.length === 0) {
    return <p className="empty-state">No {title.toLowerCase()} points were exported.</p>;
  }

  return (
    <svg className={`chart-svg ${isRoc ? 'chart-primary' : 'chart-teal'}`} viewBox="0 0 520 254" role="img" aria-labelledby={titleId}>
      <title id={titleId}>{`${title}. ${isRoc ? 'False positive rate against true positive rate' : 'Recall against precision'} on the exported test set.`}</title>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="chart-grid" x1={plot.left} x2={plot.left + plot.width} y1={y(tick)} y2={y(tick)} />
          <line className="chart-grid" x1={x(tick)} x2={x(tick)} y1={plot.top} y2={plot.top + plot.height} />
          <text className="chart-tick" x={plot.left - 9} y={y(tick) + 4} textAnchor="end">{tick}</text>
          <text className="chart-tick" x={x(tick)} y={plot.top + plot.height + 19} textAnchor="middle">{tick}</text>
        </g>
      ))}
      <line className="chart-axis" x1={plot.left} x2={plot.left + plot.width} y1={y(0)} y2={y(0)} />
      <line className="chart-axis" x1={plot.left} x2={plot.left} y1={y(0)} y2={y(1)} />
      {isRoc ? (
        <line className="chart-baseline" x1={x(0)} x2={x(1)} y1={y(0)} y2={y(1)} />
      ) : Number.isFinite(baseline) ? (
        <line className="chart-baseline" x1={x(0)} x2={x(1)} y1={y(baseline)} y2={y(baseline)} />
      ) : null}
      <path className="chart-fill" d={`${path} L ${x(values.at(-1)[xKey])} ${y(0)} L ${x(values[0][xKey])} ${y(0)} Z`} />
      <path className="chart-line" d={path} />
      <text className="chart-label" x={plot.left + plot.width / 2} y="249" textAnchor="middle">{isRoc ? 'False positive rate' : 'Recall'}</text>
      <text className="chart-label" x="15" y={plot.top + plot.height / 2} textAnchor="middle" transform={`rotate(-90 15 ${plot.top + plot.height / 2})`}>{isRoc ? 'True positive rate' : 'Precision'}</text>
    </svg>
  );
}
