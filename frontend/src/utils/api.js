const environment = import.meta.env ?? {};

export const API_BASE_URL = (environment.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const backendUrl = (API_BASE_URL || environment.VITE_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
export const API_DOCS_URL = `${backendUrl}/docs`;

function describeApiError(payload, status) {
  const detail = payload?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => {
      const location = (item.loc ?? []).filter((part) => part !== 'body' && part !== 'query');
      const field = location.map((part, index) => (
        typeof part === 'number' && location[index - 1] === 'applicants' ? `Applicant ${part + 1}` : part
      )).filter((part) => part !== 'applicants').join(' › ');
      return `${field ? `${field}: ` : ''}${item.msg ?? 'Invalid value'}`;
    }).join('; ');
  }
  return `The API returned an error (${status}). Please try again.`;
}

// Requests use Vite's local proxy unless an API base URL is supplied.
export async function apiRequest(path, { signal, timeoutMs = 30000, ...options } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, signal: controller.signal });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(response.ok
        ? 'The API returned an unexpected response. Check the backend URL.'
        : `The API returned an error (${response.status}). Check that the backend is running.`);
    }
    if (!response.ok) {
      const error = new Error(describeApiError(payload, response.status));
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
    if (timedOut) throw new Error('The API took too long to respond. Please try again.');
    if (error instanceof TypeError) {
      throw new Error('Could not reach the API. Start the backend and check your API URL.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function predictApplicant(applicant, threshold = 0.5, options = {}) {
  return apiRequest(`/api/v1/predict?threshold=${encodeURIComponent(threshold)}`, {
    ...options,
    method: 'POST',
    body: JSON.stringify(applicant),
  });
}

export function predictBatch(applicants, threshold = 0.5, options = {}) {
  return apiRequest(`/api/v1/predict/batch?threshold=${encodeURIComponent(threshold)}`, {
    ...options,
    method: 'POST',
    body: JSON.stringify({ applicants }),
  });
}
