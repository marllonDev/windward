import type { NotebookCell } from "./api";

const cell = (type: NotebookCell["type"], source: string): NotebookCell => ({ id: crypto.randomUUID(), type, source });

/** Cells a new notebook starts with. */
export const starterCells = (): NotebookCell[] => [
  cell("markdown", "# Welcome to Windward notebooks\nCells run on the **Sail** engine. Use SQL cells for queries and Python cells for PySpark. Press **Shift + Enter** to run a cell and move on."),
  cell("sql", "select * from demo.route_summary order by total_fare desc"),
  cell("python", "df = spark.sql(\"select route, total_fare from demo.route_summary\")\ndf"),
  cell("python", "df.toPandas().describe()"),
];
