PRACTICE_MODES = {
    "classic": {
        "id": "classic",
        "label": "Classic Play",
        "scored": True,
        "content_types": ["position"],
    },
    "streak": {
        "id": "streak",
        "label": "Streak Mode",
        "scored": True,
        "content_types": ["position"],
    },
    "replay": {
        "id": "replay",
        "label": "Replay",
        "scored": False,
        "content_types": ["game"],
    },
}


def eligible_modes_for_position() -> list[str]:
    return ["classic", "streak"]


def eligible_modes_for_game() -> list[str]:
    return ["replay"]

