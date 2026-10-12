import { APPLICANT_FIELDS } from '../utils/applicants.js';

export default function ApplicantForm({ values, onChange, errors = {}, disabled = false }) {
  return (
    <div className="form-grid">
      {APPLICANT_FIELDS.map((field) => {
        const hint = field.optional ? 'Leave empty if unknown.' : field.integer ? `${field.min}–${field.max} years.` : '';
        const error = errors[field.key];
        const describedBy = error ? `${field.key}-error` : hint ? `${field.key}-hint` : undefined;
        const shared = {
          id: field.key,
          name: field.key,
          className: `input ${error ? 'invalid' : ''}`,
          value: values[field.key] ?? '',
          onChange: (event) => onChange(field.key, event.target.value),
          disabled,
          required: !field.optional,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
        };
        return (
          <div className="form-field" key={field.key}>
            <label htmlFor={field.key}>{field.label}{field.optional && <span className="optional-label"> optional</span>}</label>
            {field.type === 'select' ? (
              <select {...shared}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            ) : <input {...shared} type="number" min={field.min} max={field.max} step={field.step} />}
            {error ? <p className="field-error" id={`${field.key}-error`}>{error}</p> : hint && <p className="field-hint" id={`${field.key}-hint`}>{hint}</p>}
          </div>
        );
      })}
    </div>
  );
}
