"""Starter project written when a user creates a dbt 2 project."""

from __future__ import annotations

SEED = """order_id,customer,amount,status,ordered_on
1,ana,120.50,completed,2026-01-03
2,bob,35.00,completed,2026-01-04
3,ana,80.25,returned,2026-01-09
4,carla,410.00,completed,2026-02-01
5,bob,19.90,completed,2026-02-11
6,carla,75.10,pending,2026-02-12
"""


def starter_files(name: str) -> dict[str, str]:
    return {
        "dbt_project.yml": f"""name: {name}
version: "1.0.0"
config-version: 2
profile: {name}

model-paths: ["models"]
seed-paths: ["seeds"]
test-paths: ["tests"]
macro-paths: ["macros"]

models:
  {name}:
    staging:
      +materialized: view
    marts:
      +materialized: table
""",
        "seeds/raw_orders.csv": SEED,
        "models/staging/stg_orders.sql": """select
    cast(order_id as integer)   as order_id,
    customer,
    cast(amount as double)      as amount,
    status,
    cast(ordered_on as date)    as ordered_on
from {{ ref('raw_orders') }}
""",
        "models/marts/customer_orders.sql": """select
    customer,
    count(*)                                              as orders,
    sum(case when status = 'completed' then 1 else 0 end) as completed_orders,
    round(sum(amount), 2)                                 as total_amount
from {{ ref('stg_orders') }}
group by customer
""",
        "models/schema.yml": """version: 2

models:
  - name: stg_orders
    columns:
      - name: order_id
        data_tests: [unique, not_null]
  - name: customer_orders
    columns:
      - name: customer
        data_tests: [unique, not_null]
""",
        "README.md": f"# {name}\n\nA dbt 2 project that runs on DuckDB.\n",
    }
