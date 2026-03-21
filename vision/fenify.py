from __future__ import annotations

import contextlib
import importlib
import io
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Iterator

import chess


DEFAULT_MODEL_NAME = "models_2023-07-10-chessboard-2D-balanced-fen-cpu.pt"
DEFAULT_REPO_DIR = Path(__file__).resolve().parents[1] / "tmp" / "fenify"


class FenifyError(RuntimeError):
    """Raised when Fenify cannot be loaded or run."""


@dataclass(frozen=True)
class FenifyPrediction:
    board_fen: str
    fen: str


@contextlib.contextmanager
def _prepend_sys_path(path: Path) -> Iterator[None]:
    path_str = str(path)
    sys.path.insert(0, path_str)
    try:
        yield
    finally:
        with contextlib.suppress(ValueError):
            sys.path.remove(path_str)


def _turn_from_marker(marker: str) -> chess.Color:
    if marker == "white":
        return chess.WHITE
    if marker == "black":
        return chess.BLACK
    raise FenifyError(f"Unsupported marker value {marker!r}; expected 'white' or 'black'")


def _candidate_model_paths(repo_dir: Path) -> list[Path]:
    candidates = [
        repo_dir / DEFAULT_MODEL_NAME,
        repo_dir.parent / DEFAULT_MODEL_NAME,
    ]
    candidates.extend(sorted(repo_dir.glob("models_*cpu.pt")))
    candidates.extend(sorted(repo_dir.parent.glob("models_*cpu.pt")))
    deduped: list[Path] = []
    for candidate in candidates:
        if candidate not in deduped:
            deduped.append(candidate)
    return deduped


def resolve_repo_dir(repo_dir: str | Path | None = None) -> Path:
    candidate = Path(repo_dir or os.environ.get("FENIFY_REPO_DIR") or DEFAULT_REPO_DIR)
    candidate = candidate.expanduser().resolve()
    if not candidate.exists():
        raise FenifyError(
            f"Fenify repo not found at {candidate}. Clone https://github.com/notnil/fenify there "
            "or pass --fenify-repo / set FENIFY_REPO_DIR."
        )
    if not (candidate / "src" / "board_predictor.py").exists():
        raise FenifyError(f"Fenify repo at {candidate} is missing src/board_predictor.py")
    return candidate


def resolve_model_path(model_path: str | Path | None, repo_dir: Path) -> Path:
    explicit = model_path or os.environ.get("FENIFY_MODEL_PATH")
    if explicit:
        candidate = Path(explicit).expanduser().resolve()
        if not candidate.exists():
            raise FenifyError(f"Fenify model not found at {candidate}")
        return candidate

    for candidate in _candidate_model_paths(repo_dir):
        if candidate.exists():
            return candidate.resolve()

    raise FenifyError(
        "Fenify model not found. Download the CPU release asset "
        f"{DEFAULT_MODEL_NAME} and pass --fenify-model or set FENIFY_MODEL_PATH."
    )


def _import_module(name: str, repo_dir: Path | None = None) -> ModuleType:
    try:
        if repo_dir is None:
            return importlib.import_module(name)
        with _prepend_sys_path(repo_dir):
            return importlib.import_module(name)
    except ModuleNotFoundError as exc:
        raise FenifyError(
            "Fenify dependencies are missing. Install the optional ML dependencies first, "
            "for example with `uv pip install -r requirements-fenify.txt`."
        ) from exc


class FenifyPredictor:
    def __init__(self, model_path: str | Path | None = None, repo_dir: str | Path | None = None) -> None:
        self.repo_dir = resolve_repo_dir(repo_dir)
        self.model_path = resolve_model_path(model_path, self.repo_dir)

        board_predictor_module = _import_module("src.board_predictor", repo_dir=self.repo_dir)
        image_module = _import_module("PIL.Image")
        self._predictor = board_predictor_module.BoardPredictor(str(self.model_path))
        self._image_open = image_module.open

    def predict(self, image_path: str | Path, marker: str) -> FenifyPrediction:
        path = Path(image_path)
        turn = _turn_from_marker(marker)
        image = self._image_open(path)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                prediction = self._predictor.predict(image)
        finally:
            close = getattr(image, "close", None)
            if callable(close):
                close()

        board = prediction.board.copy(stack=False)
        board.turn = turn
        board.castling_rights = chess.BB_EMPTY
        board.ep_square = None
        board.halfmove_clock = 0
        board.fullmove_number = 1
        return FenifyPrediction(board_fen=board.board_fen(), fen=board.fen())
