import pytest
from django.db import IntegrityError
from positions.models import Position, Tag

@pytest.mark.django_db
def test_create_tag():
    tag = Tag.objects.create(name='sicilian')
    assert tag.name == 'sicilian'
    assert str(tag) == 'sicilian'

@pytest.mark.django_db
def test_create_position():
    pos = Position.objects.create(
        name='Sicilian Najdorf',
        fen='rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6',
        notes='Key middlegame position',
    )
    assert pos.name == 'Sicilian Najdorf'
    assert pos.tags.count() == 0
    assert str(pos) == 'Sicilian Najdorf'

@pytest.mark.django_db
def test_position_tags_many_to_many():
    tag1 = Tag.objects.create(name='sicilian')
    tag2 = Tag.objects.create(name='opening')
    pos = Position.objects.create(
        name='Najdorf',
        fen='rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6',
    )
    pos.tags.add(tag1, tag2)
    assert pos.tags.count() == 2
    assert set(pos.tags.values_list('name', flat=True)) == {'sicilian', 'opening'}

@pytest.mark.django_db
def test_tag_uniqueness():
    Tag.objects.create(name='endgame')
    with pytest.raises(IntegrityError):
        Tag.objects.create(name='endgame')

@pytest.mark.django_db
def test_position_ordered_newest_first():
    pos1 = Position.objects.create(name='First', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    pos2 = Position.objects.create(name='Second', fen='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')
    qs = list(Position.objects.all())
    assert qs[0] == pos2  # newest first
    assert qs[1] == pos1

@pytest.mark.django_db
def test_position_source_nullable():
    pos = Position.objects.create(
        name='Test', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    )
    assert pos.source is None

@pytest.mark.django_db
def test_position_source_unique():
    Position.objects.create(
        name='A', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        source='lichess:abc123:0'
    )
    with pytest.raises(IntegrityError):
        Position.objects.create(
            name='B', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            source='lichess:abc123:0'
        )

@pytest.mark.django_db
def test_position_source_multiple_null_allowed():
    """Multiple positions with source=None must be allowed (unique only applies to non-null)."""
    Position.objects.create(name='A', fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    Position.objects.create(name='B', fen='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')
    assert Position.objects.filter(source__isnull=True).count() == 2
