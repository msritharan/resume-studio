import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CREATE_SCRIPT = ROOT / "skills" / "tailor-resume" / "scripts" / "create_variant.py"
FINALIZE_SCRIPT = ROOT / "skills" / "tailor-resume" / "scripts" / "finalize_variant.py"
SKILL = ROOT / "skills" / "tailor-resume" / "SKILL.md"
OPENAI_YAML = ROOT / "skills" / "tailor-resume" / "agents" / "openai.yaml"


def run_script(args, env=None):
    return subprocess.run(
        args,
        cwd=ROOT,
        text=True,
        capture_output=True,
        env=env,
    )


def init_workspace(path: Path) -> None:
    (path / "variants" / "base").mkdir(parents=True)
    (path / "variants" / "base" / "resume.yaml").write_text(
        "cv:\n"
        "  name: Test User\n"
        "  sections:\n"
        "    summary:\n"
        "      - Built reliable software.\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "init"], cwd=path, check=True, capture_output=True)


def python_cmd() -> str:
    return sys.executable


def test_skill_frontmatter_and_metadata_are_present():
    skill = SKILL.read_text(encoding="utf-8")
    metadata = OPENAI_YAML.read_text(encoding="utf-8")

    assert skill.startswith("---\n")
    assert "name: tailor-resume" in skill
    assert "description: Tailor RenderCV resume variants" in skill
    assert "display_name: Tailor Resume" in metadata
    assert "default_prompt:" in metadata


def test_create_variant_slugs_and_copies_only_resume_yaml(tmp_path):
    init_workspace(tmp_path)
    (tmp_path / "variants" / "base" / "job.md").write_text("ignore", encoding="utf-8")

    result = run_script(
        [
            python_cmd(),
            str(CREATE_SCRIPT),
            "--workspace",
            str(tmp_path),
            "--source",
            "base",
            "--target",
            "OpenAI Backend",
        ]
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["target"] == "openai-backend"
    assert (tmp_path / "variants" / "openai-backend" / "resume.yaml").exists()
    assert not (tmp_path / "variants" / "openai-backend" / "job.md").exists()


def test_create_variant_refuses_overwrite(tmp_path):
    init_workspace(tmp_path)
    (tmp_path / "variants" / "openai").mkdir()

    result = run_script(
        [
            python_cmd(),
            str(CREATE_SCRIPT),
            "--workspace",
            str(tmp_path),
            "--source",
            "base",
            "--target",
            "openai",
        ]
    )

    assert result.returncode == 1
    assert "already exists" in result.stderr


def test_finalize_rejects_invalid_yaml_without_snapshot(tmp_path):
    init_workspace(tmp_path)
    resume = tmp_path / "variants" / "base" / "resume.yaml"
    resume.write_text("cv:\n  name: [broken\n", encoding="utf-8")

    result = run_script(
        [
            python_cmd(),
            str(FINALIZE_SCRIPT),
            "--workspace",
            str(tmp_path),
            "--variant",
            "base",
            "--message",
            "Tailor base",
        ]
    )

    assert result.returncode == 1
    assert "error:" in result.stderr
    log = subprocess.run(
        ["git", "log", "--oneline"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=False,
    )
    assert log.stdout == ""


def test_finalize_does_not_snapshot_when_rendercv_fails(tmp_path):
    init_workspace(tmp_path)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    rendercv = bin_dir / "rendercv"
    rendercv.write_text("#!/bin/sh\nprintf '%s' 'render failed' >&2\nexit 2\n", encoding="utf-8")
    rendercv.chmod(0o755)
    env = {**os.environ, "RENDERCV_COMMAND": str(rendercv)}

    result = run_script(
        [
            python_cmd(),
            str(FINALIZE_SCRIPT),
            "--workspace",
            str(tmp_path),
            "--variant",
            "base",
            "--message",
            "Tailor base",
        ],
        env=env,
    )

    assert result.returncode == 1
    assert "render failed" in result.stderr
    log = subprocess.run(
        ["git", "log", "--oneline"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=False,
    )
    assert log.stdout == ""


def test_finalize_snapshots_only_selected_variant_after_render(tmp_path):
    init_workspace(tmp_path)
    run_script(
        [
            python_cmd(),
            str(CREATE_SCRIPT),
            "--workspace",
            str(tmp_path),
            "--source",
            "base",
            "--target",
            "OpenAI",
        ]
    )
    (tmp_path / "variants" / "base" / "resume.yaml").write_text(
        "cv:\n  name: Base Change\n", encoding="utf-8"
    )
    (tmp_path / "variants" / "openai" / "resume.yaml").write_text(
        "cv:\n  name: OpenAI Change\n", encoding="utf-8"
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    rendercv = bin_dir / "rendercv"
    rendercv.write_text(
        "#!/bin/sh\n"
        "mkdir -p \"$4\"\n"
        "printf '%s' '%PDF-1.4 fake' > \"$4/openai.pdf\"\n",
        encoding="utf-8",
    )
    rendercv.chmod(0o755)
    env = {**os.environ, "RENDERCV_COMMAND": str(rendercv)}

    result = run_script(
        [
            python_cmd(),
            str(FINALIZE_SCRIPT),
            "--workspace",
            str(tmp_path),
            "--variant",
            "openai",
            "--message",
            "Tailor OpenAI",
        ],
        env=env,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["variant"] == "openai"
    assert payload["commit"]
    openai_log = subprocess.run(
        ["git", "log", "--oneline", "--", "variants/openai/resume.yaml"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=True,
    )
    base_log = subprocess.run(
        ["git", "log", "--oneline", "--", "variants/base/resume.yaml"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=True,
    )
    assert "Tailor OpenAI" in openai_log.stdout
    assert base_log.stdout == ""
