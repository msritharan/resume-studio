import os

from fastapi.testclient import TestClient

from app.config import clear_workspace_override
from app.main import app
from app.services import WorkspaceService, file_state


def client_for(tmp_path, monkeypatch):
    clear_workspace_override()
    monkeypatch.setenv("RESUME_WORKSPACE", str(tmp_path))
    return TestClient(app)


def test_workspace_payload_before_init(tmp_path, monkeypatch):
    client = client_for(tmp_path, monkeypatch)

    response = client.get("/api/workspace")

    assert response.status_code == 200
    assert response.json()["initialized"] is False
    assert response.json()["selected"] == "base"


def test_init_returns_base_workspace(tmp_path, monkeypatch):
    client = client_for(tmp_path, monkeypatch)

    response = client.post("/api/init")

    assert response.status_code == 200
    payload = response.json()
    assert payload["initialized"] is True
    assert payload["selected"] == "base"
    assert payload["variants"][0]["name"] == "base"


def test_init_can_choose_workspace_directory(tmp_path, monkeypatch):
    client = client_for(tmp_path, monkeypatch)
    chosen = tmp_path / "chosen-workspace"

    response = client.post("/api/init", json={"workspace_path": str(chosen)})

    assert response.status_code == 200
    payload = response.json()
    assert payload["workspace_path"] == str(chosen)
    assert payload["initialized"] is True
    assert (chosen / "variants" / "base" / "resume.yaml").exists()

    workspace_response = client.get("/api/workspace")

    assert workspace_response.json()["workspace_path"] == str(chosen)


def test_create_variant_returns_new_selection(tmp_path, monkeypatch):
    WorkspaceService(tmp_path).init_workspace()
    client = client_for(tmp_path, monkeypatch)

    response = client.post(
        "/api/variants",
        json={"name": "OpenAI Backend", "source": "base"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["selected"] == "openai-backend"
    assert [variant["name"] for variant in payload["variants"]] == [
        "base",
        "openai-backend",
    ]


def test_create_variant_reuses_existing_empty_directory(tmp_path, monkeypatch):
    workspace = WorkspaceService(tmp_path)
    workspace.init_workspace()
    target = tmp_path / "variants" / "google"
    target.mkdir(parents=True)
    (target / ".DS_Store").write_text("", encoding="utf-8")
    client = client_for(tmp_path, monkeypatch)

    response = client.post(
        "/api/variants",
        json={"name": "Google", "source": "base"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["selected"] == "google"
    assert (target / "resume.yaml").exists()


def test_delete_variant_removes_directory_and_returns_next_selection(tmp_path, monkeypatch):
    workspace = WorkspaceService(tmp_path)
    workspace.init_workspace()
    workspace.create_variant("OpenAI", "base")
    workspace.create_variant("Google", "base")
    client = client_for(tmp_path, monkeypatch)

    response = client.delete("/api/variants/openai?next=google")

    assert response.status_code == 200
    payload = response.json()
    assert payload["selected"] == "google"
    assert [variant["name"] for variant in payload["variants"]] == ["base", "google"]
    assert not (tmp_path / "variants" / "openai").exists()


def test_delete_variant_rejects_base(tmp_path, monkeypatch):
    WorkspaceService(tmp_path).init_workspace()
    client = client_for(tmp_path, monkeypatch)

    response = client.delete("/api/variants/base")

    assert response.status_code == 400
    assert response.json()["detail"] == "At least one variant must remain."


def test_delete_base_variant_when_other_variant_exists(tmp_path, monkeypatch):
    workspace = WorkspaceService(tmp_path)
    workspace.init_workspace()
    workspace.create_variant("OpenAI", "base")
    client = client_for(tmp_path, monkeypatch)

    response = client.delete("/api/variants/base?next=openai")

    assert response.status_code == 200
    payload = response.json()
    assert payload["selected"] == "openai"
    assert [variant["name"] for variant in payload["variants"]] == ["openai"]


def test_delete_variant_rejects_missing_variant(tmp_path, monkeypatch):
    WorkspaceService(tmp_path).init_workspace()
    client = client_for(tmp_path, monkeypatch)

    response = client.delete("/api/variants/missing")

    assert response.status_code == 400
    assert response.json()["detail"] == "Variant 'missing' does not exist."


def test_save_resume_updates_content_and_hash(tmp_path, monkeypatch):
    workspace = WorkspaceService(tmp_path)
    workspace.init_workspace()
    state = file_state(tmp_path / "variants" / "base" / "resume.yaml")
    client = client_for(tmp_path, monkeypatch)

    response = client.put(
        "/api/variants/base/resume",
        json={
            "content": "cv:\n  name: New Name\n",
            "expected_hash": state.hash,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["content"] == "cv:\n  name: New Name\n"
    assert payload["state"]["hash"] != state.hash


def test_save_resume_reports_stale_hash(tmp_path, monkeypatch):
    workspace = WorkspaceService(tmp_path)
    workspace.init_workspace()
    resume = tmp_path / "variants" / "base" / "resume.yaml"
    state = file_state(resume)
    resume.write_text("cv:\n  name: External Edit\n", encoding="utf-8")
    client = client_for(tmp_path, monkeypatch)

    response = client.put(
        "/api/variants/base/resume",
        json={
            "content": "cv:\n  name: Browser Edit\n",
            "expected_hash": state.hash,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "This file changed on disk. Reload or overwrite."


def test_render_success_returns_output_and_artifact_urls(tmp_path, monkeypatch):
    WorkspaceService(tmp_path).init_workspace()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    script = bin_dir / "rendercv"
    script.write_text(
        "#!/bin/sh\n"
        "/bin/mkdir -p \"$4\"\n"
        "/usr/bin/printf '%s' '%PDF-1.4 fake' > \"$4/fake.pdf\"\n"
        "/usr/bin/printf '%s' 'fake png' > \"$4/fake.png\"\n"
        "/usr/bin/printf '%s' 'rendered ok'\n",
        encoding="utf-8",
    )
    script.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}")
    monkeypatch.setattr("app.services.sys.executable", str(tmp_path / "python"))
    client = client_for(tmp_path, monkeypatch)

    response = client.post("/api/variants/base/render")

    assert response.status_code == 200
    payload = response.json()
    assert payload["output"] == "rendered ok"
    assert payload["workspace"]["pdf_url"] == "/variants/base/pdf"
    assert len(payload["workspace"]["preview_urls"]) == 1
    assert payload["workspace"]["preview_urls"][0].startswith("/variants/base/preview/1.png?v=")


def test_render_failure_returns_render_output(tmp_path, monkeypatch):
    WorkspaceService(tmp_path).init_workspace()
    monkeypatch.setenv("PATH", "")
    monkeypatch.setattr("app.services.sys.executable", str(tmp_path / "python"))
    client = client_for(tmp_path, monkeypatch)

    response = client.post("/api/variants/base/render")

    assert response.status_code == 400
    assert response.json()["detail"] == "RenderCV could not render this variant."
    assert "RenderCV is not installed" in response.json()["render_output"]


def test_snapshot_and_restore_routes(tmp_path, monkeypatch):
    workspace = WorkspaceService(tmp_path)
    workspace.init_workspace()
    client = client_for(tmp_path, monkeypatch)
    initial = file_state(tmp_path / "variants" / "base" / "resume.yaml")

    client.put(
        "/api/variants/base/resume",
        json={"content": "cv:\n  name: First\n", "expected_hash": initial.hash},
    )
    first = client.post("/api/variants/base/snapshot", json={"message": "First"})
    first_commit = first.json()["history"][0]["commit"]
    second_state = first.json()["state"]["hash"]
    client.put(
        "/api/variants/base/resume",
        json={"content": "cv:\n  name: Second\n", "expected_hash": second_state},
    )
    client.post("/api/variants/base/snapshot", json={"message": "Second"})

    response = client.post(f"/api/variants/base/restore/{first_commit}")

    assert response.status_code == 200
    assert response.json()["content"] == "cv:\n  name: First\n"
    assert response.json()["history"][0]["message"] == "Second"


def test_pdf_route_reports_missing_and_found(tmp_path, monkeypatch):
    workspace = WorkspaceService(tmp_path)
    workspace.init_workspace()
    client = client_for(tmp_path, monkeypatch)

    missing = client.get("/variants/base/pdf")

    assert missing.status_code == 404
    output = tmp_path / "variants" / "base" / "rendercv_output"
    output.mkdir()
    (output / "fake.pdf").write_bytes(b"%PDF-1.4 fake")

    found = client.get("/variants/base/pdf")

    assert found.status_code == 200
    assert found.headers["content-type"] == "application/pdf"
    assert found.headers["cache-control"] == "no-store, max-age=0"
    assert found.headers["content-disposition"] == 'inline; filename="fake.pdf"'


def test_preview_route_reports_missing_and_found(tmp_path, monkeypatch):
    workspace = WorkspaceService(tmp_path)
    workspace.init_workspace()
    client = client_for(tmp_path, monkeypatch)

    missing = client.get("/variants/base/preview/1.png")

    assert missing.status_code == 404
    output = tmp_path / "variants" / "base" / "rendercv_output"
    output.mkdir()
    (output / "fake.png").write_bytes(b"fake png")

    found = client.get("/variants/base/preview/1.png")

    assert found.status_code == 200
    assert found.headers["content-type"] == "image/png"
    assert found.headers["cache-control"] == "no-store, max-age=0"
    assert found.content == b"fake png"
