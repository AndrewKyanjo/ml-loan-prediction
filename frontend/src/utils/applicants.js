export const APPLICANT_FIELDS = [
  { key: 'person_age', label: 'Age', type: 'number', min: 18, max: 100, step: 1, integer: true },
  { key: 'person_income', label: 'Annual income ($)', type: 'number', min: 0, exclusiveMin: true, step: 'any' },
  { key: 'person_home_ownership', label: 'Home ownership', type: 'select', options: [
    { value: 'RENT', label: 'Rent' }, { value: 'OWN', label: 'Own' },
    { value: 'MORTGAGE', label: 'Mortgage' }, { value: 'OTHER', label: 'Other' },
  ] },
  { key: 'person_emp_length', label: 'Employment length (years)', type: 'number', min: 0, max: 85, step: 'any', optional: true },
  { key: 'loan_intent', label: 'Loan purpose', type: 'select', options: [
    { value: 'PERSONAL', label: 'Personal' }, { value: 'EDUCATION', label: 'Education' },
    { value: 'MEDICAL', label: 'Medical' }, { value: 'VENTURE', label: 'Business venture' },
    { value: 'HOMEIMPROVEMENT', label: 'Home improvement' }, { value: 'DEBTCONSOLIDATION', label: 'Debt consolidation' },
  ] },
  { key: 'loan_amnt', label: 'Loan amount ($)', type: 'number', min: 0, exclusiveMin: true, step: 'any' },
  { key: 'cb_person_default_on_file', label: 'Previous default on file', type: 'select', options: [
    { value: 'N', label: 'No' }, { value: 'Y', label: 'Yes' },
  ] },
  { key: 'cb_person_cred_hist_length', label: 'Credit history (years)', type: 'number', min: 0, max: 100, step: 1, integer: true },
];

export const SAMPLE_APPLICANTS = [
  {
    person_age: 28, person_income: 64000, person_home_ownership: 'RENT', person_emp_length: 4,
    loan_intent: 'DEBTCONSOLIDATION', loan_amnt: 15000, cb_person_default_on_file: 'N', cb_person_cred_hist_length: 6,
  },
  {
    person_age: 42, person_income: 115000, person_home_ownership: 'MORTGAGE', person_emp_length: 9,
    loan_intent: 'HOMEIMPROVEMENT', loan_amnt: 12000, cb_person_default_on_file: 'N', cb_person_cred_hist_length: 14,
  },
  {
    person_age: 34, person_income: 42000, person_home_ownership: 'RENT', person_emp_length: 1,
    loan_intent: 'MEDICAL', loan_amnt: 28000, cb_person_default_on_file: 'Y', cb_person_cred_hist_length: 4,
  },
  {
    person_age: 20, person_income: 31000, person_home_ownership: 'RENT', person_emp_length: null,
    loan_intent: 'EDUCATION', loan_amnt: 7500, cb_person_default_on_file: 'N', cb_person_cred_hist_length: 1,
  },
];

export const DEFAULT_APPLICANT = { ...SAMPLE_APPLICANTS[0] };

export function parseApplicantForm(values) {
  return Object.fromEntries(APPLICANT_FIELDS.map((field) => {
    const value = values[field.key];
    if (field.type === 'select') return [field.key, value];
    if (field.optional && (value === '' || value === null || value === undefined)) return [field.key, null];
    return [field.key, value === '' || value === null || value === undefined ? NaN : Number(value)];
  }));
}

export function validateApplicant(applicant) {
  if (!applicant || typeof applicant !== 'object' || Array.isArray(applicant)) {
    return { _form: 'Each applicant must be a JSON object.' };
  }
  const errors = {};
  const extraFields = Object.keys(applicant).filter((key) => !APPLICANT_FIELDS.some((field) => field.key === key));
  if (extraFields.length) errors._form = `Unexpected fields: ${extraFields.join(', ')}.`;

  for (const field of APPLICANT_FIELDS) {
    const value = applicant[field.key];
    if (field.optional && (value === null || value === undefined)) continue;
    if (field.type === 'select') {
      if (!field.options.some((option) => option.value === value)) {
        errors[field.key] = `${field.label}: choose ${field.options.map((option) => option.value).join(', ')}.`;
      }
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors[field.key] = `${field.label}: enter a valid number.`;
    } else if (field.integer && !Number.isInteger(value)) {
      errors[field.key] = `${field.label}: enter a whole number.`;
    } else if (field.exclusiveMin && value <= field.min) {
      errors[field.key] = `${field.label}: must be greater than ${field.min}.`;
    } else if (value < field.min || (field.max !== undefined && value > field.max)) {
      errors[field.key] = `${field.label}: must be between ${field.min} and ${field.max}.`;
    }
  }
  return errors;
}

export function validateThreshold(value) {
  if ((typeof value === 'string' && !value.trim()) || value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1) {
    return 'Threshold must be a number between 0 and 1.';
  }
  return '';
}

export function parseBatchApplicants(text) {
  let applicants;
  try {
    applicants = JSON.parse(text);
  } catch {
    throw new Error('Enter valid JSON: an array of applicant objects. You can load the examples to start.');
  }
  if (!Array.isArray(applicants) || applicants.length < 1 || applicants.length > 100) {
    throw new Error('Provide a JSON array containing between 1 and 100 applicants.');
  }
  for (const [index, applicant] of applicants.entries()) {
    const messages = Object.values(validateApplicant(applicant));
    if (messages.length) throw new Error(`Applicant ${index + 1}: ${messages.join(' ')}`);
  }
  return applicants;
}
