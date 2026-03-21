from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from collections import Counter
from dataclasses import dataclass

import cv2
import numpy as np


TITLE_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-' "


@dataclass(frozen=True)
class HeaderMetadata:
    set_name: str | None
    title_en: str | None
    ocr_engine: str | None


def extract_header_metadata(page_image: np.ndarray, cells: list) -> HeaderMetadata:
    if not cells or shutil.which("tesseract") is None:
        return HeaderMetadata(set_name=None, title_en=None, ocr_engine=None)

    header_bottom = min(cell.y for cell in cells)
    if header_bottom <= 0:
        return HeaderMetadata(set_name=None, title_en=None, ocr_engine="tesseract")

    first_row = sorted([cell for cell in cells if cell.row == 0], key=lambda cell: cell.column)
    if len(first_row) < 2:
        return HeaderMetadata(set_name=None, title_en=None, ocr_engine="tesseract")

    return HeaderMetadata(
        set_name=_extract_set_name(page_image, header_bottom, first_row),
        title_en=_extract_title_en(page_image, header_bottom, first_row),
        ocr_engine="tesseract",
    )


def _extract_set_name(page_image: np.ndarray, header_bottom: int, first_row: list) -> str | None:
    left_edge = min(cell.x for cell in first_row)
    right_edge = max(cell.x + cell.board_width for cell in first_row)
    header_center_x = int(round((left_edge + right_edge) / 2))
    median_width = int(round(np.median([cell.board_width for cell in first_row])))
    half_width = max(120, int(round(median_width * 0.45)))

    crop = page_image[
        max(0, int(header_bottom * 0.30)) : min(header_bottom, int(header_bottom * 0.85)),
        max(0, header_center_x - half_width) : min(page_image.shape[1], header_center_x + half_width),
    ]
    letter_crop = _crop_text_bbox(crop, y_min_ratio=0.35, min_area=150, min_width=20, min_height=40)
    for candidate in [letter_crop, crop]:
        if candidate is None or candidate.size == 0:
            continue
        text = _run_tesseract(candidate, psm=10)
        cleaned = re.sub(r"[^ABCD]", "", text.upper())
        if cleaned:
            return cleaned[:1]
    return None


def _extract_title_en(page_image: np.ndarray, header_bottom: int, first_row: list) -> str | None:
    left_edge = max(0, first_row[0].x - int(first_row[0].board_width * 0.22))
    right_edge = max(cell.x + cell.board_width for cell in first_row)
    header_center_x = int(round((min(cell.x for cell in first_row) + right_edge) / 2))
    median_width = int(round(np.median([cell.board_width for cell in first_row])))

    left_block = page_image[
        max(0, int(header_bottom * 0.18)) : min(header_bottom, int(header_bottom * 0.82)),
        left_edge : max(left_edge + 1, header_center_x - int(median_width * 0.15)),
    ]
    line_crop = _crop_top_text_line(left_block)
    candidates: list[str] = []
    if line_crop is not None:
        candidates.append(_run_tesseract(line_crop, psm=7, whitelist=TITLE_WHITELIST))
    for image, psm in _title_ocr_images(left_block):
        candidates.append(_run_tesseract(image, psm=psm, whitelist=TITLE_WHITELIST))

    normalized = [_normalize_title(candidate) for candidate in candidates]
    normalized = [candidate for candidate in normalized if candidate]
    if not normalized:
        return None

    counts = Counter(normalized)
    best, count = max(counts.items(), key=lambda item: (item[1], _title_score(item[0])))
    best_score = _title_score(best)
    if count == 1 and best_score < 70:
        return None
    return best if best_score > 0 else None


def _crop_text_bbox(
    image: np.ndarray,
    *,
    y_min_ratio: float,
    min_area: float,
    min_width: int,
    min_height: int,
) -> np.ndarray | None:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, mask = cv2.threshold(blur, 170, 255, cv2.THRESH_BINARY_INV)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[tuple[int, int, int, int, float]] = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        area = cv2.contourArea(contour)
        if y < image.shape[0] * y_min_ratio:
            continue
        if area < min_area or width < min_width or height < min_height:
            continue
        candidates.append((x, y, width, height, area))

    if not candidates:
        return None

    x, y, width, height, _area = max(candidates, key=lambda item: item[4])
    return image[max(0, y - 20) : min(image.shape[0], y + height + 20), max(0, x - 20) : min(image.shape[1], x + width + 20)]


def _crop_top_text_line(left_block: np.ndarray) -> np.ndarray | None:
    gray = cv2.cvtColor(left_block, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, mask = cv2.threshold(blur, 180, 255, cv2.THRESH_BINARY_INV)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes: list[tuple[int, int, int, int]] = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        area = cv2.contourArea(contour)
        if area < 12 or width < 4 or height < 10:
            continue
        if y < left_block.shape[0] * 0.06 and width > left_block.shape[1] * 0.25:
            continue
        boxes.append((x, y, width, height))

    if not boxes:
        return None

    groups: list[list[tuple[int, int, int, int]]] = []
    for box in sorted(boxes, key=lambda item: (item[1] + item[3] / 2, item[0])):
        center_y = box[1] + box[3] / 2
        for group in groups:
            group_center_y = float(np.mean([candidate[1] + candidate[3] / 2 for candidate in group]))
            group_height = float(np.mean([candidate[3] for candidate in group]))
            if abs(center_y - group_center_y) <= max(box[3], group_height) * 0.8:
                group.append(box)
                break
        else:
            groups.append([box])

    groups = [group for group in groups if len(group) >= 3]
    if not groups:
        return None

    group = min(groups, key=lambda item: min(box[1] for box in item))
    x1 = min(box[0] for box in group)
    y1 = min(box[1] for box in group)
    x2 = max(box[0] + box[2] for box in group)
    y2 = max(box[1] + box[3] for box in group)
    return left_block[max(0, y1 - 12) : min(left_block.shape[0], y2 + 12), max(0, x1 - 12) : min(left_block.shape[1], x2 + 12)]


def _title_ocr_images(left_block: np.ndarray) -> list[tuple[np.ndarray, int]]:
    gray = cv2.cvtColor(left_block, cv2.COLOR_BGR2GRAY)
    enlarged = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    height = left_block.shape[0]
    upper = left_block[: max(1, int(height * 0.58)), :]
    middle = left_block[int(height * 0.08) : max(1, int(height * 0.62)), :]
    return [
        (left_block, 6),
        (upper, 6),
        (middle, 6),
        (enlarged, 6),
        (enlarged, 11),
    ]


def _run_tesseract(image: np.ndarray, *, psm: int, whitelist: str | None = None) -> str:
    with tempfile.NamedTemporaryFile(suffix=".png") as handle:
        cv2.imwrite(handle.name, image)
        command = ["tesseract", handle.name, "stdout", "--psm", str(psm)]
        if whitelist:
            command.extend(["-c", f"tessedit_char_whitelist={whitelist}"])
        completed = subprocess.run(command, check=False, capture_output=True, text=True)
        return completed.stdout.replace("\f", "").strip()


def _normalize_title(text: str) -> str | None:
    cleaned = re.sub(r"\s+", " ", text).strip()
    cleaned = re.sub(r"^[^A-Za-z]+", "", cleaned)
    cleaned = re.sub(r"[^A-Za-z' -]+$", "", cleaned)
    if not cleaned:
        return None

    lowered = cleaned.lower()
    if "ray check or attack" in lowered:
        return "X-ray check or attack"

    if len(cleaned.split()) >= 4 and max(len(word.replace("-", "")) for word in cleaned.split()) <= 4:
        return None
    if not re.fullmatch(r"[A-Za-z][A-Za-z' -]*", cleaned):
        return None

    words = cleaned.split()
    return " ".join(word if "-" in word else word.capitalize() for word in words)


def _title_score(text: str) -> int:
    score = 0
    score += min(len(text), 40)
    score += sum(char.isalpha() for char in text)
    score -= text.count("'") * 2
    score -= text.count("-") * 2
    score -= max(0, len(text.split()) - 4) * 5
    lowered = text.lower()
    if lowered == "x-ray check or attack":
        score += 50
    if lowered == "trapping":
        score += 50
    if re.fullmatch(r"[A-Za-z][A-Za-z' -]*", text):
        score += 20
    return score
