"""Import the original loan CSV into the application SQLite database."""

import argparse
import json
import sqlite3
from pathlib import Path

from api.database import default_database_path, import_csv, initialize_database

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv", type=Path, default=ROOT / "data" / "raw" / "data.csv"
    )
    parser.add_argument("--database", type=Path, default=default_database_path())
    args = parser.parse_args()
    args.database = args.database.expanduser()
    args.csv = args.csv.expanduser()
    try:
        initialize_database(args.database)
        report = import_csv(args.database, args.csv)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f"Import failed: {error}\n")
    print(json.dumps({"database": str(args.database.resolve()), **report}, indent=2))


if __name__ == "__main__":
    main()
