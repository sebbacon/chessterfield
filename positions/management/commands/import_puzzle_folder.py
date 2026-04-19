import json
import os
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from positions.puzzle_imports import SUPPORTED_IMAGE_SUFFIXES, import_positions_from_manifest, path_source_digest
from vision.cells import extract_cells, write_result
from vision.fenify import FenifyPredictor


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
            page_summary = import_positions_from_manifest(
                image_label=image_path.name,
                page_digest=path_source_digest(image_path),
                manifest=manifest,
                stage=stage,
                theme_title=manifest.get("title_en"),
                set_name=manifest.get("set_name"),
            )
            created += page_summary.created
            skipped += page_summary.skipped
            failed += page_summary.failed
            self.stdout.write(
                f"{image_path.name}: {page_summary.created} created, {page_summary.skipped} skipped, {page_summary.failed} failed"
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
