from chessterfield.settings import _default_csrf_trusted_origins


def test_default_csrf_trusted_origins_cover_local_and_sprite_hosts():
    origins = _default_csrf_trusted_origins(
        ['localhost', '127.0.0.1:8000', '.sprites.app', 'chessterfield.example.com']
    )

    assert origins == [
        'http://localhost',
        'http://127.0.0.1:8000',
        'https://*.sprites.app',
        'https://chessterfield.example.com',
    ]
