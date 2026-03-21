from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np

RIGHT_MARGIN_RATIO = 0.125


@dataclass(frozen=True)
class CellCandidate:
    x: int
    y: int
    width: int
    board_width: int
    height: int
    row: int
    column: int
    column_span: int
    source: str
    score: float
    marker: str = "white"

    @property
    def center_x(self) -> float:
        return self.x + (self.board_width / 2)

    @property
    def center_y(self) -> float:
        return self.y + (self.height / 2)


@dataclass(frozen=True)
class ExtractionResult:
    image_path: str
    normalized_width: int
    normalized_height: int
    detected_boards: int
    rows: int
    columns: int
    cells: list[CellCandidate]


def _expand_right_margin(
    cells: list[CellCandidate],
    page_width: int,
    margin_ratio: float = RIGHT_MARGIN_RATIO,
) -> list[CellCandidate]:
    expanded: list[CellCandidate] = []
    for cell in cells:
        margin = max(1, int(round(cell.board_width * margin_ratio)))
        width = min(page_width, cell.x + cell.board_width + margin) - cell.x
        expanded.append(
            CellCandidate(
                x=cell.x,
                y=cell.y,
                width=width,
                board_width=cell.board_width,
                height=cell.height,
                row=cell.row,
                column=cell.column,
                column_span=cell.column_span,
                source=cell.source,
                score=cell.score,
            )
        )
    return expanded


def _classify_marker(page_image: np.ndarray, cell: CellCandidate) -> str:
    crop = page_image[cell.y : cell.y + cell.height, cell.x : cell.x + cell.width]
    if crop.size == 0:
        return "white"

    height, width = crop.shape[:2]
    roi = crop[: max(24, int(height * 0.14)), cell.board_width : width]
    if roi.size == 0:
        return "white"

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, mask = cv2.threshold(blurred, 110, 255, cv2.THRESH_BINARY_INV)
    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_OPEN,
        np.ones((3, 3), dtype=np.uint8),
        iterations=1,
    )

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cell_area = width * height
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < cell_area * 0.001 or area > cell_area * 0.008:
            continue

        perimeter = cv2.arcLength(contour, True)
        if perimeter == 0:
            continue

        circularity = 4 * math.pi * area / (perimeter * perimeter)
        x, y, contour_width, contour_height = cv2.boundingRect(contour)
        aspect_ratio = contour_width / max(contour_height, 1)
        fill_ratio = area / max(1, contour_width * contour_height)

        if not 0.75 <= aspect_ratio <= 1.25:
            continue
        if circularity < 0.65 or fill_ratio < 0.5:
            continue
        if x <= 1 or y <= 1:
            continue
        if x + contour_width >= roi.shape[1] - 1 or y + contour_height >= roi.shape[0] - 1:
            continue
        return "black"

    return "white"


def _annotate_markers(page_image: np.ndarray, cells: list[CellCandidate]) -> list[CellCandidate]:
    return [replace(cell, marker=_classify_marker(page_image, cell)) for cell in cells]


def _order_points(points: np.ndarray) -> np.ndarray:
    pts = points.astype("float32")
    rect = np.zeros((4, 2), dtype="float32")
    sums = pts.sum(axis=1)
    diffs = np.diff(pts, axis=1).reshape(-1)
    rect[0] = pts[np.argmin(sums)]
    rect[2] = pts[np.argmax(sums)]
    rect[1] = pts[np.argmin(diffs)]
    rect[3] = pts[np.argmax(diffs)]
    return rect


def _warp_page(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (7, 7), 0)
    edges = cv2.Canny(blur, 30, 120)
    edges = cv2.dilate(edges, np.ones((5, 5), dtype=np.uint8), iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = image.shape[0] * image.shape[1]
    best_quad: np.ndarray | None = None
    best_area = 0.0

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < image_area * 0.18:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
        if len(approx) != 4:
            continue
        if area > best_area:
            best_area = area
            best_quad = approx.reshape(4, 2)

    if best_quad is None:
        return image.copy()

    rect = _order_points(best_quad)
    width_a = np.linalg.norm(rect[2] - rect[3])
    width_b = np.linalg.norm(rect[1] - rect[0])
    height_a = np.linalg.norm(rect[1] - rect[2])
    height_b = np.linalg.norm(rect[0] - rect[3])
    max_width = int(round(max(width_a, width_b)))
    max_height = int(round(max(height_a, height_b)))
    destination = np.array(
        [
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1],
        ],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(rect, destination)
    warped = cv2.warpPerspective(image, matrix, (max_width, max_height))
    if warped.shape[0] < warped.shape[1]:
        warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)
    return warped


def _dedupe_candidates(boxes: list[tuple[int, int, int, int, float]]) -> list[tuple[int, int, int, int, float]]:
    deduped: list[tuple[int, int, int, int, float]] = []
    for candidate in sorted(boxes, key=lambda item: (item[4], item[2] * item[3]), reverse=True):
        x1, y1, w1, h1, score1 = candidate
        keep = True
        for x2, y2, w2, h2, _score2 in deduped:
            left = max(x1, x2)
            top = max(y1, y2)
            right = min(x1 + w1, x2 + w2)
            bottom = min(y1 + h1, y2 + h2)
            overlap_w = max(0, right - left)
            overlap_h = max(0, bottom - top)
            intersection = overlap_w * overlap_h
            union = (w1 * h1) + (w2 * h2) - intersection
            if union and (intersection / union) > 0.55:
                keep = False
                break
        if keep:
            deduped.append(candidate)
    return sorted(deduped, key=lambda item: (item[1], item[0]))


def detect_boards(page_image: np.ndarray) -> list[tuple[int, int, int, int, float]]:
    gray = cv2.cvtColor(page_image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    normalized = clahe.apply(gray)
    blurred = cv2.GaussianBlur(normalized, (5, 5), 0)
    threshold = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        35,
        6,
    )
    threshold = cv2.morphologyEx(
        threshold,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)),
        iterations=1,
    )
    contours, _ = cv2.findContours(threshold, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    page_area = page_image.shape[0] * page_image.shape[1]
    boxes: list[tuple[int, int, int, int, float]] = []

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < page_area * 0.003 or area > page_area * 0.08:
            continue

        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.04 * perimeter, True)
        if len(approx) < 4:
            continue

        x, y, width, height = cv2.boundingRect(contour)
        aspect_ratio = width / max(height, 1)
        if not 0.78 <= aspect_ratio <= 1.22:
            continue

        if width < 90 or height < 90:
            continue

        boxes.append((x, y, width, height, float(area)))

    return _dedupe_candidates(boxes)


def _cluster_axis(values: list[float], tolerance: float) -> list[float]:
    if not values:
        return []

    clusters: list[list[float]] = [[values[0]]]
    for value in sorted(values[1:]):
        if abs(value - np.mean(clusters[-1])) <= tolerance:
            clusters[-1].append(value)
        else:
            clusters.append([value])
    return [float(np.mean(cluster)) for cluster in clusters]


def infer_cells(
    boards: list[tuple[int, int, int, int, float]],
    page_shape: tuple[int, int, int],
) -> list[CellCandidate]:
    if not boards:
        return []

    widths = [width for _x, _y, width, _height, _score in boards]
    heights = [height for _x, _y, _width, height, _score in boards]
    centers_x = [x + (width / 2) for x, _y, width, _height, _score in boards]
    centers_y = [y + (height / 2) for _x, y, _width, height, _score in boards]

    median_width = float(np.median(widths))
    median_height = float(np.median(heights))

    columns = _cluster_axis(sorted(centers_x), tolerance=median_width * 0.55)
    rows = _cluster_axis(sorted(centers_y), tolerance=median_height * 0.55)

    assignments: dict[tuple[int, int], tuple[int, int, int, int, float]] = {}
    for board in boards:
        x, y, width, height, score = board
        center_x = x + (width / 2)
        center_y = y + (height / 2)
        column = min(range(len(columns)), key=lambda idx: abs(columns[idx] - center_x))
        row = min(range(len(rows)), key=lambda idx: abs(rows[idx] - center_y))
        previous = assignments.get((row, column))
        if previous is None or score > previous[4]:
            assignments[(row, column)] = board

    cells: list[CellCandidate] = []
    for row_index in range(len(rows)):
        column_index = 0
        while column_index < len(columns):
            assigned = assignments.get((row_index, column_index))
            if assigned is not None:
                x, y, width, height, score = assigned
                cells.append(
                    CellCandidate(
                        x=int(round(x)),
                        y=int(round(y)),
                        width=int(round(width)),
                        board_width=int(round(width)),
                        height=int(round(height)),
                        row=row_index,
                        column=column_index,
                        column_span=1,
                        source="detected",
                        score=score,
                    )
                )
                column_index += 1
                continue

            start = column_index
            while column_index < len(columns) and assignments.get((row_index, column_index)) is None:
                column_index += 1
            span = column_index - start
            left = columns[start] - (median_width / 2)
            right = columns[column_index - 1] + (median_width / 2)
            top = rows[row_index] - (median_height / 2)
            bottom = rows[row_index] + (median_height / 2)
            cells.append(
                CellCandidate(
                    x=max(0, int(round(left))),
                    y=max(0, int(round(top))),
                    width=min(page_shape[1], int(round(right))) - max(0, int(round(left))),
                    board_width=min(page_shape[1], int(round(right))) - max(0, int(round(left))),
                    height=min(page_shape[0], int(round(bottom))) - max(0, int(round(top))),
                    row=row_index,
                    column=start,
                    column_span=span,
                    source="inferred",
                    score=0.0,
                )
            )

    return sorted(cells, key=lambda cell: (cell.row, cell.column))


def extract_cells(image_path: str | Path) -> tuple[np.ndarray, ExtractionResult]:
    path = Path(image_path)
    image = cv2.imread(str(path))
    if image is None:
        raise ValueError(f"Could not read image: {path}")

    page = _warp_page(image)
    boards = detect_boards(page)
    cells = _annotate_markers(
        page,
        _expand_right_margin(infer_cells(boards, page.shape), page.shape[1]),
    )
    result = ExtractionResult(
        image_path=str(path),
        normalized_width=page.shape[1],
        normalized_height=page.shape[0],
        detected_boards=len(boards),
        rows=len({cell.row for cell in cells}),
        columns=max((cell.column + cell.column_span for cell in cells), default=0),
        cells=cells,
    )
    return page, result


def _draw_overlay(page_image: np.ndarray, result: ExtractionResult) -> np.ndarray:
    overlay = page_image.copy()
    for index, cell in enumerate(result.cells, start=1):
        color = (60, 180, 75) if cell.source == "detected" else (0, 140, 255)
        cv2.rectangle(
            overlay,
            (cell.x, cell.y),
            (cell.x + cell.width, cell.y + cell.height),
            color,
            3,
        )
        cv2.putText(
            overlay,
            f"{index}:{cell.row},{cell.column}+{cell.column_span}",
            (cell.x, max(24, cell.y - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            color,
            2,
            cv2.LINE_AA,
        )
    return overlay


def write_result(
    page_image: np.ndarray,
    result: ExtractionResult,
    output_root: str | Path,
    fenify_predictor: Any | None = None,
    progress_callback: Callable[[str], None] | None = None,
) -> Path:
    output_root = Path(output_root)
    page_name = Path(result.image_path).stem
    page_dir = output_root / page_name
    page_dir.mkdir(parents=True, exist_ok=True)

    normalized_path = page_dir / "normalized.jpg"
    overlay_path = page_dir / "overlay.jpg"
    manifest_path = page_dir / "manifest.json"

    cv2.imwrite(str(normalized_path), page_image)
    cv2.imwrite(str(overlay_path), _draw_overlay(page_image, result))

    manifest = asdict(result)
    manifest["cells"] = [asdict(cell) for cell in result.cells]
    if fenify_predictor is not None:
        manifest["fenify"] = {
            "repo_dir": str(fenify_predictor.repo_dir),
            "model_path": str(fenify_predictor.model_path),
        }
    for index, cell in enumerate(result.cells, start=1):
        crop = page_image[cell.y : cell.y + cell.height, cell.x : cell.x + cell.board_width]
        crop_path = page_dir / f"cell-{index:02d}-r{cell.row + 1}c{cell.column + 1}-span{cell.column_span}.jpg"
        cv2.imwrite(str(crop_path), crop)
        manifest["cells"][index - 1]["crop_path"] = str(crop_path)
        marker_crop = page_image[cell.y : cell.y + cell.height, cell.x : cell.x + cell.width]
        marker_crop_path = page_dir / (
            f"marker-cell-{index:02d}-r{cell.row + 1}c{cell.column + 1}-span{cell.column_span}.jpg"
        )
        cv2.imwrite(str(marker_crop_path), marker_crop)
        manifest["cells"][index - 1]["marker_crop_path"] = str(marker_crop_path)
        if fenify_predictor is not None:
            if progress_callback is not None:
                progress_callback(f"fenify {page_name} {index}/{len(result.cells)} {crop_path.name}")
            try:
                prediction = fenify_predictor.predict(crop_path, cell.marker)
            except Exception as exc:
                manifest["cells"][index - 1]["fen_error"] = str(exc)
            else:
                manifest["cells"][index - 1]["board_fen"] = prediction.board_fen
                manifest["cells"][index - 1]["fen"] = prediction.fen

    manifest_path.write_text(json.dumps(manifest, indent=2))
    return page_dir


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m vision",
        description="Extract candidate puzzle cells from a photographed chess puzzle page.",
    )
    parser.add_argument("images", nargs="+", help="Image file(s) to process")
    parser.add_argument(
        "--output-dir",
        default="tmp/extracted-cells",
        help="Directory for normalized images, overlays, crops, and manifest JSON",
    )
    parser.add_argument(
        "--fenify",
        action="store_true",
        help="Run board-only crops through Fenify and add predicted FEN strings to the manifest",
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
    args = parser.parse_args(argv)

    def progress(message: str) -> None:
        print(message, file=sys.stderr, flush=True)

    fenify_predictor = None
    if args.fenify:
        from vision.fenify import FenifyPredictor

        progress("fenify loading model")
        fenify_predictor = FenifyPredictor(model_path=args.fenify_model, repo_dir=args.fenify_repo)
        progress(
            f"fenify model ready repo={fenify_predictor.repo_dir} model={fenify_predictor.model_path.name}"
        )

    for image_path in args.images:
        progress(f"extracting {image_path}")
        page_image, result = extract_cells(image_path)
        progress(f"writing {image_path} cells={len(result.cells)}")
        page_dir = write_result(
            page_image,
            result,
            args.output_dir,
            fenify_predictor=fenify_predictor,
            progress_callback=progress if fenify_predictor is not None else None,
        )
        print(
            json.dumps(
                {
                    "image": image_path,
                    "detected_boards": result.detected_boards,
                    "rows": result.rows,
                    "columns": result.columns,
                    "cells": len(result.cells),
                    "output_dir": str(page_dir),
                }
            )
        )
    return 0
