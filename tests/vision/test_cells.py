from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path

import cv2
import pytest

from vision.cells import extract_cells, write_result


FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "puzzle_pages"
HAS_TESSERACT = shutil.which("tesseract") is not None


@dataclass(frozen=True)
class FakeFenifyPrediction:
    board_fen: str
    fen: str


class FakeFenifyPredictor:
    def __init__(self) -> None:
        self.repo_dir = Path("/tmp/fake-fenify")
        self.model_path = Path("/tmp/fake-fenify/model.pt")
        self.calls: list[tuple[str, str]] = []

    def predict(self, image_path: str | Path, marker: str) -> FakeFenifyPrediction:
        self.calls.append((Path(image_path).name, marker))
        turn = "b" if marker == "black" else "w"
        board_fen = "8/8/8/8/8/8/8/4K3"
        return FakeFenifyPrediction(board_fen=board_fen, fen=f"{board_fen} {turn} - - 0 1")


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
    assert Path(manifest["cells"][0]["marker_crop_path"]).exists()
    assert "set_name" in manifest
    assert "title_en" in manifest


@pytest.mark.skipif(not HAS_TESSERACT, reason="tesseract not installed")
@pytest.mark.parametrize(
    ("fixture_name", "expected_set", "expected_title"),
    [
        ("page-sample-1.jpg", "A", "X-ray check or attack"),
        ("sample-2.JPG", "B", "X-ray check or attack"),
        ("sample-3.JPG", "B", "Trapping"),
        ("sample-4.JPG", "C", None),
    ],
)
def test_extract_cells_emits_header_metadata(
    fixture_name: str,
    expected_set: str,
    expected_title: str | None,
) -> None:
    _page_image, result = extract_cells(FIXTURE_DIR / fixture_name)

    assert result.set_name == expected_set
    assert result.ocr_engine == "tesseract"
    assert result.title_en == expected_title


def test_exported_cell_crop_excludes_marker_margin(tmp_path: Path) -> None:
    page_image, result = extract_cells(FIXTURE_DIR / "page-sample-1.jpg")

    page_dir = write_result(page_image, result, tmp_path)
    manifest = json.loads((page_dir / "manifest.json").read_text())

    first_cell = result.cells[0]
    board_crop = cv2.imread(manifest["cells"][0]["crop_path"])
    marker_crop = cv2.imread(manifest["cells"][0]["marker_crop_path"])

    assert board_crop is not None
    assert marker_crop is not None
    assert board_crop.shape[1] == first_cell.board_width
    assert marker_crop.shape[1] == first_cell.width
    assert board_crop.shape[1] < marker_crop.shape[1]


def test_write_result_can_append_fen_predictions(tmp_path: Path) -> None:
    page_image, result = extract_cells(FIXTURE_DIR / "page-sample-1.jpg")
    predictor = FakeFenifyPredictor()
    messages: list[str] = []

    page_dir = write_result(
        page_image,
        result,
        tmp_path,
        fenify_predictor=predictor,
        progress_callback=messages.append,
    )
    manifest = json.loads((page_dir / "manifest.json").read_text())

    assert manifest["fenify"]["repo_dir"] == str(predictor.repo_dir)
    assert manifest["fenify"]["model_path"] == str(predictor.model_path)
    assert manifest["cells"][0]["board_fen"] == "8/8/8/8/8/8/8/4K3"
    assert manifest["cells"][0]["fen"].endswith(" b - - 0 1")
    assert manifest["cells"][2]["fen"].endswith(" w - - 0 1")
    assert len(predictor.calls) == len(result.cells)
    assert messages[0].startswith("fenify page-sample-1 1/")
    assert len(messages) == len(result.cells)


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
