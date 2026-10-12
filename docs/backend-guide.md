# SQLite dataset and prediction storage

The existing FastAPI backend uses Python's built-in `sqlite3` module. Its default database is `data/app.db`; no separate database server or ORM is needed. [Python SQLite documentation](https://docs.python.org/3/library/sqlite3.html).

## What is stored

| Table | Purpose |
| --- | --- |
| `dataset_imports` | CSV filename, SHA256 content hash, import timestamp, row count |
| `dataset_rows` | All 12 original dataset fields, import ID, and original row position |
| `predictions` | The eight submitted applicant fields, score, classification, threshold, timestamp, model version, optional MLflow run ID, and request information |

The raw CSV has **32,581 rows**. Its missing values become SQL `NULL`, while historical outliers such as employment length 123 remain available for audit. The training notebooks apply their existing cleaning and feature engineering separately. The imported rows retain `loan_status` as the historical outcome. New prediction records hold estimates until real outcomes become available.

`mlflow.db` remains MLflow's tracking database. The application stores its records in `data/app.db`.

## Import a CSV

From the project root:

```powershell
.\.venv\Scripts\python.exe -m scripts.import_dataset
```

To select paths explicitly:

```powershell
.\.venv\Scripts\python.exe -m scripts.import_dataset --csv data/raw/data.csv --database data/app.db
```

The importer expects the original dataset's 12 columns. It validates the header and numeric types, hashes the file's contents, and writes one transaction. Identical file contents return `reused: true` and `inserted_rows: 0`. A changed file gets a new import ID; its rows can be selected by that ID. A malformed file leaves the existing data intact.

Dataset income, loan amount, age, credit history, and target use integer columns; employment length, interest rate, and loan percentage use real columns; categories use text. Prediction income and loan amount use real columns because the API accepts decimal amounts.

## API routes

Start the backend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000/docs** to send requests through Swagger's **Try it out** buttons.

| Route | Result |
| --- | --- |
| `GET /api/v1/database/summary` | Imported row, import, and saved prediction counts |
| `GET /api/v1/dataset/imports` | CSV import metadata |
| `GET /api/v1/dataset/rows?limit=20&offset=0` | Paginated original records |
| `GET /api/v1/dataset/rows?import_id=1&limit=20` | Records from one import |
| `POST /api/v1/predict?threshold=0.5` | Predict and store one applicant |
| `POST /api/v1/predict/batch?threshold=0.5` | Predict and store 1–100 applicants atomically |
| `GET /api/v1/predictions?limit=20&offset=0` | Latest prediction records first |
| `GET /api/v1/predictions/1` | One stored prediction with its applicant details |

Paged responses have `items`, `total`, `limit`, and `offset`; API page sizes are 1–100. An unknown prediction ID returns 404. The dashboard's `/api/v1/data/*` routes serve the exported training analyses. The new `/api/v1/dataset/rows` route exposes the full imported source.

The existing prediction response fields remain available. Each response also contains `prediction_id`, `request_id`, `created_at`, and optional `model_run_id`. Batch members share a request ID and UTC timestamp; their stored `position` starts at 1 and preserves submitted order. The React frontend accepts the extra fields and exposes them through its response inspector.

Inputs are validated before inference. Invalid requests and a missing model do not create prediction records. The API returns an error if saving a prediction fails, so a successful prediction response always has a saved record. A failed batch write rolls back all members. Scores retain their full numeric precision; the displayed UI percentage is rounded for readability.

## Inspect SQLite directly

This Python example reads the database without installing another tool:

```python
import sqlite3
from contextlib import closing

with closing(sqlite3.connect("data/app.db")) as connection:
    connection.row_factory = sqlite3.Row
    count = connection.execute("SELECT COUNT(*) FROM dataset_rows").fetchone()[0]
    print("Dataset rows:", count)
    rows = connection.execute("""
        SELECT id, created_at, request_kind, default_probability,
               predicted_default, threshold, model_version, model_run_id
        FROM predictions
        ORDER BY id DESC
        LIMIT 5
    """).fetchall()
    for row in rows:
        print(dict(row))
```

Or load the imported dataset into pandas:

```python
import pandas as pd
import sqlite3
from contextlib import closing

with closing(sqlite3.connect("data/app.db")) as connection:
    data = pd.read_sql_query(
        "SELECT * FROM dataset_rows WHERE import_id = ? ORDER BY source_row",
        connection,
        params=(1,),
    )
print(data.shape)
```

The current training notebooks continue using their established Parquet splits. This SQL example gives you a way to read the imported data for future experiments while keeping split creation explicit.

## Connect model history to MLflow

After logging the exact saved pipeline with `scripts.track_mlflow`, copy its printed run ID and set it before starting/restarting the API:

```powershell
$env:MODEL_RUN_ID = "PASTE_THE_EXPORTED_RUN_ID"
.\.venv\Scripts\python.exe -m uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
```

Each new prediction then records that run ID. It is optional; inference and SQLite storage operate independently of MLflow availability. The API's model version comes from `artifacts/model_info.json`, or `MODEL_VERSION` when explicitly set. Update the run ID when serving a different model.

## Local operation

Each operation uses a fresh connection. Write-ahead logging, a busy timeout, bound query parameters, and transactions support this local app's concurrent requests. Database initialization also adds the optional run-ID column to an earlier schema while retaining existing history.

You can set `$env:DATABASE_PATH = "data/app.db"` to choose the application file. `MODEL_PATH`, `ARTIFACT_DIR`, `MODEL_VERSION`, and `MODEL_RUN_ID` configure inference metadata. Root `.env.example` lists the variables; set them in the terminal before launching Python.

The database and its SQLite sidecar files are ignored by Git. To back up a running database consistently, use SQLite's backup API:

```python
import sqlite3
from contextlib import closing

with closing(sqlite3.connect("data/app.db")) as source:
    with closing(sqlite3.connect("data/app-backup.db")) as destination:
        source.backup(destination)
```
