from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional


SAMPLE_RESUME = """cv:
  name: Your Name
  location: Your City
  email: you@example.com
  sections:
    summary:
      - Replace this starter resume with your real RenderCV YAML.
    experience:
      - company: Example Company
        position: Software Engineer
        location: Remote
        start_date: 2024-01
        end_date: present
        highlights:
          - Built useful systems with clear ownership and measurable impact.
design:
  theme: classic
"""


class ResumeStudioError(Exception):
    """Base error for expected user-facing failures."""


class StaleFileError(ResumeStudioError):
    """Raised when browser state is older than the file on disk."""


@dataclass(frozen=True)
class FileState:
    hash: str
    mtime_ns: int


@dataclass(frozen=True)
class Variant:
    name: str
    path: Path
    resume_path: Path
    state: Optional[FileState]
    has_pdf: bool


@dataclass(frozen=True)
class RenderResult:
    ok: bool
    output: str
    pdf_path: Optional[Path]


@dataclass(frozen=True)
class HistoryEntry:
    commit: str
    short_commit: str
    message: str
    date: str


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    if not slug:
        raise ResumeStudioError("Enter a variant name.")
    return slug


def file_state(path: Path) -> Optional[FileState]:
    if not path.exists():
        return None
    data = path.read_bytes()
    stat = path.stat()
    return FileState(hash=hashlib.sha256(data).hexdigest(), mtime_ns=stat.st_mtime_ns)


def assert_safe_variant_name(name: str) -> str:
    slug = slugify(name)
    if slug in {".", ".."} or "/" in slug:
        raise ResumeStudioError("Variant name is not safe.")
    return slug


class WorkspaceService:
    def __init__(self, workspace: Path):
        self.workspace = workspace.expanduser()
        self.variants_dir = self.workspace / "variants"

    def init_workspace(self) -> None:
        base_dir = self.variants_dir / "base"
        base_dir.mkdir(parents=True, exist_ok=True)
        resume = base_dir / "resume.yaml"
        if not resume.exists():
            resume.write_text(SAMPLE_RESUME, encoding="utf-8")

        gitignore = self.workspace / ".gitignore"
        if not gitignore.exists():
            gitignore.write_text(
                "rendercv_output/\n"
                "**/rendercv_output/\n"
                ".DS_Store\n"
                "__pycache__/\n"
                ".resume-studio-state/\n",
                encoding="utf-8",
            )

        if not (self.workspace / ".git").exists():
            self._run(["git", "init"])

    def is_initialized(self) -> bool:
        return any(self.variants_dir.glob("*/resume.yaml"))

    def list_variants(self) -> List[Variant]:
        if not self.variants_dir.exists():
            return []
        variants: List[Variant] = []
        for resume_path in sorted(self.variants_dir.glob("*/resume.yaml")):
            variant_dir = resume_path.parent
            variants.append(
                Variant(
                    name=variant_dir.name,
                    path=variant_dir,
                    resume_path=resume_path,
                    state=file_state(resume_path),
                    has_pdf=self.latest_pdf(variant_dir.name) is not None,
                )
            )
        return variants

    def get_variant(self, name: str) -> Variant:
        slug = assert_safe_variant_name(name)
        resume_path = self.variants_dir / slug / "resume.yaml"
        if not resume_path.exists():
            raise ResumeStudioError(f"Variant '{slug}' does not exist.")
        return Variant(
            name=slug,
            path=resume_path.parent,
            resume_path=resume_path,
            state=file_state(resume_path),
            has_pdf=self.latest_pdf(slug) is not None,
        )

    def create_variant(self, name: str, source: str = "base") -> str:
        slug = assert_safe_variant_name(name)
        source_slug = assert_safe_variant_name(source)
        target = self.variants_dir / slug
        source_resume = self.variants_dir / source_slug / "resume.yaml"
        if not source_resume.exists():
            raise ResumeStudioError(f"Source variant '{source_slug}' does not exist.")
        if target.exists():
            if not target.is_dir():
                raise ResumeStudioError(f"Variant '{slug}' already exists.")
            if (target / "resume.yaml").exists():
                raise ResumeStudioError(f"Variant '{slug}' already exists.")
            non_ignorable_entries = [
                entry.name for entry in target.iterdir() if entry.name != ".DS_Store"
            ]
            if non_ignorable_entries:
                raise ResumeStudioError(
                    f"Variant directory '{slug}' already exists and is not empty."
                )
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_resume, target / "resume.yaml")
        return slug

    def rename_variant(self, old_name: str, new_name: str) -> str:
        old_slug = assert_safe_variant_name(old_name)
        new_slug = assert_safe_variant_name(new_name)
        if old_slug == "base":
            raise ResumeStudioError("The base variant cannot be renamed.")
        old_path = self.variants_dir / old_slug
        new_path = self.variants_dir / new_slug
        if not old_path.exists():
            raise ResumeStudioError(f"Variant '{old_slug}' does not exist.")
        if new_path.exists():
            raise ResumeStudioError(f"Variant '{new_slug}' already exists.")
        old_path.rename(new_path)
        return new_slug

    def delete_variant(self, name: str) -> None:
        slug = assert_safe_variant_name(name)
        path = self.variants_dir / slug
        if not path.exists():
            raise ResumeStudioError(f"Variant '{slug}' does not exist.")
        if len(self.list_variants()) <= 1:
            raise ResumeStudioError("At least one variant must remain.")
        shutil.rmtree(path)

    def read_resume(self, name: str) -> str:
        return self.get_variant(name).resume_path.read_text(encoding="utf-8")

    def save_resume(
        self,
        name: str,
        content: str,
        expected_hash: Optional[str],
        force: bool = False,
    ) -> FileState:
        variant = self.get_variant(name)
        current = file_state(variant.resume_path)
        if (
            not force
            and expected_hash
            and current is not None
            and current.hash != expected_hash
        ):
            raise StaleFileError("This file changed on disk. Reload or overwrite.")
        variant.resume_path.write_text(content, encoding="utf-8")
        state = file_state(variant.resume_path)
        if state is None:
            raise ResumeStudioError("Could not save resume.")
        return state

    def latest_pdf(self, name: str) -> Optional[Path]:
        slug = assert_safe_variant_name(name)
        output_dir = self.variants_dir / slug / "rendercv_output"
        pdfs = sorted(output_dir.glob("*.pdf"), key=lambda p: p.stat().st_mtime_ns)
        return pdfs[-1] if pdfs else None

    def preview_images(self, name: str) -> List[Path]:
        slug = assert_safe_variant_name(name)
        output_dir = self.variants_dir / slug / "rendercv_output"
        images = sorted(output_dir.glob("*.png"), key=lambda p: p.stat().st_mtime_ns)
        return images

    def preview_image_states(self, name: str) -> List[FileState]:
        return [
            state for preview in self.preview_images(name) if (state := file_state(preview)) is not None
        ]

    def relative_variant_path(self, name: str) -> str:
        slug = assert_safe_variant_name(name)
        return f"variants/{slug}/resume.yaml"

    def _run(self, args: List[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            args,
            cwd=self.workspace,
            text=True,
            capture_output=True,
            check=True,
        )


class GitService:
    def __init__(self, workspace: Path):
        self.workspace = workspace.expanduser()

    def snapshot(self, variant_name: str, message: str) -> str:
        path = f"variants/{assert_safe_variant_name(variant_name)}/resume.yaml"
        commit_message = message.strip() or f"Snapshot {variant_name}"
        self._run(["git", "add", "--", path], check=True)
        diff = self._run(["git", "diff", "--cached", "--quiet", "--", path], check=False)
        if diff.returncode == 0:
            raise ResumeStudioError("No saved changes to snapshot.")
        self._run(
            [
                "git",
                "-c",
                "user.name=Resume Studio",
                "-c",
                "user.email=resume-studio@example.local",
                "commit",
                "-m",
                commit_message,
                "--",
                path,
            ],
            check=True,
        )
        return self._run(["git", "rev-parse", "HEAD"], check=True).stdout.strip()

    def history(self, variant_name: str, limit: int = 30) -> List[HistoryEntry]:
        path = f"variants/{assert_safe_variant_name(variant_name)}/resume.yaml"
        result = self._run(
            [
                "git",
                "log",
                f"-n{limit}",
                "--date=short",
                "--pretty=format:%H%x1f%h%x1f%ad%x1f%s",
                "--",
                path,
            ],
            check=False,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return []
        entries: List[HistoryEntry] = []
        for line in result.stdout.splitlines():
            commit, short, date, message = line.split("\x1f", 3)
            entries.append(
                HistoryEntry(
                    commit=commit,
                    short_commit=short,
                    date=date,
                    message=message,
                )
            )
        return entries

    def restore_as_draft(self, variant_name: str, commit: str) -> FileState:
        slug = assert_safe_variant_name(variant_name)
        path = f"variants/{slug}/resume.yaml"
        result = self._run(["git", "show", f"{commit}:{path}"], check=True)
        target = self.workspace / path
        target.write_text(result.stdout, encoding="utf-8")
        state = file_state(target)
        if state is None:
            raise ResumeStudioError("Could not restore resume.")
        return state

    def _run(
        self,
        args: List[str],
        check: bool,
    ) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                args,
                cwd=self.workspace,
                text=True,
                capture_output=True,
                check=check,
            )
        except subprocess.CalledProcessError as e:
            detail = (e.stderr or e.stdout or str(e)).strip()
            raise ResumeStudioError(detail) from e


class RenderService:
    def __init__(self, workspace: Path):
        self.workspace = workspace.expanduser()

    def _rendercv_command(self) -> Optional[str]:
        for script_name in ("rendercv", "rendercv.exe"):
            local_script = Path(sys.executable).with_name(script_name)
            if local_script.is_file() and os.access(local_script, os.X_OK):
                return str(local_script)
        return shutil.which("rendercv")

    def render(self, variant_name: str) -> RenderResult:
        slug = assert_safe_variant_name(variant_name)
        variant_dir = self.workspace / "variants" / slug
        resume_path = variant_dir / "resume.yaml"
        output_dir = variant_dir / "rendercv_output"
        output_dir.mkdir(exist_ok=True)
        for artifact in output_dir.iterdir():
            if artifact.is_file():
                artifact.unlink()

        rendercv_command = self._rendercv_command()
        if rendercv_command is None:
            return RenderResult(
                ok=False,
                output=(
                    "RenderCV is not installed in the app virtualenv or on PATH. "
                    'Run ./scripts/setup.sh, or install it with pip install "rendercv[full]".'
                ),
                pdf_path=None,
            )

        try:
            result = subprocess.run(
                [
                    rendercv_command,
                    "render",
                    str(resume_path),
                    "--output-folder",
                    str(output_dir),
                ],
                cwd=variant_dir,
                text=True,
                capture_output=True,
            )
        except FileNotFoundError:
            return RenderResult(
                ok=False,
                output=(
                    "RenderCV is not installed in the app virtualenv or on PATH. "
                    'Run ./scripts/setup.sh, or install it with pip install "rendercv[full]".'
                ),
                pdf_path=None,
            )
        output = "\n".join(part for part in [result.stdout, result.stderr] if part)
        pdfs = sorted(output_dir.glob("*.pdf"), key=lambda p: p.stat().st_mtime_ns)
        return RenderResult(
            ok=result.returncode == 0,
            output=output.strip(),
            pdf_path=pdfs[-1] if pdfs else None,
        )


def format_timestamp(state: Optional[FileState]) -> str:
    if state is None:
        return "missing"
    # mtime_ns is enough for stale detection; use current local timezone for display.
    return datetime.fromtimestamp(state.mtime_ns / 1_000_000_000).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
