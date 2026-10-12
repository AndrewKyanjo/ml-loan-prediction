"""Small SQLite store for source data and prediction history.

Each operation opens its own connection so API worker threads do not share one.
The application database is separate from MLflow's tracking database.
"""

import csv
import hashlib
import io
import math
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]

# Preserve the original dataset fields, including columns not used at inference.
DATASET_COLUMNS = (
    "person_age",
    "person_income",
    "person_home_ownership",
    "person_emp_length",
    "loan_intent",
    "loan_grade",
    "loan_amnt",
    "loan_int_rate",
    "loan_status",
    "loan_percent_income",
    "cb_person_default_on_file",
    "cb_person_cred_hist_length",
)
INTEGER_COLUMNS = {
    "person_age",
    "person_income",
    "loan_amnt",
    "loan_status",
    "cb_person_cred_hist_length",
}
REAL_COLUMNS = {"person_emp_length", "loan_int_rate", "loan_percent_income"}
APPLICANT_COLUMNS = (
    "person_age",
    "person_income",
    "person_home_ownership",
    "person_emp_length",
    "loan_intent",
    "loan_amnt",
    "cb_person_default_on_file",
    "cb_person_cred_hist_length",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS dataset_imports (
    id INTEGER PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dataset_rows (
    id INTEGER PRIMARY KEY,
    import_id INTEGER NOT NULL REFERENCES dataset_imports(id),
    source_row INTEGER NOT NULL,
    person_age INTEGER,
    person_income INTEGER,
    person_home_ownership TEXT,
    person_emp_length REAL,
    loan_intent TEXT,
    loan_grade TEXT,
    loan_amnt INTEGER,
    loan_int_rate REAL,
    loan_status INTEGER,
    loan_percent_income REAL,
    cb_person_default_on_file TEXT,
    cb_person_cred_hist_length INTEGER,
    UNIQUE(import_id, source_row)
);
CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY,
    request_id TEXT NOT NULL,
    request_kind TEXT NOT NULL CHECK(request_kind IN ('single', 'batch')),
    position INTEGER NOT NULL CHECK(position >= 1),
    created_at TEXT NOT NULL,
    person_age INTEGER NOT NULL,
    person_income REAL NOT NULL,
    person_home_ownership TEXT NOT NULL,
    person_emp_length REAL,
    loan_intent TEXT NOT NULL,
    loan_amnt REAL NOT NULL,
    cb_person_default_on_file TEXT NOT NULL,
    cb_person_cred_hist_length INTEGER NOT NULL,
    default_probability REAL NOT NULL CHECK(default_probability BETWEEN 0 AND 1),
    predicted_default INTEGER NOT NULL CHECK(predicted_default IN (0, 1)),
    threshold REAL NOT NULL CHECK(threshold BETWEEN 0 AND 1),
    model_version TEXT NOT NULL,
    model_run_id TEXT,
    UNIQUE(request_id, position)
);
"""


def default_database_path() -> Path:
    """Read DATABASE_PATH when called, so scripts and the API share a default."""
    return Path(os.getenv("DATABASE_PATH", str(ROOT / "data" / "app.db"))).expanduser()


@contextmanager
def _connection(path):
    connection = sqlite3.connect(str(Path(path).expanduser()), timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 30000")
    try:
        yield connection
    finally:
        connection.close()


def initialize_database(path):
    """Create the database and tables without importing or modifying data."""
    path = Path(path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _connection(path) as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(SCHEMA)
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(predictions)")
            }
            if "model_run_id" not in columns:
                connection.execute(
                    "ALTER TABLE predictions ADD COLUMN model_run_id TEXT"
                )


def _utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_csv_value(column, value, source_row):
    if value is None:
        raise ValueError(f"CSV row {source_row}: missing column {column!r}")
    if not value.strip():
        return None
    try:
        if column in INTEGER_COLUMNS:
            result = int(value)
            if not -(2**63) <= result < 2**63:
                raise ValueError("integer is outside SQLite's supported range")
            return result
        if column in REAL_COLUMNS:
            result = float(value)
            if not math.isfinite(result):
                raise ValueError("number must be finite")
            return result
        return value
    except ValueError as error:
        raise ValueError(
            f"CSV row {source_row}: invalid {column!r} value {value!r} ({error})"
        ) from error


def import_csv(path, csv_path):
    """Atomically import an unchanged CSV once; retain each changed version.

    The hash and parsed values come from the same byte snapshot. Blank fields
    become SQL NULL, and historical outliers are kept without Applicant checks.
    """
    csv_path = Path(csv_path).expanduser()
    raw = csv_path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    with _connection(path) as connection, connection:
        # Serialize imports, including the duplicate check, across processes.
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            "SELECT * FROM dataset_imports WHERE sha256 = ?", (digest,)
        ).fetchone()
        if existing is not None:
            return {**dict(existing), "reused": True, "inserted_rows": 0}

        try:
            reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), strict=True)
            fields = reader.fieldnames or []
        except csv.Error as error:
            raise ValueError(f"Invalid CSV header: {error}") from error
        if len(fields) != len(DATASET_COLUMNS) or set(fields) != set(DATASET_COLUMNS):
            missing = sorted(set(DATASET_COLUMNS) - set(fields))
            extra = sorted(set(fields) - set(DATASET_COLUMNS))
            raise ValueError(
                "CSV header must contain each expected column exactly once; "
                f"missing={missing}, extra={extra}"
            )

        rows = []
        try:
            for source_row, row in enumerate(reader, start=1):
                if None in row:
                    raise ValueError(f"CSV row {source_row}: too many fields")
                rows.append(
                    (source_row,)
                    + tuple(
                        _parse_csv_value(column, row[column], source_row)
                        for column in DATASET_COLUMNS
                    )
                )
        except csv.Error as error:
            raise ValueError(
                f"Invalid CSV near line {reader.line_num}: {error}"
            ) from error

        imported_at = _utc_now()
        cursor = connection.execute(
            "INSERT INTO dataset_imports (sha256, source, row_count, imported_at) "
            "VALUES (?, ?, ?, ?)",
            (digest, csv_path.name, len(rows), imported_at),
        )
        import_id = cursor.lastrowid
        column_names = ", ".join(DATASET_COLUMNS)
        placeholders = ", ".join("?" for _ in range(len(DATASET_COLUMNS) + 2))
        connection.executemany(
            f"INSERT INTO dataset_rows (import_id, source_row, {column_names}) "
            f"VALUES ({placeholders})",
            ((import_id,) + row for row in rows),
        )
        return {
            "id": import_id,
            "sha256": digest,
            "source": csv_path.name,
            "row_count": len(rows),
            "imported_at": imported_at,
            "reused": False,
            "inserted_rows": len(rows),
        }


def _prediction_item(row):
    record = dict(row)
    record["applicant"] = {column: record.pop(column) for column in APPLICANT_COLUMNS}
    record["predicted_default"] = bool(record["predicted_default"])
    return record


def _finite_probability(value, field):
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a finite number between 0 and 1")
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field} must be a finite number between 0 and 1") from error
    if not math.isfinite(result) or not 0 <= result <= 1:
        raise ValueError(f"{field} must be a finite number between 0 and 1")
    return result


def save_predictions(path, applicants, predictions, request_kind):
    """Store one complete request transaction and return rows in input order."""
    if not applicants or len(applicants) != len(predictions):
        raise ValueError("Applicants and predictions must have the same nonzero length")
    if request_kind not in {"single", "batch"}:
        raise ValueError("request_kind must be 'single' or 'batch'")
    if request_kind == "single" and len(applicants) != 1:
        raise ValueError("A single request must contain exactly one applicant")
    request_id = str(uuid4())
    created_at = _utc_now()
    column_names = ", ".join(APPLICANT_COLUMNS)
    placeholders = ", ".join("?" for _ in range(len(APPLICANT_COLUMNS) + 9))
    stored = []
    with _connection(path) as connection, connection:
        for position, (applicant, prediction) in enumerate(
            zip(applicants, predictions), start=1
        ):
            predicted_default = prediction["predicted_default"]
            if not isinstance(predicted_default, bool):
                raise ValueError("predicted_default must be a boolean")
            values = (
                request_id,
                request_kind,
                position,
                created_at,
                *(applicant.get(column) for column in APPLICANT_COLUMNS),
                _finite_probability(
                    prediction["default_probability"], "default_probability"
                ),
                int(predicted_default),
                _finite_probability(prediction["threshold"], "threshold"),
                prediction["model_version"],
                prediction.get("model_run_id"),
            )
            cursor = connection.execute(
                "INSERT INTO predictions "
                f"(request_id, request_kind, position, created_at, {column_names}, "
                "default_probability, predicted_default, threshold, model_version, model_run_id) "
                f"VALUES ({placeholders})",
                values,
            )
            row = connection.execute(
                "SELECT * FROM predictions WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
            stored.append(_prediction_item(row))
    return stored


def _validate_paging(limit, offset):
    if type(limit) is not int or not 1 <= limit <= 1000:
        raise ValueError("limit must be an integer between 1 and 1000")
    if type(offset) is not int or offset < 0:
        raise ValueError("offset must be a nonnegative integer")


def list_predictions(path, limit=20, offset=0):
    """List newest prediction IDs first; position records order within a batch."""
    _validate_paging(limit, offset)
    with _connection(path) as connection:
        total = connection.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
        rows = connection.execute(
            "SELECT * FROM predictions ORDER BY id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return {
        "items": [_prediction_item(row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def get_prediction(path, prediction_id):
    with _connection(path) as connection:
        row = connection.execute(
            "SELECT * FROM predictions WHERE id = ?", (prediction_id,)
        ).fetchone()
    return _prediction_item(row) if row is not None else None


def list_dataset_rows(path, limit=20, offset=0, import_id=None):
    _validate_paging(limit, offset)
    where = " WHERE import_id = ?" if import_id is not None else ""
    parameters = (import_id,) if import_id is not None else ()
    with _connection(path) as connection:
        total = connection.execute(
            "SELECT COUNT(*) FROM dataset_rows" + where, parameters
        ).fetchone()[0]
        rows = connection.execute(
            "SELECT * FROM dataset_rows" + where + " ORDER BY id LIMIT ? OFFSET ?",
            parameters + (limit, offset),
        ).fetchall()
    return {
        "items": [dict(row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def list_imports(path):
    with _connection(path) as connection:
        rows = connection.execute(
            "SELECT * FROM dataset_imports ORDER BY id DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def database_summary(path):
    with _connection(path) as connection:
        return {
            "dataset_rows": connection.execute(
                "SELECT COUNT(*) FROM dataset_rows"
            ).fetchone()[0],
            "predictions": connection.execute(
                "SELECT COUNT(*) FROM predictions"
            ).fetchone()[0],
            "imports": connection.execute(
                "SELECT COUNT(*) FROM dataset_imports"
            ).fetchone()[0],
        }
