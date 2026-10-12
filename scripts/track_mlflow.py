"""Log the saved credit-risk model and its evaluation; no fitting or tuning."""

import argparse
import hashlib
import json
import os
import sys
from importlib.metadata import version
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "models" / "credit_risk_pipeline.joblib"
TRAIN_PATH = ROOT / "data" / "processed" / "train_fe.parquet"
TEST_PATH = ROOT / "data" / "processed" / "test_fe.parquet"
NOTEBOOK_PATH = ROOT / "notebooks" / "05_model.ipynb"
ARTIFACT_DIR = ROOT / "artifacts"


def holdout_metrics(model, test, features, threshold):
    """Reproduce the finalized evaluation on the existing holdout split."""
    from sklearn.metrics import (
        average_precision_score,
        confusion_matrix,
        f1_score,
        precision_score,
        recall_score,
        roc_auc_score,
    )

    probabilities = model.predict_proba(test[features])[:, 1]
    labels = (probabilities >= threshold).astype(int)
    target = test["loan_status"]
    metrics = {
        "test_roc_auc": float(roc_auc_score(target, probabilities)),
        "test_average_precision": float(average_precision_score(target, probabilities)),
        "test_precision_default": float(precision_score(target, labels, zero_division=0)),
        "test_recall_default": float(recall_score(target, labels, zero_division=0)),
        "test_f1_default": float(f1_score(target, labels, zero_division=0)),
    }
    evaluation = {
        "split": "holdout_test",
        "threshold": threshold,
        "support": len(test),
        "metrics": metrics,
        "confusion_matrix": confusion_matrix(target, labels, labels=[0, 1]).tolist(),
        "source": str(TEST_PATH.relative_to(ROOT)),
        "evaluation_only_no_training_or_tuning": True,
    }
    return metrics, evaluation


def check_tracking_server(tracking_uri):
    if not tracking_uri.startswith(("http://", "https://")):
        return
    try:
        with urlopen(tracking_uri.rstrip("/") + "/health", timeout=5) as response:
            if response.status != 200:
                raise RuntimeError("MLflow health check did not return HTTP 200.")
    except (URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(
            f"Cannot reach MLflow at {tracking_uri}. Keep your MLflow server running "
            "and confirm its port, or use --tracking-uri to select it. "
            "See docs/mlflow-guide.md for the server command."
        ) from exc


def export_run(tracking_uri, experiment="Credit Risk", run_name="tuned-random-forest-export"):
    """Create one MLflow run and return its identifiers for inspection."""
    import joblib
    import mlflow
    import mlflow.sklearn
    import pandas as pd
    from mlflow.models import infer_signature

    for path in (MODEL_PATH, TRAIN_PATH, TEST_PATH, ARTIFACT_DIR / "model_info.json"):
        if not path.exists():
            raise FileNotFoundError(
                f"Missing {path.relative_to(ROOT)}. Run notebooks/05_model.ipynb "
                "and the export notebook before tracking the saved model."
            )
    check_tracking_server(tracking_uri)
    model = joblib.load(MODEL_PATH)
    info = json.loads((ARTIFACT_DIR / "model_info.json").read_text(encoding="utf-8"))
    features = list(model.feature_names_in_)
    train = pd.read_parquet(TRAIN_PATH)
    test = pd.read_parquet(TEST_PATH)
    threshold = float(info.get("default_threshold", 0.5))
    metrics, evaluation = holdout_metrics(model, test, features, threshold)
    cv_score = info.get("cv_average_precision")
    if cv_score is not None:
        metrics["reported_cv_average_precision"] = float(cv_score)

    # Use floating numeric inputs so the signature also accepts missing numeric values.
    example = train[features].head(5).copy()
    numeric = example.select_dtypes(include="number").columns
    example[numeric] = example[numeric].astype(float)
    signature = infer_signature(example, model.predict_proba(example))
    model_hash = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
    model_params = model.named_steps["model"].get_params(deep=False)

    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment(experiment)
    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tags(
            {
                "project": "ml-loan-prediction",
                "run_kind": "saved_model_export",
                "model_version": info.get("version", "unknown"),
                "model_sha256": model_hash,
                "input_contract": "engineered_features_including_loan_to_income_ratio",
                "cv_metric_source": (
                    "exported_metadata_not_recomputed"
                    if cv_score is not None
                    else "unavailable"
                ),
                "mlflow.note.content": (
                    "Exports the existing fitted pipeline; no training or tuning occurs. "
                    "test_* metrics are recomputed on the existing holdout split. "
                    "reported_cv_average_precision is copied from exported model_info.json; "
                    "that export includes a hardcoded CV placeholder and is not recomputed "
                    "or independently verified by this script."
                ),
            }
        )
        mlflow.log_params(
            {
                **model_params,
                "model_class": type(model.named_steps["model"]).__name__,
                "threshold": threshold,
                "feature_count": len(features),
                "train_rows": len(train),
                "test_rows": len(test),
            }
        )
        for frame, path, name, context in (
            (train, TRAIN_PATH, "credit_risk_train", "training"),
            (test, TEST_PATH, "credit_risk_holdout", "testing"),
        ):
            dataset = mlflow.data.from_pandas(
                frame[features + ["loan_status"]],
                source=str(path),
                targets="loan_status",
                name=name,
            )
            mlflow.log_input(dataset, context=context)
        mlflow.log_dict(evaluation, "evaluation/holdout.json")
        mlflow.log_dict(
            {"features": features, "numeric_inputs": list(numeric), "output_classes": [0, 1]},
            "evaluation/input_contract.json",
        )
        for path in sorted(ARTIFACT_DIR.glob("*.json")):
            mlflow.log_artifact(str(path), artifact_path="dashboard")
        if NOTEBOOK_PATH.exists():
            mlflow.log_artifact(str(NOTEBOOK_PATH), artifact_path="provenance")

        logged_model = mlflow.sklearn.log_model(
            sk_model=model,
            name="credit_risk_pipeline",
            signature=signature,
            input_example=example,
            pyfunc_predict_fn="predict_proba",
            serialization_format="cloudpickle",
            pip_requirements=[
                f"{package}=={version(package)}"
                for package in ("scikit-learn", "numpy", "pandas", "scipy", "cloudpickle")
            ],
        )
        mlflow.log_metrics(metrics, model_id=logged_model.model_id)
        identifiers = {
            "run_id": run.info.run_id,
            "experiment_id": run.info.experiment_id,
            "model_uri": logged_model.model_uri,
            "model_sha256": model_hash,
        }

    print(f"Run ID: {identifiers['run_id']}")
    print(f"Model URI: {identifiers['model_uri']}")
    if tracking_uri.startswith(("http://", "https://")):
        print(
            f"Open: {tracking_uri.rstrip('/')}/#/experiments/"
            f"{identifiers['experiment_id']}/runs/{identifiers['run_id']}"
        )
    print("Holdout metrics reproduced; existing model was not retrained.")
    return identifiers


def main():
    # MLflow prints Unicode links/icons when closing a run. Windows shells may
    # otherwise use cp1252, which cannot encode those characters.
    if os.name == "nt":
        for stream in (sys.stdout, sys.stderr):
            if hasattr(stream, "reconfigure"):
                stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tracking-uri",
        default=os.getenv("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000"),
        help="Tracking server URI (default: MLFLOW_TRACKING_URI or http://127.0.0.1:5000)",
    )
    parser.add_argument("--experiment", default="Credit Risk")
    parser.add_argument("--run-name", default="tuned-random-forest-export")
    args = parser.parse_args()
    try:
        export_run(args.tracking_uri, args.experiment, args.run_name)
    except (FileNotFoundError, RuntimeError, ImportError) as exc:
        parser.exit(1, f"Tracking failed: {exc}\n")


if __name__ == "__main__":
    main()
