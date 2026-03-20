import json
from datetime import datetime, timezone

import chess
import requests
from django.core.management.base import BaseCommand, CommandError

from positions.models import Position, Tag


class Command(BaseCommand):
    help = "Import games from Lichess and store each position"

    def add_arguments(self, parser):
        parser.add_argument("--username", default="sebbacon", help="Lichess username")
        parser.add_argument("--max-games", type=int, default=None, dest="max_games")

    def handle(self, *args, **options):
        username = options["username"]
        max_games = options["max_games"]

        url = f"https://lichess.org/api/games/user/{username}"
        params = {"format": "ndjson", "moves": "true"}
        headers = {"Accept": "application/x-ndjson"}

        resp = requests.get(url, params=params, headers=headers, stream=True)

        if resp.status_code == 429:
            raise CommandError("Rate limited by Lichess. Try again later.")
        if not resp.ok:
            raise CommandError(f"HTTP error {resp.status_code} from Lichess.")

        games_processed = created = skipped = 0

        for line in resp.iter_lines():
            if not line:
                continue
            if max_games is not None and games_processed >= max_games:
                break
            try:
                game = json.loads(line)
            except (json.JSONDecodeError, ValueError) as exc:
                self.stderr.write(f"Skipping malformed game: {exc}")
                continue

            c, s = self._import_game(game, username)
            created += c
            skipped += s
            games_processed += 1

        self.stdout.write(
            f"Done: {games_processed} games, {created} positions created, {skipped} skipped."
        )

    def _import_game(self, game, username):
        game_id = game.get("id", "unknown")
        moves_str = game.get("moves", "")
        created_at_ms = game.get("createdAt", 0)
        date = datetime.fromtimestamp(created_at_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")

        players = game.get("players", {})
        white_name = players.get("white", {}).get("user", {}).get("name", "")
        if white_name.lower() == username.lower():
            color = "white"
            opponent = players.get("black", {}).get("user", {}).get("name", "unknown")
        else:
            color = "black"
            opponent = players.get("white", {}).get("user", {}).get("name", "unknown")

        lichess_tag, _ = Tag.objects.get_or_create(name="lichess")
        color_tag, _ = Tag.objects.get_or_create(name=color)

        board = chess.Board()
        plies = [(0, board.fen())]

        for move_str in (moves_str.split() if moves_str else []):
            try:
                board.push_uci(move_str)
            except (chess.InvalidMoveError, chess.IllegalMoveError, ValueError):
                try:
                    board.push_san(move_str)
                except Exception:
                    self.stderr.write(f"Bad move '{move_str}' in game {game_id}, stopping.")
                    break
            plies.append((len(plies), board.fen()))

        created = skipped = 0
        existing_sources = set(
            Position.objects.filter(
                source__startswith=f"lichess:{game_id}:"
            ).values_list("source", flat=True)
        )

        for ply, fen in plies:
            source = f"lichess:{game_id}:{ply}"
            if source in existing_sources:
                skipped += 1
                continue
            pos = Position.objects.create(
                name=f"vs {opponent} ({date}) ply {ply}",
                fen=fen,
                notes="",
                source=source,
            )
            pos.tags.add(lichess_tag, color_tag)
            created += 1

        return created, skipped
