import csv
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from api import main
from api.database import DATASET_COLUMNS, import_csv, initialize_database


APPLICANT = {
    "person_age": 30,
    "person_income": 60000,
    "person_home_ownership": "RENT",
    "person_emp_length": None,
    "loan_intent": "PERSONAL",
    "loan_amnt": 10000,
    "cb_person_default_on_file": "N",
    "cb_person_cred_hist_length": 8,
}


class FixedModel:
    def predict_proba(self, features):
        return np.tile([0.35, 0.65], (len(features), 1))


class PersistenceApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.database = Path(self.temporary.name) / "app.db"
        self.path_patch = patch.object(main, "DATABASE_PATH", self.database)
        self.model_patch = patch.object(main, "MODEL_PATH", Path(self.temporary.name) / "absent.joblib")
        self.env_patch = patch.dict("os.environ", {"MODEL_VERSION": "test-model", "MODEL_RUN_ID": "test-run"})
        for patcher in (self.path_patch, self.model_patch, self.env_patch):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = TestClient(main.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        main.app.state.model = FixedModel()

    def summary(self):
        response = self.client.get("/api/v1/database/summary")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_single_prediction_metadata_history_and_restart(self):
        response = self.client.post("/api/v1/predict?threshold=0.6", json=APPLICANT)
        self.assertEqual(response.status_code, 200)
        prediction = response.json()
        self.assertEqual(prediction["default_probability"], 0.65)
        self.assertTrue(prediction["predicted_default"])
        self.assertEqual(prediction["model_version"], "test-model")
        self.assertEqual(prediction["model_run_id"], "test-run")
        self.assertIsInstance(prediction["prediction_id"], int)
        self.assertTrue(prediction["created_at"].endswith("Z"))
        saved = self.client.get(f"/api/v1/predictions/{prediction['prediction_id']}").json()
        self.assertEqual(saved["applicant"], APPLICANT)
        self.assertEqual(saved["request_id"], prediction["request_id"])
        self.assertEqual(saved["threshold"], 0.6)
        self.assertEqual(saved["request_kind"], "single")
        with TestClient(main.app) as restarted:
            page = restarted.get("/api/v1/predictions").json()
            self.assertEqual(page["total"], 1)
            self.assertEqual(page["items"][0]["id"], prediction["prediction_id"])

    def test_batch_is_one_request_with_ordered_saved_results(self):
        applicants = [APPLICANT, {**APPLICANT, "loan_amnt": 20000}, {**APPLICANT, "person_emp_length": 2}]
        response = self.client.post("/api/v1/predict/batch?threshold=0.8", json={"applicants": applicants})
        self.assertEqual(response.status_code, 200)
        results = response.json()
        self.assertEqual(len({item["request_id"] for item in results}), 1)
        self.assertEqual(len({item["created_at"] for item in results}), 1)
        self.assertEqual(len({item["prediction_id"] for item in results}), 3)
        self.assertTrue(all(not item["predicted_default"] for item in results))
        history = self.client.get("/api/v1/predictions?limit=2").json()
        self.assertEqual(history["total"], 3)
        self.assertEqual(len(history["items"]), 2)
        ordered = sorted(self.client.get("/api/v1/predictions").json()["items"], key=lambda item: item["position"])
        self.assertEqual([item["applicant"] for item in ordered], applicants)
        self.assertTrue(all(item["request_kind"] == "batch" for item in ordered))

    def test_failed_requests_create_no_prediction_history(self):
        invalid = self.client.post("/api/v1/predict", json={**APPLICANT, "person_income": 0})
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(self.client.post("/api/v1/predict?threshold=1.1", json=APPLICANT).status_code, 422)
        self.assertEqual(self.client.post("/api/v1/predict/batch", json={"applicants": []}).status_code, 422)
        nonfinite = self.client.post("/api/v1/predict", content='{"person_income": 1e309}', headers={"Content-Type": "application/json"})
        self.assertEqual(nonfinite.status_code, 422)
        main.app.state.model = None
        self.assertEqual(self.client.post("/api/v1/predict", json=APPLICANT).status_code, 503)
        self.assertEqual(self.summary()["predictions"], 0)

    def test_database_failure_does_not_report_a_successful_prediction(self):
        with patch.object(main, "save_predictions", side_effect=sqlite3.OperationalError("locked")):
            response = self.client.post("/api/v1/predict", json=APPLICANT)
        self.assertEqual(response.status_code, 503)
        self.assertIn("could not be saved", response.json()["detail"])
        self.assertEqual(self.summary()["predictions"], 0)

    def test_existing_database_gains_optional_run_id_without_losing_history(self):
        main.app.state.model_run_id = None
        first = self.client.post("/api/v1/predict", json=APPLICANT).json()
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute("ALTER TABLE predictions DROP COLUMN model_run_id")
        initialize_database(self.database)
        saved = self.client.get(f"/api/v1/predictions/{first['prediction_id']}").json()
        self.assertEqual(saved["applicant"], APPLICANT)
        self.assertIsNone(saved["model_run_id"])
        main.app.state.model_run_id = "test-run"
        response = self.client.post("/api/v1/predict", json=APPLICANT)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model_run_id"], "test-run")
        self.assertEqual(self.summary()["predictions"], 2)

    def test_dataset_import_browse_and_paging_validation(self):
        source = Path(self.temporary.name) / "dataset.csv"
        row = {**APPLICANT, "person_emp_length": 123, "loan_grade": "D", "loan_int_rate": None, "loan_status": 1, "loan_percent_income": 0.16}
        with source.open("w", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=DATASET_COLUMNS)
            writer.writeheader()
            writer.writerow(row)
        imported = import_csv(self.database, source)
        self.assertEqual(self.client.get("/api/v1/dataset/imports").json()[0]["id"], imported["id"])
        page = self.client.get(f"/api/v1/dataset/rows?import_id={imported['id']}&limit=1").json()
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["items"][0]["person_emp_length"], 123)
        self.assertIsNone(page["items"][0]["loan_int_rate"])
        self.assertEqual(self.summary(), {"dataset_rows": 1, "predictions": 0, "imports": 1})
        for url in ("/api/v1/predictions?limit=0", "/api/v1/predictions?offset=-1", "/api/v1/dataset/rows?limit=101", "/api/v1/dataset/rows?import_id=0"):
            self.assertEqual(self.client.get(url).status_code, 422)
        self.assertEqual(self.client.get("/api/v1/predictions/999").status_code, 404)


if __name__ == "__main__":
    unittest.main()
