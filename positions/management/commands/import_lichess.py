import json

import requests
from django.core.management.base import BaseCommand, CommandError

from positions.lichess import build_plies, lichess_context, lichess_date, sync_game_summary
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
        played_at = lichess_date(game)
        date = played_at.strftime("%Y-%m-%d")
        color, opponent = lichess_context(game, username)
        players = game.get("players", {})
        black_name = players.get("black", {}).get("user", {}).get("name", "")
        white_name = players.get("white", {}).get("user", {}).get("name", "")
        if white_name.lower() != username.lower() and black_name.lower() != username.lower():
            self.stderr.write(f"Warning: username '{username}' not found in game {game_id} players, assuming black.")

        lichess_tag, _ = Tag.objects.get_or_create(name="lichess")
        color_tag, _ = Tag.objects.get_or_create(name=color)
        plies = build_plies(game, self.stderr.write)
        sync_game_summary(game, username, plies[-1][1])

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
