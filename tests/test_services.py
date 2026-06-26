import os
from pathlib import Path

import pytest

from app.services import (
    GitService,
    RenderService,
    ResumeStudioError,
    StaleFileError,
    WorkspaceService,
    file_state,
)


def test_init_workspace_creates_base_and_gitignore(tmp_path):
    workspace = WorkspaceService(tmp_path)

    workspace.init_workspace()

    assert (tmp_path / "variants" / "base" / "resume.yaml").exists()
    assert (tmp_path / ".gitignore").exists()
    assert (tmp_path / ".git").exists()


def test_create_variant_copies_only_resume_yaml(tmp_path):
    workspace = WorkspaceService(tmp_path)
    workspace.init_workspace()

    slug = workspace.create_variant("OpenAI Backend", "base")

    assert slug == "openai-backend"
    assert (tmp_path / "variants" / "openai-backend" / "resume.yaml").exists()
    assert not (tmp_path / "variants" / "openai-backend" / "job.md").exists()


def test_save_writes_without_committing(tmp_path):
    workspace = WorkspaceService(tmp_path)
    git = GitService(tmp_path)
    workspace.init_workspace()
    before_history = git.history("base")
    state = file_state(tmp_path / "variants" / "base" / "resume.yaml")

    workspace.save_resume("base", "cv:\n  name: New Name\n", state.hash)

    assert workspace.read_resume("base") == "cv:\n  name: New Name\n"
    assert git.history("base") == before_history


def test_save_rejects_stale_browser_hash(tmp_path):
    workspace = WorkspaceService(tmp_path)
    workspace.init_workspace()
    resume = tmp_path / "variants" / "base" / "resume.yaml"
    old_state = file_state(resume)
    resume.write_text("cv:\n  name: External Edit\n", encoding="utf-8")

    with pytest.raises(StaleFileError):
        workspace.save_resume("base", "cv:\n  name: Browser Edit\n", old_state.hash)


def test_snapshot_commits_only_selected_variant(tmp_path):
    workspace = WorkspaceService(tmp_path)
    git = GitService(tmp_path)
    workspace.init_workspace()
    workspace.create_variant("OpenAI", "base")

    base_state = file_state(tmp_path / "variants" / "base" / "resume.yaml")
    openai_state = file_state(tmp_path / "variants" / "openai" / "resume.yaml")
    workspace.save_resume("base", "cv:\n  name: Base Change\n", base_state.hash)
    workspace.save_resume("openai", "cv:\n  name: OpenAI Change\n", openai_state.hash)

    git.snapshot("openai", "Tailor OpenAI")

    assert len(git.history("openai")) == 1
    assert git.history("base") == []


def test_history_is_filtered_to_variant_path(tmp_path):
    workspace = WorkspaceService(tmp_path)
    git = GitService(tmp_path)
    workspace.init_workspace()
    workspace.create_variant("Google", "base")

    base_state = file_state(tmp_path / "variants" / "base" / "resume.yaml")
    workspace.save_resume("base", "cv:\n  name: Base Snapshot\n", base_state.hash)
    git.snapshot("base", "Base snapshot")

    google_state = file_state(tmp_path / "variants" / "google" / "resume.yaml")
    workspace.save_resume("google", "cv:\n  name: Google Snapshot\n", google_state.hash)
    git.snapshot("google", "Google snapshot")

    assert [entry.message for entry in git.history("base")] == ["Base snapshot"]
    assert [entry.message for entry in git.history("google")] == ["Google snapshot"]


def test_restore_writes_old_content_as_draft(tmp_path):
    workspace = WorkspaceService(tmp_path)
    git = GitService(tmp_path)
    workspace.init_workspace()

    first_state = file_state(tmp_path / "variants" / "base" / "resume.yaml")
    workspace.save_resume("base", "cv:\n  name: First\n", first_state.hash)
    first_commit = git.snapshot("base", "First")

    second_state = file_state(tmp_path / "variants" / "base" / "resume.yaml")
    workspace.save_resume("base", "cv:\n  name: Second\n", second_state.hash)
    git.snapshot("base", "Second")

    git.restore_as_draft("base", first_commit)

    assert workspace.read_resume("base") == "cv:\n  name: First\n"
    assert git.history("base")[0].message == "Second"


def test_render_service_reports_missing_rendercv(tmp_path, monkeypatch):
    workspace = WorkspaceService(tmp_path)
    workspace.init_workspace()
    monkeypatch.setenv("PATH", "")

    result = RenderService(tmp_path).render("base")

    assert not result.ok
    assert "RenderCV is not installed" in result.output


def test_render_service_uses_variant_output_dir(tmp_path, monkeypatch):
    workspace = WorkspaceService(tmp_path)
    workspace.init_workspace()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    script = bin_dir / "rendercv"
    script.write_text(
        "#!/bin/sh\n"
        "mkdir -p \"$4\"\n"
        "printf '%s' '%PDF-1.4 fake' > \"$4/fake.pdf\"\n",
        encoding="utf-8",
    )
    script.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}")

    result = RenderService(tmp_path).render("base")

    assert result.ok
    assert result.pdf_path == tmp_path / "variants" / "base" / "rendercv_output" / "fake.pdf"

