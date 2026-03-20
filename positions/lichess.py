from datetime import datetime, timezone

import chess

from positions.models import Game


DRAW_STATUSES = {
    'draw',
    'stalemate',
    'repetition',
    'timevsinsufficient',
    'insufficient',
    '50moves',
    'variantend',
}


def lichess_date(game):
    return datetime.fromtimestamp(game.get('createdAt', 0) / 1000, tz=timezone.utc)


def lichess_context(game, username):
    players = game.get('players', {})
    white_name = players.get('white', {}).get('user', {}).get('name', '')
    if white_name.lower() == username.lower():
        return 'white', players.get('black', {}).get('user', {}).get('name', 'unknown')

    black_name = players.get('black', {}).get('user', {}).get('name', '')
    if black_name.lower() == username.lower():
        return 'black', players.get('white', {}).get('user', {}).get('name', 'unknown')

    return 'black', players.get('white', {}).get('user', {}).get('name', 'unknown')


def lichess_game_name(opponent, played_at):
    return f"vs {opponent} ({played_at.strftime('%Y-%m-%d')})"


def lichess_winner(game):
    winner = (game.get('winner') or '').lower()
    if winner in {'white', 'black'}:
        return winner

    status = (game.get('status') or '').lower()
    if status in DRAW_STATUSES:
        return 'draw'

    return ''


def build_plies(game, on_bad_move=None):
    game_id = game.get('id', 'unknown')
    moves_str = game.get('moves', '')
    board = chess.Board()
    plies = [(0, board.fen())]

    for move_str in (moves_str.split() if moves_str else []):
        try:
            board.push_uci(move_str)
        except (chess.InvalidMoveError, chess.IllegalMoveError, ValueError):
            try:
                board.push_san(move_str)
            except Exception:
                if on_bad_move is not None:
                    on_bad_move(f"Bad move '{move_str}' in game {game_id}, stopping.")
                break
        plies.append((len(plies), board.fen()))

    return plies


def sync_game_summary(game, username, final_fen):
    game_id = game.get('id', 'unknown')
    played_at = lichess_date(game)
    color, opponent = lichess_context(game, username)
    return Game.objects.update_or_create(
        source=f'lichess:{game_id}',
        defaults={
            'name': lichess_game_name(opponent, played_at),
            'opponent': opponent,
            'played_at': played_at,
            'final_fen': final_fen,
            'user_color': color,
            'winner': lichess_winner(game),
            'status': (game.get('status') or '')[:30],
        },
    )
