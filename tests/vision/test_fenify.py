from __future__ import annotations

from pathlib import Path

import chess
import pytest

from vision.fenify import FenifyError, _turn_from_marker, resolve_model_path, resolve_repo_dir


def test_turn_from_marker_maps_white_and_black() -> None:
    assert _turn_from_marker("white") == chess.WHITE
    assert _turn_from_marker("black") == chess.BLACK


def test_turn_from_marker_rejects_unknown_value() -> None:
    with pytest.raises(FenifyError):
        _turn_from_marker("unknown")


def test_resolve_repo_dir_accepts_checkout(tmp_path: Path) -> None:
    repo_dir = tmp_path / "fenify"
    (repo_dir / "src").mkdir(parents=True)
    (repo_dir / "src" / "board_predictor.py").write_text("class BoardPredictor: pass\n")

    assert resolve_repo_dir(repo_dir) == repo_dir.resolve()


def test_resolve_model_path_finds_default_cpu_asset(tmp_path: Path) -> None:
    repo_dir = tmp_path / "fenify"
    (repo_dir / "src").mkdir(parents=True)
    (repo_dir / "src" / "board_predictor.py").write_text("class BoardPredictor: pass\n")
    model_path = repo_dir / "models_2023-07-10-chessboard-2D-balanced-fen-cpu.pt"
    model_path.write_text("stub\n")

    assert resolve_model_path(None, repo_dir) == model_path.resolve()
