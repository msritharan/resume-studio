# Tailoring Rules

## Truth

- Do not invent employers, roles, dates, credentials, education, awards, metrics, tools, domains, or responsibilities.
- Do not upgrade vague familiarity into professional experience.
- Do not add a JD keyword unless the source resume contains evidence for it or the user has supplied that fact.
- When a JD requirement is unsupported, list it as a gap instead of adding it to the resume.

## Evidence Ledger

Before editing, make a ledger with one row per major JD requirement:

- `requirement`: the JD phrase or capability
- `evidence`: the resume section, role, project, or highlight supporting it
- `edit`: the planned resume change
- `status`: `supported`, `adjacent`, or `gap`

Only `supported` and clearly truthful `adjacent` items may drive resume edits.

## ATS Alignment

- Prefer exact JD nouns where truthful, especially skill names, platforms, domains, and responsibility verbs.
- Reorder existing skills and highlights so the strongest JD matches appear earlier.
- Tune summary wording toward the target role, but keep it grounded in existing experience.
- Keep bullets specific, impact-oriented, and consistent with the source resume's facts.

## RenderCV Safety

- Preserve the YAML structure and indentation style.
- Preserve identity and contact fields unless the user explicitly asks to change them.
- Keep dates and section schemas valid for RenderCV.
- Do not edit generated `rendercv_output/` files.

## Final Report

End with:

- target variant path
- commit hash, if finalized
- RenderCV output/PDF path
- concise evidence ledger
- gaps that were not added
