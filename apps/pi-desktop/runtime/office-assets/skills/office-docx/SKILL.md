---
name: office-docx
description: Create, read, edit, and structurally check Word documents (.docx) using the Desktop's bundled python-docx library.
---

# Word documents

Call `load_workspace_dependencies` and use the returned `python` executable and bundled libraries unless the user or workspace instructions select another environment. Keep scripts, intermediate files and final documents in the task workspace. Runtime files and this skill directory are read-only resources.

Use python-docx to inspect paragraphs, runs, tables, sections, headers and footers before editing. Preserve the existing design and mixed formatting. Replacing a paragraph's `.text` discards run formatting; change individual runs when formatting matters. Save to a new file unless the user requests an in-place edit. Unsupported OOXML features may be lost when rebuilding a document.

For creation, use heading styles, explicit table widths and section sizes. CJK text may need an explicit `w:eastAsia` font assignment; font names do not establish glyph availability.

```python
from docx import Document

document = Document()
document.add_heading("Project report", level=0)
document.add_paragraph("Summary", style="Heading 1")
document.add_paragraph("The requested findings go here.")
document.save("report.docx")
```

Run the returned `officeChecker` with the returned Python executable:

```text
<python> <officeChecker> report.docx --out checks.json
```

The checker reads ZIP/XML integrity, internal relationships, paragraphs, logical table dimensions and sections. Repeat `--contains TEXT` to assert required text. Reopen the file and compare it with the requested content, including unchanged content important to an edit. This structural check does not inspect pagination, clipping, fonts or visual layout; python-docx does not render documents or implement tracked revisions.

When visual inspection or export is required, use an explicitly available rendering tool and its documented operation. Do not assume the Desktop file preview performs conversion or validates Microsoft Word layout. If the required renderer is unavailable, preserve the usable document and state the inspection or export limitation. Deliver the final file through the current interface with its actual workspace path.
