from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest
from django.core.management import call_command

from positions.models import Position


@pytest.mark.django_db
def test_import_puzzle_folder_creates_positions_and_tags(tmp_path: Path) -> None:
    folder = tmp_path / "pages"
    folder.mkdir()
    image_one = folder / "page-1.jpg"
    image_two = folder / "page-2.png"
    image_one.write_bytes(b"fake")
    image_two.write_bytes(b"fake")

    manifests = {
        image_one.name: {
            "set_name": "A",
            "title_en": "X-ray check or attack",
            "cells": [
                {"fen": "8/8/8/8/8/8/8/4K3 w - - 0 1", "crop_path": "crop-1.jpg"},
                {"fen": "", "fen_error": "no pieces", "crop_path": "crop-2.jpg"},
            ],
        },
        image_two.name: {
            "set_name": "B",
            "title_en": "Trapping",
            "cells": [
                {"fen": "8/8/8/8/8/8/8/4K3 b - - 0 1", "crop_path": "crop-3.jpg"},
            ],
        },
    }

    def fake_extract_cells(image_path):
        return np.zeros((20, 20, 3), dtype=np.uint8), SimpleNamespace(cells=[])

    def fake_write_result(page_image, result, output_root, fenify_predictor=None, progress_callback=None):
        image_name = Path(output_root_marker["current"]).name
        page_dir = Path(output_root) / Path(image_name).stem
        page_dir.mkdir(parents=True, exist_ok=True)
        (page_dir / "manifest.json").write_text(json.dumps(manifests[image_name]))
        return page_dir

    output_root_marker = {"current": ""}

    def fake_extract_wrapper(image_path):
        output_root_marker["current"] = str(image_path)
        return fake_extract_cells(image_path)

    with (
        patch("positions.management.commands.import_puzzle_folder.FenifyPredictor") as predictor_cls,
        patch("positions.management.commands.import_puzzle_folder.extract_cells", side_effect=fake_extract_wrapper),
        patch("positions.management.commands.import_puzzle_folder.write_result", side_effect=fake_write_result),
        patch("builtins.input", return_value="3"),
    ):
        predictor_cls.return_value = object()
        call_command("import_puzzle_folder", str(folder))

    assert Position.objects.count() == 2

    pos1 = Position.objects.get(name="X-ray check or attack set A #01")
    assert pos1.fen.endswith(" w - - 0 1")
    assert set(pos1.tags.values_list("name", flat=True)) == {
        "stage:3",
        "tactic:X-ray check or attack",
        "set:A",
    }

    pos2 = Position.objects.get(name="Trapping set B #01")
    assert pos2.fen.endswith(" b - - 0 1")
    assert set(pos2.tags.values_list("name", flat=True)) == {
        "stage:3",
        "tactic:Trapping",
        "set:B",
    }


@pytest.mark.django_db
def test_import_puzzle_folder_skips_existing_sources(tmp_path: Path) -> None:
    folder = tmp_path / "pages"
    folder.mkdir()
    image = folder / "page-1.jpg"
    image.write_bytes(b"fake")

    manifest = {
        "set_name": "A",
        "title_en": "X-ray check or attack",
        "cells": [
            {"fen": "8/8/8/8/8/8/8/4K3 w - - 0 1", "crop_path": "crop-1.jpg"},
        ],
    }

    def fake_extract_cells(_image_path):
        return np.zeros((20, 20, 3), dtype=np.uint8), SimpleNamespace(cells=[])

    def fake_write_result(_page_image, _result, output_root, fenify_predictor=None, progress_callback=None):
        page_dir = Path(output_root) / "page-1"
        page_dir.mkdir(parents=True, exist_ok=True)
        (page_dir / "manifest.json").write_text(json.dumps(manifest))
        return page_dir

    with (
        patch("positions.management.commands.import_puzzle_folder.FenifyPredictor") as predictor_cls,
        patch("positions.management.commands.import_puzzle_folder.extract_cells", side_effect=fake_extract_cells),
        patch("positions.management.commands.import_puzzle_folder.write_result", side_effect=fake_write_result),
    ):
        predictor_cls.return_value = object()
        call_command("import_puzzle_folder", str(folder), stage=4)
        call_command("import_puzzle_folder", str(folder), stage=4)

    assert Position.objects.count() == 1
