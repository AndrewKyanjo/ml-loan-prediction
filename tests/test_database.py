"""Persistence tests use temporary databases, never the developer's data."""

import csv
import sqlite3
import tempfile
import unittest
from pathlib import Path
from uuid import UUID

from api.database import (
    DATASET_COLUMNS,
    database_summary,
    get_prediction,
    import_csv,
    initialize_database,
    list_dataset_rows,
    list_imports,
    list_predictions,
    save_predictions,
)


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="loan-database-tests-")
        self.addCleanup(self.directory.cleanup)
        self.database = Path(self.directory.name) / "nested" / "app.db"
        self.csv_path = Path(self.directory.name) / "loans.csv"
        initialize_database(self.database)
        self.row = {
            "person_age": 144,
            "person_income": 42000,
            "person_home_ownership": "RENT",
            "person_emp_length": 123,
            "loan_intent": "PERSONAL",
            "loan_grade": "B",
            "loan_amnt": 5000,
            "loan_int_rate": "",
            "loan_status": 0,
            "loan_percent_income": 0.12,
            "cb_person_default_on_file": "N",
            "cb_person_cred_hist_length": 8,
        }
        self.applicant = {
            key: self.row[key]
            for key in (
                "person_age",
                "person_income",
                "person_home_ownership",
                "person_emp_length",
                "loan_intent",
                "loan_amnt",
                "cb_person_default_on_file",
                "cb_person_cred_hist_length",
            )
        }
        self.applicant.update(person_age=30, person_emp_length=None)
        self.prediction = {
            "default_probability": 0.2,
            "predicted_default": False,
            "threshold": 0.5,
            "model_version": "test-model-v1",
            "model_run_id": "test-mlflow-run",
        }

    def write_csv(self, rows, fields=DATASET_COLUMNS):
        with self.csv_path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)

    def test_import_preserves_typed_original_columns_nulls_and_outliers(self):
        self.write_csv([self.row, {**self.row, "person_emp_length": ""}])
        report = import_csv(self.database, self.csv_path)
        self.assertEqual(report["inserted_rows"], 2)
        records = list_dataset_rows(self.database)["items"]
        self.assertEqual(records[0]["person_age"], 144)
        self.assertEqual(records[0]["person_emp_length"], 123.0)
        self.assertIsNone(records[0]["loan_int_rate"])
        self.assertIsNone(records[1]["person_emp_length"])
        self.assertEqual(records[0]["source_row"], 1)
        self.assertEqual(records[1]["source_row"], 2)
        self.assertEqual(records[0]["loan_grade"], "B")
        self.assertEqual(list_imports(self.database)[0]["row_count"], 2)

    def test_repeat_import_same_bytes_under_another_filename_is_reused(self):
        self.write_csv([self.row])
        first = import_csv(self.database, self.csv_path)
        renamed = self.csv_path.with_name("renamed.csv")
        renamed.write_bytes(self.csv_path.read_bytes())
        second = import_csv(self.database, renamed)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["imported_at"], second["imported_at"])
        self.assertTrue(second["reused"])
        self.assertEqual(second["inserted_rows"], 0)
        self.assertEqual(database_summary(self.database)["dataset_rows"], 1)

    def test_changed_csv_retains_each_import_and_can_filter_by_import(self):
        self.write_csv([self.row])
        first = import_csv(self.database, self.csv_path)
        self.write_csv([{**self.row, "person_age": 25}])
        second = import_csv(self.database, self.csv_path)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(database_summary(self.database)["imports"], 2)
        self.assertEqual(database_summary(self.database)["dataset_rows"], 2)
        filtered = list_dataset_rows(self.database, import_id=second["id"])
        self.assertEqual(filtered["total"], 1)
        self.assertEqual(filtered["items"][0]["person_age"], 25)

    def test_malformed_numeric_row_does_not_partially_import(self):
        self.write_csv([self.row])
        import_csv(self.database, self.csv_path)
        for column, value in (
            ("loan_int_rate", "NaN"),
            ("person_emp_length", "Infinity"),
            ("person_age", "age"),
            ("person_income", str(2**63)),
        ):
            with self.subTest(column=column, value=value):
                self.write_csv([self.row, {**self.row, column: value}])
                with self.assertRaisesRegex(ValueError, "CSV row 2"):
                    import_csv(self.database, self.csv_path)
                self.assertEqual(
                    database_summary(self.database),
                    {"dataset_rows": 1, "predictions": 0, "imports": 1},
                )

    def test_malformed_headers_and_ragged_rows_are_rejected(self):
        for text in (
            '"unterminated header\n',
            "person_age\n30\n",
            ",".join(DATASET_COLUMNS) + ",extra\n",
            ",".join(DATASET_COLUMNS) + "\n30,50000\n",
            ",".join(DATASET_COLUMNS) + "\n" + ",".join(["1"] * 13) + "\n",
        ):
            with self.subTest(text=text):
                self.csv_path.write_text(text, encoding="utf-8")
                with self.assertRaises(ValueError):
                    import_csv(self.database, self.csv_path)
                self.assertEqual(database_summary(self.database)["imports"], 0)

    def test_prediction_survives_reinitializing_connections_and_null_input(self):
        stored = save_predictions(
            self.database, [self.applicant], [self.prediction], "single"
        )[0]
        initialize_database(self.database)
        self.assertEqual(get_prediction(self.database, stored["id"]), stored)
        self.assertIsNone(stored["applicant"]["person_emp_length"])
        self.assertIs(stored["predicted_default"], False)
        self.assertEqual(stored["model_run_id"], "test-mlflow-run")
        self.assertIsNone(get_prediction(self.database, stored["id"] + 1))
        self.assertTrue(stored["created_at"].endswith("Z"))

    def test_batch_has_one_request_id_timestamp_and_input_order(self):
        applicants = [self.applicant, {**self.applicant, "person_age": 35}]
        predictions = [
            self.prediction,
            {**self.prediction, "default_probability": 0.8, "predicted_default": True},
        ]
        stored = save_predictions(self.database, applicants, predictions, "batch")
        self.assertEqual([item["position"] for item in stored], [1, 2])
        self.assertEqual([item["applicant"]["person_age"] for item in stored], [30, 35])
        self.assertEqual(stored[0]["request_id"], stored[1]["request_id"])
        UUID(stored[0]["request_id"])
        self.assertEqual(stored[0]["created_at"], stored[1]["created_at"])
        self.assertEqual([item["request_kind"] for item in stored], ["batch", "batch"])
        self.assertEqual(database_summary(self.database)["predictions"], 2)

    def test_failed_later_batch_insert_rolls_back_entire_request(self):
        invalid_applicant = {**self.applicant, "loan_intent": None}
        with self.assertRaises(sqlite3.IntegrityError):
            save_predictions(
                self.database,
                [self.applicant, invalid_applicant],
                [self.prediction, self.prediction],
                "batch",
            )
        self.assertEqual(database_summary(self.database)["predictions"], 0)
        self.assertEqual(list_predictions(self.database)["items"], [])

    def test_failed_later_batch_probability_rolls_back_entire_request(self):
        with self.assertRaises(ValueError):
            save_predictions(
                self.database,
                [self.applicant, self.applicant],
                [self.prediction, {**self.prediction, "default_probability": float("nan")}],
                "batch",
            )
        self.assertEqual(database_summary(self.database)["predictions"], 0)

    def test_prediction_paging_uses_latest_first_and_preserves_total(self):
        stored = save_predictions(
            self.database,
            [self.applicant] * 3,
            [self.prediction] * 3,
            "batch",
        )
        page = list_predictions(self.database, limit=1, offset=1)
        self.assertEqual(page["items"][0]["id"], stored[1]["id"])
        self.assertEqual((page["total"], page["limit"], page["offset"]), (3, 1, 1))
        self.assertEqual(list_predictions(self.database, offset=100)["items"], [])
        for arguments in ({"limit": 0}, {"offset": -1}, {"limit": True}):
            with self.assertRaises(ValueError):
                list_predictions(self.database, **arguments)

    def test_prediction_lists_must_match_and_request_kind_must_be_valid(self):
        for applicants, predictions, kind in (
            ([], [], "batch"),
            ([self.applicant], [], "batch"),
            ([self.applicant], [self.prediction], "unknown"),
            ([self.applicant] * 2, [self.prediction] * 2, "single"),
        ):
            with self.subTest(kind=kind, count=len(applicants)):
                with self.assertRaises(ValueError):
                    save_predictions(self.database, applicants, predictions, kind)
        self.assertEqual(database_summary(self.database)["predictions"], 0)


if __name__ == "__main__":
    unittest.main()
