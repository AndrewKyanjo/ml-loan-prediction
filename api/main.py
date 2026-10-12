import json
import os
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from api.schemas import Applicant, Prediction
from api.database import (
    database_summary,
    default_database_path,
    get_prediction,
    initialize_database,
    list_dataset_rows,
    list_imports,
    list_predictions,
    save_predictions,
)
from src.features import engineer_features

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = Path(
    os.getenv("MODEL_PATH", str(ROOT / "models/credit_risk_pipeline.joblib"))
)
ARTIFACT_DIR = Path(os.getenv("ARTIFACT_DIR", str(ROOT / "artifacts")))
DATABASE_PATH = default_database_path()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.database_path = DATABASE_PATH
    initialize_database(app.state.database_path)
    app.state.model = joblib.load(MODEL_PATH) if MODEL_PATH.exists() else None
    info_path = ARTIFACT_DIR / "model_info.json"
    info = json.loads(info_path.read_text(encoding="utf-8")) if info_path.exists() else {}
    app.state.model_version = os.getenv("MODEL_VERSION", info.get("version", "unversioned"))
    app.state.model_run_id = os.getenv("MODEL_RUN_ID") or None
    yield


app = FastAPI(title="Credit Risk Model API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, error):
    # Error inputs can contain nonfinite numbers; expose the field and message.
    return JSONResponse(
        status_code=422,
        content={
            "detail": [
                {"loc": item["loc"], "msg": item["msg"], "type": item["type"]}
                for item in error.errors()
            ]
        },
    )


@app.exception_handler(sqlite3.Error)
async def database_unavailable(_request, _error):
    return JSONResponse(
        status_code=503,
        content={"detail": "The database is unavailable. Check its path and permissions, then retry."},
    )


def get_json(filename: str):
    path = ARTIFACT_DIR / filename
    if not path.exists():
        raise HTTPException(
            status_code=503, detail=f"{filename} not exported"
        )
    return json.loads(path.read_text(encoding="utf-8"))


class BatchRequest(BaseModel):
    applicants: list[Applicant] = Field(min_length=1, max_length=100)


def classify(records: list[Applicant], threshold: float, request_kind: str):
    if app.state.model is None:
        raise HTTPException(status_code=503, detail="Trained model not found. Train and export the model before predicting.")
    frame = pd.DataFrame([r.model_dump() for r in records])
    features = engineer_features(frame)
    scores = app.state.model.predict_proba(features)[:, 1]
    predictions = [
        Prediction(
            default_probability=float(p),
            predicted_default=bool(p >= threshold),
            threshold=threshold,
            model_version=app.state.model_version,
            model_run_id=app.state.model_run_id,
        )
        for p in scores
    ]
    try:
        saved = save_predictions(
            app.state.database_path,
            [record.model_dump() for record in records],
            [prediction.model_dump() for prediction in predictions],
            request_kind,
        )
    except sqlite3.Error as error:
        raise HTTPException(
            status_code=503,
            detail="The prediction could not be saved. Check the database and retry.",
        ) from error
    return [
        prediction.model_copy(
            update={
                "prediction_id": row["id"],
                "request_id": row["request_id"],
                "created_at": row["created_at"],
            }
        )
        for prediction, row in zip(predictions, saved, strict=True)
    ]


@app.get("/health")
def health():
    return {
        "status": "ok" if app.state.model is not None else "model_missing",
        "model_loaded": app.state.model is not None,
    }


@app.get("/api/v1/model/info")
def model_info():
    return get_json("model_info.json")


@app.get("/api/v1/model/metrics")
def model_metrics():
    return get_json("metrics.json")


@app.get("/api/v1/data/overview")
def data_overview():
    return get_json("overview.json")


@app.get("/api/v1/data/distributions")
def data_distributions():
    return get_json("distributions.json")


@app.get("/api/v1/data/default-rates")
def default_rates():
    return get_json("default_rates.json")


@app.get("/api/v1/model/curves")
def model_curves():
    return get_json("curves.json")


@app.get("/api/v1/database/summary")
def storage_summary():
    return database_summary(app.state.database_path)


@app.get("/api/v1/dataset/imports")
def dataset_imports():
    return list_imports(app.state.database_path)


@app.get("/api/v1/dataset/rows")
def dataset_rows(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    import_id: int | None = Query(default=None, ge=1),
):
    return list_dataset_rows(app.state.database_path, limit, offset, import_id)


@app.get("/api/v1/predictions")
def prediction_history(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    return list_predictions(app.state.database_path, limit, offset)


@app.get("/api/v1/predictions/{prediction_id}")
def prediction_record(prediction_id: int):
    result = get_prediction(app.state.database_path, prediction_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Prediction not found.")
    return result


@app.post("/api/v1/predict", response_model=Prediction)
def predict(applicant: Applicant, threshold: float = 0.5):
    if not 0 <= threshold <= 1:
        raise HTTPException(422, "threshold must be between 0 and 1")
    return classify([applicant], threshold, "single")[0]


@app.post("/api/v1/predict/batch", response_model=list[Prediction])
def predict_batch(request: BatchRequest, threshold: float = 0.5):
    if not 0 <= threshold <= 1:
        raise HTTPException(422, "threshold must be between 0 and 1")
    return classify(request.applicants, threshold, "batch")
