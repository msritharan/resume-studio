from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import get_settings, set_workspace_override
from .services import (
    FileState,
    GitService,
    HistoryEntry,
    RenderService,
    ResumeStudioError,
    StaleFileError,
    Variant,
    WorkspaceService,
    file_state,
    format_timestamp,
)


BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
FRONTEND_ASSETS = FRONTEND_DIST / "assets"

app = FastAPI(title="Resume Studio")

if FRONTEND_ASSETS.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS), name="assets")


class FileStateResponse(BaseModel):
    hash: str
    mtime_ns: int


class VariantResponse(BaseModel):
    name: str
    has_pdf: bool
    state: Optional[FileStateResponse]


class HistoryEntryResponse(BaseModel):
    commit: str
    short_commit: str
    date: str
    message: str


class WorkspaceResponse(BaseModel):
    workspace_path: str
    initialized: bool
    variants: list[VariantResponse]
    selected: str
    content: str
    state: Optional[FileStateResponse]
    updated_at: str
    history: list[HistoryEntryResponse]
    pdf_url: Optional[str]
    preview_urls: list[str]


class CreateVariantRequest(BaseModel):
    name: str
    source: str = "base"


class SaveResumeRequest(BaseModel):
    content: str
    expected_hash: Optional[str] = None
    force: bool = False


class SnapshotRequest(BaseModel):
    message: str = ""


class InitWorkspaceRequest(BaseModel):
    workspace_path: Optional[str] = None


class RenderResponse(BaseModel):
    workspace: WorkspaceResponse
    output: str


def services() -> tuple[WorkspaceService, GitService, RenderService]:
    settings = get_settings()
    return (
        WorkspaceService(settings.workspace),
        GitService(settings.workspace),
        RenderService(settings.workspace),
    )


def selected_or_default(workspace: WorkspaceService, selected: Optional[str]) -> str:
    variants = workspace.list_variants()
    if selected and any(v.name == selected for v in variants):
        return selected
    if any(v.name == "base" for v in variants):
        return "base"
    return variants[0].name if variants else "base"


def file_state_response(state: Optional[FileState]) -> Optional[FileStateResponse]:
    if state is None:
        return None
    return FileStateResponse(hash=state.hash, mtime_ns=state.mtime_ns)


def variant_response(variant: Variant) -> VariantResponse:
    return VariantResponse(
        name=variant.name,
        has_pdf=variant.has_pdf,
        state=file_state_response(variant.state),
    )


def history_entry_response(entry: HistoryEntry) -> HistoryEntryResponse:
    return HistoryEntryResponse(
        commit=entry.commit,
        short_commit=entry.short_commit,
        date=entry.date,
        message=entry.message,
    )


def workspace_response(selected: Optional[str] = None) -> WorkspaceResponse:
    workspace, git, _ = services()
    initialized = workspace.is_initialized()
    variants = workspace.list_variants() if initialized else []
    selected_name = selected_or_default(workspace, selected) if variants else "base"
    content = ""
    state = None
    history: list[HistoryEntry] = []
    pdf_url = None
    preview_urls: list[str] = []
    updated_at = "missing"

    if initialized and variants:
        variant = workspace.get_variant(selected_name)
        content = workspace.read_resume(selected_name)
        state = variant.state
        updated_at = format_timestamp(state)
        history = git.history(selected_name)
        if workspace.latest_pdf(selected_name):
            pdf_url = f"/variants/{selected_name}/pdf"
        for index, preview_state in enumerate(workspace.preview_image_states(selected_name), start=1):
            preview_urls.append(
                f"/variants/{selected_name}/preview/{index}.png?v={preview_state.mtime_ns}"
            )

    return WorkspaceResponse(
        workspace_path=str(workspace.workspace),
        initialized=initialized,
        variants=[variant_response(variant) for variant in variants],
        selected=selected_name,
        content=content,
        state=file_state_response(state),
        updated_at=updated_at,
        history=[history_entry_response(entry) for entry in history],
        pdf_url=pdf_url,
        preview_urls=preview_urls,
    )


def user_error(status_code: int, detail: str, **extra: object) -> JSONResponse:
    return JSONResponse({"detail": detail, **extra}, status_code=status_code)


@app.get("/api/workspace", response_model=WorkspaceResponse)
async def api_workspace(variant: Optional[str] = Query(default=None)):
    return workspace_response(variant)


@app.post("/api/init", response_model=WorkspaceResponse)
async def api_init_workspace(payload: InitWorkspaceRequest = InitWorkspaceRequest()):
    if payload.workspace_path is not None:
        workspace_path = payload.workspace_path.strip()
        if not workspace_path:
            raise HTTPException(status_code=400, detail="Enter a workspace directory.")
        set_workspace_override(Path(workspace_path))
    workspace, _, _ = services()
    workspace.init_workspace()
    return workspace_response("base")


@app.post("/api/variants", response_model=WorkspaceResponse)
async def api_create_variant(payload: CreateVariantRequest):
    workspace, _, _ = services()
    try:
        slug = workspace.create_variant(payload.name, payload.source)
        return workspace_response(slug)
    except ResumeStudioError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.put("/api/variants/{variant}/resume", response_model=WorkspaceResponse)
async def api_save_resume(variant: str, payload: SaveResumeRequest):
    workspace, _, _ = services()
    try:
        workspace.save_resume(
            variant,
            payload.content,
            payload.expected_hash,
            force=payload.force,
        )
        return workspace_response(variant)
    except StaleFileError as e:
        return user_error(409, str(e))
    except ResumeStudioError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/variants/{variant}/render", response_model=RenderResponse)
async def api_render_variant(variant: str):
    _, _, renderer = services()
    try:
        result = renderer.render(variant)
    except ResumeStudioError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if not result.ok:
        return user_error(
            400,
            "RenderCV could not render this variant.",
            render_output=result.output,
        )
    return RenderResponse(workspace=workspace_response(variant), output=result.output)


@app.post("/api/variants/{variant}/snapshot", response_model=WorkspaceResponse)
async def api_snapshot_variant(variant: str, payload: SnapshotRequest):
    _, git, _ = services()
    try:
        git.snapshot(variant, payload.message)
        return workspace_response(variant)
    except ResumeStudioError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.delete("/api/variants/{variant}", response_model=WorkspaceResponse)
async def api_delete_variant(
    variant: str, next_variant: Optional[str] = Query(default=None, alias="next")
):
    workspace, _, _ = services()
    try:
        workspace.delete_variant(variant)
        return workspace_response(next_variant)
    except ResumeStudioError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/variants/{variant}/restore/{commit}", response_model=WorkspaceResponse)
async def api_restore_variant(variant: str, commit: str):
    _, git, _ = services()
    try:
        git.restore_as_draft(variant, commit)
        return workspace_response(variant)
    except ResumeStudioError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/variants/{variant}/state")
async def api_variant_state(variant: str):
    workspace, _, _ = services()
    try:
        variant_obj = workspace.get_variant(variant)
    except ResumeStudioError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    state = file_state(variant_obj.resume_path)
    return {
        "hash": state.hash if state else None,
        "mtime_ns": state.mtime_ns if state else None,
    }


@app.get("/variants/{variant}/pdf")
async def variant_pdf(variant: str):
    workspace, _, _ = services()
    try:
        pdf = workspace.latest_pdf(variant)
    except ResumeStudioError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not pdf:
        raise HTTPException(status_code=404, detail="No rendered PDF exists.")
    return FileResponse(
        pdf,
        media_type="application/pdf",
        headers={
            "Cache-Control": "no-store, max-age=0",
            "Content-Disposition": f'inline; filename="{pdf.name}"',
        },
    )


@app.get("/variants/{variant}/preview/{page}.png")
async def variant_preview(variant: str, page: int):
    workspace, _, _ = services()
    try:
        previews = workspace.preview_images(variant)
    except ResumeStudioError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if page < 1 or page > len(previews):
        raise HTTPException(status_code=404, detail="Preview page does not exist.")
    preview = previews[page - 1]
    if not preview:
        raise HTTPException(status_code=404, detail="No rendered preview image exists.")
    return FileResponse(
        preview,
        media_type="image/png",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@app.get("/{path:path}", response_class=HTMLResponse)
async def spa(path: str):
    if path:
        candidate = (FRONTEND_DIST / path).resolve()
        if FRONTEND_DIST.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)

    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    return HTMLResponse(
        "<!doctype html><title>Resume Studio</title>"
        "<main style='font-family: system-ui; padding: 2rem'>"
        "<h1>Resume Studio frontend is not built yet.</h1>"
        "<p>Run <code>pnpm dev</code> while developing, or "
        "<code>pnpm build</code> before serving through FastAPI.</p>"
        "</main>",
        status_code=200,
    )
