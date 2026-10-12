# RiskML Explorer

A small React frontend for the existing FastAPI credit risk model. It uses plain JavaScript, CSS, React state, and native `fetch`. The lavender, indigo, and teal palette comes from the reference designs in `../html/`.

## Run locally

Use Node.js 20.19+ or 22.12+ and the project's Python virtual environment. Start the backend from the repository root:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open **http://localhost:3000**. On macOS/Linux, use `npm` and your environment's Python executable. The API must have the saved pipeline at `models/credit_risk_pipeline.joblib`; dataset and evaluation views read the JSON exports in `artifacts/`.

## Views

- **Prediction playground:** eight applicant inputs, synthetic examples, a threshold slider, actual probability and classification, and request/response inspection.
- **Batch predictions:** edit a JSON array of 1–100 applicants, score once, inspect the results, and download JSON. Optional employment length accepts `null`.
- **Dataset overview:** training counts, class balance, group default rates, and feature distributions.
- **Model performance:** exported model information, holdout metrics, confusion matrix, ROC and precision–recall curves, features, and parameters.

Results retain the threshold and inputs used in the completed request. Editing inputs requires another prediction. Saved holdout metrics remain tied to the threshold stored by the backend.

## Backend connection

Local development and `npm.cmd run preview` proxy `/api` and `/health` to `http://127.0.0.1:8000`, so no backend CORS change is needed. To change the backend port, copy `.env.example` to `.env.local`, set `VITE_BACKEND_URL`, and restart Vite.

For a separate frontend deployment, set `VITE_API_BASE_URL` to the backend origin before building. Configure the backend's `CORS_ORIGINS` to include the deployed frontend origin. Alternatively, configure the hosting server to reverse proxy `/api` and `/health`. Vite's development proxy is not part of the production build. Environment values beginning with `VITE_` are public; do not put secrets in them.

## Structure

```text
src/
  components/  Shared form, threshold, panels, metric cards, and simple SVG charts
  utils/       API requests, applicant schemas/validation, and number formatting
  views/       Prediction, batch, overview, and performance views
  App.jsx      Navigation and backend connection status
  styles.css   Responsive styling and the reference color palette
```

The hash navigation works without a routing dependency. Data views load only when opened, requests cancel when leaving a view, and connection errors and missing artifacts are displayed inline. The app stores no applicants in browser storage.

## Verify and build

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

The tests check API request/error behavior and applicant/batch validation. Production files are written to `dist/`. React and Vite reference documentation: [React](https://react.dev/learn/build-a-react-app-from-scratch), [Vite](https://vite.dev/guide/).
