import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_APPLICANT, SAMPLE_APPLICANTS, parseApplicantForm, parseBatchApplicants, validateApplicant, validateThreshold } from '../src/utils/applicants.js';

test('single form converts numeric text and allows unknown employment length', () => {
  const values = Object.fromEntries(Object.entries(DEFAULT_APPLICANT).map(([key, value]) => [key, String(value)]));
  values.person_emp_length = '';
  const applicant = parseApplicantForm(values);
  assert.equal(applicant.person_age, 28);
  assert.equal(applicant.person_emp_length, null);
  assert.deepEqual(validateApplicant(applicant), {});
  values.person_income = '';
  assert.match(validateApplicant(parseApplicantForm(values)).person_income, /valid number/);
});

test('batch accepts examples and schema boundary values without mutating them', () => {
  const applicant = { ...DEFAULT_APPLICANT, person_age: 18, person_emp_length: 85, cb_person_cred_hist_length: 100 };
  assert.deepEqual(parseBatchApplicants(JSON.stringify([applicant])), [applicant]);
  assert.deepEqual(parseBatchApplicants(JSON.stringify(SAMPLE_APPLICANTS)), SAMPLE_APPLICANTS);
  delete applicant.person_emp_length;
  assert.deepEqual(validateApplicant(applicant), {});
});

test('batch refuses invalid JSON, invalid counts, extra fields and nonnumeric values', () => {
  assert.throws(() => parseBatchApplicants('{'), /valid JSON/);
  assert.throws(() => parseBatchApplicants('[]'), /between 1 and 100/);
  assert.throws(() => parseBatchApplicants(JSON.stringify(Array(101).fill(DEFAULT_APPLICANT))), /between 1 and 100/);
  assert.throws(() => parseBatchApplicants(JSON.stringify([null])), /Applicant 1/);
  assert.throws(() => parseBatchApplicants(JSON.stringify([{ ...DEFAULT_APPLICANT, loan_amnt: '500' }])), /Loan amount/);
  assert.throws(() => parseBatchApplicants(JSON.stringify([{ ...DEFAULT_APPLICANT, id: '123' }])), /Unexpected fields/);
  assert.throws(() => parseBatchApplicants(JSON.stringify([{ ...DEFAULT_APPLICANT, person_age: 25.5 }])), /whole number/);
  assert.throws(() => parseBatchApplicants(JSON.stringify([{ ...DEFAULT_APPLICANT, person_income: 0 }])), /greater than 0/);
  assert.throws(() => parseBatchApplicants(JSON.stringify([{ ...DEFAULT_APPLICANT, cb_person_default_on_file: 'yes' }])), /choose N, Y/);
});

test('threshold allows zero and one while rejecting blanks and out-of-range values', () => {
  for (const value of [0, 1, 0.5, '0.5']) assert.equal(validateThreshold(value), '');
  for (const value of ['', ' ', null, undefined, NaN, -0.1, 1.1]) assert.ok(validateThreshold(value));
});
