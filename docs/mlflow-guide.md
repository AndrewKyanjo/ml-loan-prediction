# Learn MLflow with this loan prediction project

MLflow keeps a record of your model experiments. It lets you answer: “Which settings did I try, how well did each model perform, and where is the fitted model?” Your Python code explicitly sends that information to MLflow. Opening the dashboard or starting its server alone does not record your training. [Official MLflow Tracking guide](https://mlflow.org/docs/latest/ml/tracking/).

## The terms you will see

| Term | Example in this project |
| --- | --- |
| Experiment | `Credit Risk`, the group containing your loan model runs |
| Run | One export or one training attempt, with a unique run ID |
| Parameter | A chosen setting such as `n_estimators=300`, `min_samples_leaf=5`, or the decision threshold |
| Metric | A measured result such as holdout average precision or recall |
| Artifact | A saved file: a fitted model, evaluation JSON, or chart |
| Logged model | The fitted pipeline together with its dependencies and input/output contract |
| Signature | The columns and data types the logged model accepts, and its output format |

Experiments group runs; parameters describe the setup; metrics describe results; artifacts retain the files. Those distinctions make comparisons useful. [Tracking concepts](https://mlflow.org/docs/latest/ml/tracking/), [model signatures](https://mlflow.org/docs/latest/ml/model/signatures/).

## How information reaches the dashboard

```text
Notebook or tracking script
    -> MLflow Python client
    -> tracking server at http://127.0.0.1:5000
       -> mlflow.db: experiments, runs, parameters, metrics
       -> mlartifacts/: model files and other artifacts

Browser at http://127.0.0.1:5000 reads the same server.
```

This project already has MLflow 3.17.0 installed and a server on port 5000. Its database contains an `MLflow Demo` experiment. Keep using that server; the new tracking script uses a separate `Credit Risk` experiment. The diagram shows the standard local server configuration; artifact paths follow the server's existing configuration. [Tracking server architecture](https://mlflow.org/docs/latest/self-hosting/architecture/tracking-server/).

The application database stores the imported CSV records and individual API predictions. `mlflow.db` stores model experiment metadata. Keep those responsibilities separate: MLflow tracks how a model was built and evaluated, while application prediction history records what happened when someone used it.

## First exercise: inspect the model you already built

Run this from the project root in PowerShell while your MLflow server is running:

```powershell
.\.venv\Scripts\python.exe -m scripts.track_mlflow
```

The script prints the **run ID**, **model URI**, and a link to the run. It loads `models/credit_risk_pipeline.joblib`, reproduces evaluation on `data/processed/test_fe.parquet`, and logs the existing fitted pipeline. It does not train a replacement model.

Open [your MLflow dashboard](http://127.0.0.1:5000), then:

1. Select the **Credit Risk** experiment.
2. Open **tuned-random-forest-export**.
3. Inspect the **Parameters** section. The saved random forest uses 300 trees, a minimum leaf size of 5, and `max_features=0.8`.
4. Inspect the **Metrics** section. `test_average_precision`, `test_roc_auc`, and the precision/recall/F1 values were recomputed from the fitted model on the existing holdout set.
5. Browse the run's artifacts: `evaluation/holdout.json` contains the confusion matrix and sample count; `dashboard/` contains the frontend's JSON exports; `provenance/` contains the model notebook.
6. Open the logged model, **credit_risk_pipeline**, to inspect its example input, signature, and environment. In MLflow 3, the model may appear under the experiment's **Models** tab or the run's logged model links, separately from ordinary run artifacts.

At the time this guide was written, the exported holdout results were approximately **ROC-AUC 0.8848**, **average precision 0.8010**, **precision 0.9139**, and **recall 0.5520**, at threshold 0.5. Precision means about 91% of applicants flagged as defaulting actually defaulted in that historical test set. Recall means the model found about 55% of all defaults there. Those are historical evaluation results; they do not measure today's API traffic.

`reported_cv_average_precision=0.7947` deserves different treatment. It is copied from `artifacts/model_info.json`; the export notebook hardcodes that value as a placeholder. The saved training notebook also prints a rounded CV score of 0.7947, but the tracking script does not rerun or independently verify CV. The `cv_metric_source` tag records this distinction. Use newly measured `cv_*` metrics for future model comparisons.

To choose another server or run label:

```powershell
.\.venv\Scripts\python.exe -m scripts.track_mlflow --tracking-uri http://127.0.0.1:5000 --experiment "Credit Risk" --run-name "saved-rf-review"
```

Each execution creates a new run. Repeating the export records the same saved model again; changing its run name does not change its training settings or its quality.

## What the logging code does

The useful core of `scripts/track_mlflow.py` follows this pattern:

```python
mlflow.set_tracking_uri("http://127.0.0.1:5000")
mlflow.set_experiment("Credit Risk")

with mlflow.start_run(run_name="tuned-random-forest-export"):
    mlflow.log_params(model.named_steps["model"].get_params())
    mlflow.log_metrics(holdout_results)
    mlflow.log_dict(evaluation, "evaluation/holdout.json")
    mlflow.sklearn.log_model(
        model,
        name="credit_risk_pipeline",
        input_example=example,
        signature=signature,
        pyfunc_predict_fn="predict_proba",
        serialization_format="cloudpickle",
    )
```

This is an explanation of the logging calls, not a separate runnable training cell. The complete script constructs those variables, fingerprints the model file, records dataset references, and attaches metrics to the logged model. Dataset tracking retains a reference, schema, and summary so you can identify the input data; it does not automatically upload the whole source Parquet file. [Dataset tracking](https://mlflow.org/docs/latest/ml/dataset/).

The run context closes with a successful status when the code finishes. `log_model` packages the fitted estimator and environment; it does not train it. For MLflow 3 use `name=`, since `artifact_path=` on model logging is deprecated. [Scikit-learn logging API](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.sklearn.html).

## Second exercise: compare two actual training attempts

In `notebooks/05_model.ipynb`, after defining `make_pipeline`, `X_train`, and `y_train`, try the cell below. It trains two learning candidates using the **training split** and five-fold cross-validation. It does not overwrite the API's saved `.joblib` file or use the holdout set to choose settings.

```python
import mlflow
import mlflow.sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_validate

mlflow.set_tracking_uri("http://127.0.0.1:5000")
mlflow.set_experiment("Credit Risk")
cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

for depth in (8, 16):
    with mlflow.start_run(run_name=f"learning-rf-depth-{depth}"):
        params = {
            "n_estimators": 100,
            "max_depth": depth,
            "min_samples_leaf": 5,
            "random_state": 42,
            "n_jobs": -1,
        }
        candidate = make_pipeline(RandomForestClassifier(**params))
        scores = cross_validate(
            candidate, X_train, y_train, cv=cv, n_jobs=1,
            scoring={"ap": "average_precision", "roc_auc": "roc_auc"},
            error_score="raise",
        )
        mlflow.log_params(params)
        mlflow.log_metrics({
            "cv_average_precision": float(scores["test_ap"].mean()),
            "cv_average_precision_std": float(scores["test_ap"].std()),
            "cv_roc_auc": float(scores["test_roc_auc"].mean()),
        })
        candidate.fit(X_train, y_train)
        mlflow.sklearn.log_model(
            candidate,
            name="learning_pipeline",
            input_example=X_train.head(5),
            serialization_format="cloudpickle",
        )
```

The two candidates each run five CV fits and one final fit, so this takes longer than exporting an existing model. In the dashboard, select both **learning-rf-depth-8** and **learning-rf-depth-16** and use **Compare**. Compare `max_depth`, `cv_average_precision`, and its standard deviation. Higher average precision is better; the standard deviation describes variation between folds. Use consistent splits and scoring for a fair comparison.

Do not change a recorded parameter to pretend a finished run used different settings. Train the changed configuration and create a new run. Choose your configuration using training/CV results, then use the holdout set for the final evaluation. MLflow records the measurements your code supplies; it does not choose your evaluation design.

## Load a tracked model and make a prediction

Use the exact **Model URI** printed by the export script:

```python
import mlflow
import mlflow.pyfunc
import pandas as pd
from src.features import engineer_features
from src.preprocessing import FEATURES

mlflow.set_tracking_uri("http://127.0.0.1:5000")
tracked_model = mlflow.pyfunc.load_model("models:/REPLACE_WITH_LOGGED_MODEL_ID")

applicant = pd.DataFrame([{
    "person_age": 30,
    "person_income": 60000,
    "person_emp_length": 5,
    "loan_amnt": 10000,
    "cb_person_cred_hist_length": 8,
    "person_home_ownership": "RENT",
    "loan_intent": "EDUCATION",
    "cb_person_default_on_file": "N",
}])
features = engineer_features(applicant)[FEATURES]
numeric = features.select_dtypes(include="number").columns
features[numeric] = features[numeric].astype(float)
probabilities = tracked_model.predict(features)
print("Default probability:", float(probabilities[0, 1]))
```

Run this example from a Python session at the project root so the `src` imports resolve. The exported pipeline expects **nine engineered features**, including `loan_to_income_ratio`. Your FastAPI endpoint accepts eight raw fields and applies `engineer_features()` first. The logged model's generic `predict()` returns two probabilities because the export uses `pyfunc_predict_fn="predict_proba"`: column 0 is nondefault, and column 1 is default. The learning candidates in the previous exercise use the default generic prediction method and return class labels. [Model input contracts](https://mlflow.org/docs/latest/ml/model/signatures/), [prediction function options](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.sklearn.html).

After exporting the exact model used by the API, optionally associate prediction history with its run before starting the API:

```powershell
$env:MODEL_RUN_ID = "PASTE_THE_EXPORTED_RUN_ID"
.\.venv\Scripts\python.exe -m uvicorn api.main:app --reload
```

Use that identifier only while the API serves the matching exported model. Changing the saved model requires exporting it again and updating the identifier. The API stores the optional run ID alongside predictions; a stopped MLflow server does not prevent prediction history from being stored.

## Optional later step: a model registry

A registry gives a selected model a stable name and numbered versions. You can later assign an alias such as `champion` to the version you want to load. The tracking script leaves registration to you. If you decide to try it:

```python
from mlflow import MlflowClient

registered = mlflow.register_model(
    "models:/REPLACE_WITH_LOGGED_MODEL_ID", "CreditRisk"
)
MlflowClient().set_registered_model_alias(
    "CreditRisk", "champion", registered.version
)
selected = mlflow.pyfunc.load_model("models:/CreditRisk@champion")
```

This creates a registry version and an alias; your existing FastAPI app still loads its configured `.joblib` file. A deployment change would explicitly switch the API to load that registered model and retain the same feature engineering. [Official registry and alias workflow](https://mlflow.org/docs/latest/ml/model-registry/workflow/).

## When the server is stopped

If port 5000 already serves your dashboard, keep that existing process. When starting your local server again from the project root, the standard explicit configuration is:

```powershell
.\.venv\Scripts\python.exe -m mlflow server --backend-store-uri sqlite:///mlflow.db --artifacts-destination ./mlartifacts --host 127.0.0.1 --port 5000
```

Preserve your existing server's artifact destination if you originally configured a different one, so previously logged files remain available. In another PowerShell terminal, connect your code to the server:

```powershell
$env:MLFLOW_TRACKING_URI = "http://127.0.0.1:5000"
.\.venv\Scripts\python.exe -m scripts.track_mlflow
```

Run these commands from the same project folder each time: relative SQLite and artifact paths resolve from the server's working directory. Preserve both the metadata database and the artifact directory when backing up MLflow. [Server configuration](https://mlflow.org/docs/latest/self-hosting/architecture/tracking-server/).

If the experiment looks empty, check that the notebook and dashboard use the same tracking URI. If a notebook says `ModuleNotFoundError: mlflow`, select this project's `.venv` kernel or install the project's requirements in that kernel. If a run stays **RUNNING** after an interrupted notebook cell, inspect that session and call `mlflow.end_run(status="KILLED")` for its active unfinished run before beginning a fresh one.

Your next useful habit is to log one run for each real training experiment, compare candidates using CV, and retain the selected model plus its evaluation. Prediction history can later support monitoring, but measuring new prediction accuracy requires matching those predictions with observed repayment/default outcomes; a saved probability alone does not tell you whether the model was correct.
