from __future__ import annotations

import json
from pathlib import Path

import pytest

from vision.cells import extract_cells, write_result


FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "puzzle_pages"


@pytest.mark.parametrize(
    ("fixture_name", "expected_cells", "expected_detected", "expected_inferred"),
    [
        ("page-sample-1.jpg", 12, 12, 0),
        ("sample-2.JPG", 11, 10, 1),
        ("sample-3.JPG", 12, 12, 0),
        ("sample-4.JPG", 12, 12, 0),
    ],
)
def test_extract_cells_matches_fixture_layout(
    fixture_name: str,
    expected_cells: int,
    expected_detected: int,
    expected_inferred: int,
) -> None:
    _page_image, result = extract_cells(FIXTURE_DIR / fixture_name)

    assert len(result.cells) == expected_cells
    assert result.detected_boards == expected_detected
    assert len([cell for cell in result.cells if cell.source == "inferred"]) == expected_inferred
    assert result.rows == 4
    assert result.columns == 3


def test_sample_2_infers_merged_top_left_slot() -> None:
    _page_image, result = extract_cells(FIXTURE_DIR / "sample-2.JPG")

    inferred_cells = [cell for cell in result.cells if cell.source == "inferred"]
    assert len(inferred_cells) == 1

    merged = inferred_cells[0]
    assert merged.row == 0
    assert merged.column == 0
    assert merged.column_span == 2


def test_write_result_creates_manifest_and_crops(tmp_path: Path) -> None:
    page_image, result = extract_cells(FIXTURE_DIR / "page-sample-1.jpg")

    page_dir = write_result(page_image, result, tmp_path)
    manifest = json.loads((page_dir / "manifest.json").read_text())

    assert (page_dir / "normalized.jpg").exists()
    assert (page_dir / "overlay.jpg").exists()
    assert len(list(page_dir.glob("cell-*.jpg"))) == len(result.cells)
    assert len(manifest["cells"]) == len(result.cells)
    assert manifest["cells"][0]["marker"] in {"black", "white"}


def test_cells_include_right_edge_margin() -> None:
    _page_image, result = extract_cells(FIXTURE_DIR / "page-sample-1.jpg")

    first_cell = result.cells[0]

    original_board_width = 810
    expected_margin = round(original_board_width * 0.125)

    assert first_cell.width > original_board_width
    assert abs(first_cell.width - (original_board_width + expected_margin)) <= 2


def test_marker_detection_emits_black_and_white_values() -> None:
    _page_image, result = extract_cells(FIXTURE_DIR / "page-sample-1.jpg")

    assert result.cells[0].marker == "black"
    assert result.cells[2].marker == "white"


def test_non_puzzle_or_merged_cells_can_emit_white_marker() -> None:
    _page_image, result = extract_cells(FIXTURE_DIR / "sample-2.JPG")

    assert result.cells[0].source == "inferred"
    assert result.cells[0].marker == "white"
