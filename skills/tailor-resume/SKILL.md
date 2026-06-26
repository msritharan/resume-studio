---
name: tailor-resume
description: Tailor RenderCV resume variants to job descriptions for ATS alignment. Use when the user provides a job description as pasted text, URL, PDF, DOCX, screenshot, scan, or local file and wants a resume variant created or updated, validated, and snapshotted in Resume Studio.
---

# Tailor Resume

Use this skill to tailor a Resume Studio RenderCV YAML resume to a job description.

## Workflow

1. Read the job description using the best available tool for its form.
   - For URLs, fetch the page. If the page is unavailable, auth-gated, expired, or too incomplete to trust, stop and ask for pasted text or an uploaded document.
   - For screenshots, scans, printed pages, PDFs, or DOCX files, use the available document/image/OCR tools. Do not use a generic extraction script.
   - Completion criterion: you have a JD brief with role, company if available, must-haves, nice-to-haves, responsibilities, seniority signals, domain terms, and ATS keywords.
2. Resolve the source resume.
   - Prefer an explicit resume workspace path from the user.
   - Otherwise use `RESUME_WORKSPACE` or the repo `.env`.
   - Source variants live at `variants/<slug>/resume.yaml`.
   - Completion criterion: the exact source `resume.yaml` path is known and readable.
3. Read [references/tailoring-rules.md](references/tailoring-rules.md), then build an evidence ledger before editing.
   - Map JD requirements to existing resume evidence.
   - Mark unsupported requirements as gaps.
   - Completion criterion: every major JD requirement is mapped to evidence or a gap.
4. Create or choose the edit target.
   - By default, create a new variant with `scripts/create_variant.py`.
   - Modify an existing variant only when the user explicitly asks for direct edits.
   - Completion criterion: exactly one target `variants/<slug>/resume.yaml` is selected.
5. Edit the target YAML.
   - Tune only supported content: summary, skill ordering, section ordering, highlight selection, and truthful phrasing.
   - Preserve RenderCV structure and user identity/contact facts.
   - Completion criterion: the YAML reflects the evidence ledger without unsupported claims.
6. Finalize with `scripts/finalize_variant.py`.
   - This command parses YAML, renders with RenderCV, and snapshots only after render succeeds.
   - If RenderCV is missing or fails, do not snapshot; report the blocker and render output.
   - Completion criterion: a commit hash is produced, or a clear validation/render blocker is reported.

## Commands

Create a new variant:

```bash
python skills/tailor-resume/scripts/create_variant.py \
  --workspace /path/to/resume-workspace \
  --source base \
  --target "Company Role"
```

Finalize a variant after editing:

```bash
python skills/tailor-resume/scripts/finalize_variant.py \
  --workspace /path/to/resume-workspace \
  --variant company-role \
  --message "Tailor company-role"
```

Omit `--workspace` only when `RESUME_WORKSPACE` or the repo `.env` can identify the workspace.
Set `RENDERCV_COMMAND=/path/to/rendercv` only when you need to force a specific RenderCV executable.

## Final Response

Report:

- target variant path
- snapshot commit hash, if created
- RenderCV PDF path, if rendered
- evidence ledger summary
- unsupported JD gaps
