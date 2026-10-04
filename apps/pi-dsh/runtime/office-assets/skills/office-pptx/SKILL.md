---
name: office-pptx
description: Create, read, edit, and structurally check PowerPoint presentations (.pptx) with the Desktop's bundled python-pptx library.
---

# PowerPoint presentations

Call `load_workspace_dependencies` and use its Python executable and presentation libraries unless the user or workspace instructions select another environment. Keep source scripts and output files in the task workspace. The runtime and skill directories are read-only resources.

Use python-pptx to inspect slide layouts, text runs, pictures, tables and charts before editing. Preserve mixed text formatting and the supplied design. Save to a new file unless the user requests an in-place edit. Rebuilding slides may lose unsupported animations, SmartArt or extension parts.

For a new deck, set slide dimensions, text sizes and chart data explicitly. Prefer editable text, tables and charts, and use local image assets. Match the requested language and compare all requested content with the result.

```python
from pptx import Presentation
from pptx.util import Inches, Pt

presentation = Presentation()
presentation.slide_width = Inches(13.333)
presentation.slide_height = Inches(7.5)
slide = presentation.slides.add_slide(presentation.slide_layouts[6])
title = slide.shapes.add_textbox(Inches(0.6), Inches(0.4), Inches(12), Inches(0.8))
run = title.text_frame.paragraphs[0].add_run()
run.text = "Quarterly report"
run.font.size = Pt(30)
presentation.save("report.pptx")
```

Run the returned `officeChecker` with the selected Python executable:

```text
<python> <officeChecker> report.pptx --out checks.json --count 1
```

The checker reads ZIP/XML integrity, internal relationships, slide count, text and geometry. Repeat `--contains TEXT` to assert required text. Reopen the saved deck before delivery. Structural success does not establish that fonts, clipping, charts or slide appearance match PowerPoint; python-pptx does not render slides.

Use an explicitly available renderer when the requested deliverable or layout check needs images/PDF. Inspect relevant slides and avoid rendering an unchanged file repeatedly. If a required renderer is unavailable, retain the editable deck and report the inspection or export limitation. Deliver the final file through the current interface with its actual workspace path.
