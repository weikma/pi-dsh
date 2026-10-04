---
name: office-xlsx
description: Create, inspect, edit, and structurally check Excel workbooks (.xlsx), tables, data and formulas with the Desktop's bundled Python libraries.
---

# Excel workbooks

Call `load_workspace_dependencies` and use its Python executable with openpyxl, pandas, numpy and XlsxWriter unless the user or workspace instructions select another environment. Write scripts, intermediate files and final workbooks in the task workspace. The runtime and skill directories are read-only resources.

Use openpyxl for ordinary inspection and edits. Inspect sheet names, ranges, cell values and types, formulas, styles, merged cells, tables and charts before changing an existing workbook. Preserve unrelated content and save to a new file unless an in-place edit is requested. pandas supports data transformations; XlsxWriter supports creating workbooks but does not edit existing files.

```python
from openpyxl import Workbook, load_workbook

workbook = Workbook()
sheet = workbook.active
sheet.title = "Summary"
sheet.append(["Item", "Amount"])
sheet.append(["Services", 120])
sheet.append(["Total", "=SUM(B2:B2)"])
workbook.save("report.xlsx")
assert load_workbook("report.xlsx").active["B3"].value == "=SUM(B2:B2)"
```

openpyxl and XlsxWriter do not calculate formulas. Verify calculated results with an explicitly supported calculation engine when required; a saved formula string is not a calculated result. Keep the source file for unsupported `.xls`, `.xlsb`, encrypted or macro-enabled workflows; changing the extension is not conversion. `keep_vba=True` preserves selected macro package parts without running or editing VBA.

Run the returned `officeChecker` with the returned Python executable:

```text
<python> <officeChecker> report.xlsx --out checks.json --count 1
```

The checker reads ZIP/XML integrity, relationships, sheet names, populated-cell counts and formula counts. Repeated `--contains TEXT` checks string cells and sheet names, excluding numeric cells and calculated formula results. Reopen the file and verify relevant values, types, formulas, styles and totals against the source data.

Data and formula tasks need content and structural checks. Use an explicitly available renderer only for requested exports or visual layout checks. A file preview does not establish formula calculation or Excel's printed layout. If a required calculation or rendering operation is unavailable, preserve the usable workbook and state that limitation. Deliver the final file through the current interface with its actual workspace path.
