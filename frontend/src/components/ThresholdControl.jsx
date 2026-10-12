export default function ThresholdControl({
  value,
  onChange,
  disabled = false,
  id = "threshold",
}) {
  return (
    <div className="threshold-control">
      <div className="threshold-heading">
        <label htmlFor={id}>Default threshold</label>
        <output htmlFor={id}>{Number(value).toFixed(2)}</output>
      </div>
      <input
        id={id}
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={disabled}
        aria-describedby={`${id}-help`}
      />
      <p id={`${id}-help`} className="field-hint">
        A probability at or above this threshold is classified as predicted
        default.
      </p>
    </div>
  );
}
