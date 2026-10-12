import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, predictApplicant, predictBatch } from '../src/utils/api.js';

test('API helpers send the backend JSON contract and retain caller headers', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    const applicant = { person_age: 28 };
    await predictApplicant(applicant, 0.25, { headers: { 'X-Test': 'present' } });
    await predictBatch([applicant], 0);
    assert.equal(requests[0].path, '/api/v1/predict?threshold=0.25');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.headers.get('Content-Type'), 'application/json');
    assert.equal(requests[0].options.headers.get('X-Test'), 'present');
    assert.deepEqual(JSON.parse(requests[0].options.body), applicant);
    assert.equal(requests[1].path, '/api/v1/predict/batch?threshold=0');
    assert.deepEqual(JSON.parse(requests[1].options.body), { applicants: [applicant] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API reports FastAPI detail and maps a batch validation location to its applicant', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Model not found. Run notebook 04.' }), { status: 503 });
    await assert.rejects(apiRequest('/api/v1/predict'), { message: 'Model not found. Run notebook 04.', status: 503 });
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: [{ loc: ['body', 'applicants', 1, 'person_income'], msg: 'Input should be greater than 0' }] }), { status: 422 });
    await assert.rejects(apiRequest('/api/v1/predict/batch'), /Applicant 2 › person_income: Input should be greater than 0/);
    globalThis.fetch = async () => new Response('<html>Proxy error</html>', { status: 502 });
    await assert.rejects(apiRequest('/health'), /error \(502\)/);
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(apiRequest('/health'), /Could not reach the API/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('caller cancellation remains distinct from a visible request timeout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_path, { signal }) => new Promise((_resolve, reject) => {
    const cancel = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    const controller = new AbortController();
    const request = apiRequest('/health', { signal: controller.signal });
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    await assert.rejects(apiRequest('/health', { timeoutMs: 5 }), /took too long/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
