"""Parquet fixtures the integration suite queries through the live engine."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

#: One row per tuple, matching TRIPS_SCHEMA below.
TRIPS_ROWS = [
    (1, "Harbour run", Decimal("128.40"), 12.5, True, dt.date(2026, 1, 3)),
    (2, "Leeward loop", Decimal("9.05"), 3.25, False, dt.date(2026, 1, 4)),
    (3, None, Decimal("0.00"), 0.0, True, dt.date(2026, 1, 5)),
    (4, "Windward beat", Decimal("4211.99"), 88.125, None, dt.date(2026, 2, 1)),
]

TRIPS_SCHEMA = pa.schema(
    [
        pa.field("trip_id", pa.int64(), nullable=False),
        pa.field("route", pa.string()),
        pa.field("fare", pa.decimal128(10, 2)),
        pa.field("distance_nm", pa.float64()),
        pa.field("completed", pa.bool_()),
        pa.field("sailed_on", pa.date32()),
    ]
)


def write_seed(data_dir: Path) -> dict[str, Path]:
    """Write the demo Parquet files and return the paths the tests use."""
    data_dir.mkdir(parents=True, exist_ok=True)

    columns = list(zip(*TRIPS_ROWS, strict=True))
    trips = pa.Table.from_arrays(
        [
            pa.array(values, type=field.type)
            for values, field in zip(columns, TRIPS_SCHEMA, strict=True)
        ],
        schema=TRIPS_SCHEMA,
    )
    trips_path = data_dir / "trips.parquet"
    pq.write_table(trips, trips_path)

    # A directory of several files, which is how a real table on local storage
    # looks and a different code path in the engine than a single file.
    parts_dir = data_dir / "trip_parts"
    parts_dir.mkdir(exist_ok=True)
    pq.write_table(trips.slice(0, 2), parts_dir / "part-0.parquet")
    pq.write_table(trips.slice(2), parts_dir / "part-1.parquet")

    # A wider file, for the row cap and truncation behaviour.
    many = pa.table({"n": pa.array(range(500), pa.int64())})
    many_path = data_dir / "numbers.parquet"
    pq.write_table(many, many_path)

    return {"trips": trips_path, "trip_parts": parts_dir, "numbers": many_path}
