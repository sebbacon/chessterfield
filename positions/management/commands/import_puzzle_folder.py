import hashlib
import json
import os
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from positions.models import Position, Tag
from vision.cells import extract_cells, write_result
from vision.fenify import FenifyPredictor


SUPPORTED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}


class Command(BaseCommand):
    help = "Extract puzzle pages from a folder and import each detected cell as a tagged position"

    def add_arguments(self, parser):
        parser.add_argument("folder", help="Folder containing photographed puzzle page images")
        parser.add_argument(
            "--stage",
            type=int,
            default=None,
            help="Stage number tag to apply. If omitted, you will be prompted once.",
        )
        parser.add_argument(
            "--output-dir",
            default="tmp/imported-puzzle-pages",
            help="Directory for manifests, overlays, and crop artifacts",
        )
        parser.add_argument(
            "--fenify-model",
            default=os.environ.get("FENIFY_MODEL_PATH"),
            help="Path to the Fenify TorchScript model (defaults to $FENIFY_MODEL_PATH if set)",
        )
        parser.add_argument(
            "--fenify-repo",
            default=os.environ.get("FENIFY_REPO_DIR"),
            help="Path to a local Fenify checkout (defaults to $FENIFY_REPO_DIR or tmp/fenify)",
        )

    def handle(self, *args, **options):
        folder = Path(options["folder"]).expanduser().resolve()
        if not folder.is_dir():
            raise CommandError(f"Folder not found: {folder}")

        stage = options["stage"] if options["stage"] is not None else self._prompt_stage()
        image_paths = sorted(
            path for path in folder.iterdir() if path.is_file() and path.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES
        )
        if not image_paths:
            raise CommandError(f"No supported image files found in {folder}")

        predictor = FenifyPredictor(
            model_path=options["fenify_model"],
            repo_dir=options["fenify_repo"],
        )

        created = skipped = failed = 0
        for image_path in image_paths:
            self.stderr.write(f"processing {image_path.name}")
            page_image, result = extract_cells(image_path)
            page_dir = write_result(
                page_image,
                result,
                options["output_dir"],
                fenify_predictor=predictor,
                progress_callback=self.stderr.write,
            )
            manifest = json.loads((page_dir / "manifest.json").read_text())
            page_created, page_skipped, page_failed = self._import_page(
                image_path=image_path,
                manifest=manifest,
                stage=stage,
            )
            created += page_created
            skipped += page_skipped
            failed += page_failed
            self.stdout.write(
                f"{image_path.name}: {page_created} created, {page_skipped} skipped, {page_failed} failed"
            )

        self.stdout.write(
            f"Done: {len(image_paths)} pages, {created} created, {skipped} skipped, {failed} failed."
        )

    def _prompt_stage(self) -> int:
        while True:
            try:
                raw = input("Stage number: ").strip()
            except EOFError as exc:
                raise CommandError("Stage number is required when stdin is not interactive.") from exc
            if raw.isdigit():
                return int(raw)
            self.stderr.write("Please enter a whole-number stage.")

    def _import_page(self, image_path: Path, manifest: dict, stage: int) -> tuple[int, int, int]:
        tactic = manifest.get("title_en")
        set_name = manifest.get("set_name")

        tag_names = [f"stage:{stage}"]
        if tactic:
            tag_names.append(f"tactic:{tactic}")
        if set_name:
            tag_names.append(f"set:{set_name}")
        tags = [Tag.objects.get_or_create(name=name)[0] for name in tag_names]

        created = skipped = failed = 0
        for index, cell in enumerate(manifest.get("cells", []), start=1):
            fen = (cell.get("fen") or "").strip()
            if not fen:
                failed += 1
                self.stderr.write(
                    f"skip {image_path.name} cell {index:02d}: missing fen"
                    + (f" ({cell.get('fen_error')})" if cell.get("fen_error") else "")
                )
                continue

            source = self._position_source(image_path, index)
            if Position.objects.filter(source=source).exists():
                skipped += 1
                continue

            position = Position.objects.create(
                name=self._position_name(image_path, index, tactic, set_name),
                fen=fen,
                notes=self._position_notes(image_path, index, cell, tactic, set_name, stage),
                source=source,
            )
            position.tags.add(*tags)
            created += 1

        return created, skipped, failed

    def _position_source(self, image_path: Path, index: int) -> str:
        digest = hashlib.sha1(str(image_path.resolve()).encode("utf-8")).hexdigest()[:12]
        return f"puzzle-page:{digest}:{index:02d}"

    def _position_name(
        self,
        image_path: Path,
        index: int,
        tactic: str | None,
        set_name: str | None,
    ) -> str:
        parts = []
        if tactic:
            parts.append(tactic)
        if set_name:
            parts.append(f"set {set_name}")
        if not parts:
            parts.append(image_path.stem)
        parts.append(f"#{index:02d}")
        return " ".join(parts)

    def _position_notes(
        self,
        image_path: Path,
        index: int,
        cell: dict,
        tactic: str | None,
        set_name: str | None,
        stage: int,
    ) -> str:
        lines = [
            f"Imported from {image_path.name}",
            f"Stage: {stage}",
            f"Cell: {index:02d}",
        ]
        if tactic:
            lines.append(f"Tactic: {tactic}")
        if set_name:
            lines.append(f"Set: {set_name}")
        crop_path = cell.get("crop_path")
        if crop_path:
            lines.append(f"Crop: {crop_path}")
        return "\n".join(lines)
