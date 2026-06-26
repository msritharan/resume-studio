#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

from create_variant import resolve_workspace, slugify


def rendercv_command() -> str | None:
    override = os.environ.get("RENDERCV_COMMAND")
    if override:
        return override
    for script_name in ("rendercv", "rendercv.exe"):
        local_script = Path(sys.executable).with_name(script_name)
        if local_script.is_file() and os.access(local_script, os.X_OK):
            return str(local_script)
    return shutil.which("rendercv")


def run(
    args: list[str],
    cwd: Path,
    check: bool = False,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=cwd,
        text=True,
        capture_output=True,
        check=check,
    )


def validate_yaml(resume_path: Path) -> None:
    with resume_path.open(encoding="utf-8") as file:
        loaded = yaml.safe_load(file)
    if not isinstance(loaded, dict):
        raise ValueError("resume YAML must parse to a mapping")
    if "cv" not in loaded:
        raise ValueError("resume YAML is missing top-level 'cv'")


def render_variant(workspace: Path, variant: str) -> tuple[str, Path]:
    command = rendercv_command()
    if command is None:
        raise RuntimeError(
            "RenderCV is not installed in the active Python environment or on PATH"
        )

    variant_dir = workspace / "variants" / variant
    resume_path = variant_dir / "resume.yaml"
    output_dir = variant_dir / "rendercv_output"
    output_dir.mkdir(exist_ok=True)
    for artifact in output_dir.iterdir():
        if artifact.is_file():
            artifact.unlink()

    result = run(
        [command, "render", str(resume_path), "--output-folder", str(output_dir)],
        cwd=variant_dir,
    )
    output = "\n".join(part for part in [result.stdout, result.stderr] if part).strip()
    if result.returncode != 0:
        raise RuntimeError(output or "RenderCV failed")
    pdfs = sorted(output_dir.glob("*.pdf"), key=lambda path: path.stat().st_mtime_ns)
    if not pdfs:
        raise RuntimeError(output or "RenderCV succeeded but did not produce a PDF")
    return output, pdfs[-1]


def snapshot_variant(workspace: Path, variant: str, message: str) -> str:
    relative_path = f"variants/{variant}/resume.yaml"
    run(["git", "add", "--", relative_path], cwd=workspace, check=True)
    diff = run(["git", "diff", "--cached", "--quiet", "--", relative_path], cwd=workspace)
    if diff.returncode == 0:
        raise RuntimeError("no saved changes to snapshot")
    run(
        [
            "git",
            "-c",
            "user.name=Resume Studio",
            "-c",
            "user.email=resume-studio@example.local",
            "commit",
            "-m",
            message.strip() or f"Tailor {variant}",
            "--",
            relative_path,
        ],
        cwd=workspace,
        check=True,
    )
    return run(["git", "rev-parse", "HEAD"], cwd=workspace, check=True).stdout.strip()


def finalize_variant(workspace: Path, variant_name: str, message: str) -> dict[str, str]:
    variant = slugify(variant_name)
    resume_path = workspace / "variants" / variant / "resume.yaml"
    if not resume_path.is_file():
        raise FileNotFoundError(f"variant does not exist: {variant}")

    validate_yaml(resume_path)
    render_output, pdf_path = render_variant(workspace, variant)
    commit = snapshot_variant(workspace, variant, message)
    return {
        "workspace": str(workspace),
        "variant": variant,
        "resume": str(resume_path),
        "pdf": str(pdf_path),
        "commit": commit,
        "render_output": render_output,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate, render, and snapshot a Resume Studio variant."
    )
    parser.add_argument("--workspace", help="Path to the resume workspace.")
    parser.add_argument("--variant", required=True, help="Variant slug or name.")
    parser.add_argument("--message", default="", help="Snapshot commit message.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = finalize_variant(
            resolve_workspace(args.workspace),
            variant_name=args.variant,
            message=args.message,
        )
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
