"""JSON encoding of engine values.

JSON cannot carry everything SQL can, so the mapping is explicit and the
column's declared `type` in the response is what tells the client how to read
a value:

| Engine type                        | JSON                                    |
| ---------------------------------- | --------------------------------------- |
| `boolean`                          | `true` / `false`                        |
| `tinyint` … `bigint`               | number                                  |
| `float`, `double`                  | number, or `"NaN"` / `"Infinity"` /     |
|                                    | `"-Infinity"` -- JSON has no literal    |
|                                    | for those and `null` would lose data    |
| `decimal(p,s)`                     | string, so no precision is lost         |
| `string`                           | string                                  |
| `date`                             | `"YYYY-MM-DD"`                          |
| `timestamp`, `timestamp_ntz`       | ISO 8601 string                         |
| `binary`                           | base64 string                           |
| `array`, `map`, `struct`           | nested JSON array / object              |
| SQL `NULL`                         | `null`                                  |

Open contract question for the M2 freeze: a `bigint` outside JavaScript's safe
integer range is emitted as a JSON number and `JSON.parse` will round it. The
alternatives (always-string, or value-dependent string) both make a column's
JSON type unstable, so M1 keeps the natural encoding and records the caveat.
"""

from __future__ import annotations

import base64
import datetime as dt
import math
from decimal import Decimal
from typing import Any

_NON_FINITE = {
    "nan": "NaN",
    "inf": "Infinity",
    "-inf": "-Infinity",
}


def encode_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if math.isnan(value):
            return _NON_FINITE["nan"]
        if math.isinf(value):
            return _NON_FINITE["inf"] if value > 0 else _NON_FINITE["-inf"]
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return value.total_seconds()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return base64.b64encode(bytes(value)).decode("ascii")
    if isinstance(value, (list, tuple)):
        return [encode_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): encode_value(item) for key, item in value.items()}
    if isinstance(value, str):
        return value
    # Nothing else is expected; stringifying beats a 500 and keeps the shape.
    return str(value)


def encode_rows(rows: tuple[tuple[Any, ...], ...]) -> list[list[Any]]:
    return [[encode_value(value) for value in row] for row in rows]
