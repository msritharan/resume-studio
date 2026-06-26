# Resume Studio

Resume Studio is a small local web app for managing RenderCV resume variants.
It is intentionally file-first:

- RenderCV YAML files are the source of truth.
- Git stores intentional snapshots.
- RenderCV creates PDF previews.
- Codex can edit the same `resume.yaml` files directly.

## Directory Model

Use two separate directories:

```text
~/projects/resume-studio/       # this app
~/projects/resume-workspace/    # your resume variants and Git history
```

The app expects a workspace like:

```text
resume-workspace/
  .git/
  .gitignore
  variants/
    base/
      resume.yaml
    openai-backend/
      resume.yaml
      rendercv_output/
```

`rendercv_output/` is ignored by Git.

## Run Locally

The backend can run on Python 3.9+, and the frontend uses Vite, React,
TypeScript, Tailwind, shadcn/ui, and CodeMirror. PDF rendering needs the
`rendercv` command on `PATH`. Current RenderCV releases require Python 3.12+, so
use a Python 3.12+ environment if you want `Render preview` to produce PDFs.

If `python3.12` is not installed yet, you can still run the app backend with
plain `python3`, but PDF preview will stay unavailable until RenderCV is
installed in a Python 3.12+ environment.

```bash
cd ~/projects/resume-studio
python3.12 -m venv .venv  # or: python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e ".[dev]"
pip install "rendercv[full]"  # requires Python 3.12+
corepack enable pnpm         # or: npm install -g pnpm
pnpm --dir frontend install
cp .env.example .env
export RESUME_WORKSPACE=~/projects/resume-workspace
pnpm dev
```

Open the Vite app during development:

```text
http://127.0.0.1:5173
```

Vite proxies `/api` and `/variants` requests to FastAPI on port `8765`.

To serve the built React app directly from FastAPI:

```bash
pnpm build
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
```

Then open:

```text
http://127.0.0.1:8765
```

## Workflow

1. Initialize the workspace from the UI.
2. Edit `variants/base/resume.yaml`.
3. Create variants by copying from the selected variant.
4. Click `Save changes` to write the YAML file.
5. Click `Render preview` to generate a PDF.
6. Click `Snapshot version` to commit only that variant's `resume.yaml`.

If Codex edits a file externally, the UI detects that the file changed on disk and
asks you to reload or keep your browser edits.

## Tests

```bash
pnpm test
```

The backend tests use temporary Git workspaces and do not touch your real resume
workspace. Frontend tests run with Vitest and mock the CodeMirror/resizable
browser surfaces where jsdom is not the right tool.
