# Loan prediction playground

A credit risk model with a FastAPI backend, SQLite dataset and prediction history, a plain React frontend, and MLflow experiment tracking.

## Start the backend

Run from this directory in PowerShell:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m scripts.import_dataset
.\.venv\Scripts\python.exe -m uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
```

The importer loads `data/raw/data.csv` into `data/app.db`. Repeating it skips an identical file. The API initializes its tables on startup and stores every successful single/batch prediction before returning it. Model inference uses `models/credit_risk_pipeline.joblib`, and dashboard dataset/metric views use the existing JSON exports in `artifacts/`.

API documentation: **http://127.0.0.1:8000/docs**.

## Start the frontend

In another terminal:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open **http://localhost:3000**. The development server proxies API requests to port 8000. [Frontend setup](frontend/README.md).

## Track the model in MLflow

With your MLflow server running at **http://127.0.0.1:5000**, run this from the project root:

```powershell
.\.venv\Scripts\python.exe -m scripts.track_mlflow
```

Select the **Credit Risk** experiment in the dashboard. The script logs the saved model, actual parameters, recomputed holdout evaluation, input signature, and supporting artifacts. Each execution creates an export run. [Learn MLflow step by step](docs/mlflow-guide.md).

Application records live in `data/app.db`; MLflow uses its own tracking database and artifact store. [Database tables, history endpoints, and SQL examples](docs/backend-guide.md).

## Checks

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Backend tests use temporary databases and verify import reuse, atomic transactions, persistence, validation, paging, and prediction responses. Frontend checks are documented in its README. Tests require FastAPI's HTTP test client; if `httpx` is absent, install it with `.\.venv\Scripts\python.exe -m pip install httpx`.

Configuration variables are documented in [.env.example](.env.example). Set them in your terminal; the Python application does not automatically load that file.
