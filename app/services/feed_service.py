"""
TuneFeed — Feed ranking service.

`get_feed_beats` is the single public entry point.  It applies a scoring
function to every non-excluded beat and returns the top N sorted results.
The algorithm weights engagement rate, freshness, personalisation, and
a small random noise component so the ordering shifts slightly on each request.
"""

import math
import random
from datetime import datetime

from app.models import Beat


def _get_user_context(user):
    """Return (liked_genres, followed_producer_ids) for personalisation."""
    liked_genres, followed_ids = set(), set()
    if user.is_authenticated:
        from app.models import Like
        rows = (Beat.query
                .with_entities(Beat.genre)
                .join(Like, Like.beat_id == Beat.id)
                .filter(Like.user_id == user.id, Beat.genre.isnot(None))
                .all())
        liked_genres = {row[0].lower() for row in rows}
        followed_ids = {u.id for u in user.following.all()}
    return liked_genres, followed_ids


def _score_beat(beat, liked_genres, followed_ids, now):
    """Return a personalized ranking score for one beat."""
    age_hours = max((now - beat.uploaded_at).total_seconds() / 3600, 0) if beat.uploaded_at else 0
    plays = beat.play_count or 0
    likes = beat.likes_count
    comments = beat.comment_count

    # Normalize interactions by plays so older, high-volume beats do not
    # dominate purely from absolute counts.
    like_rate = likes / plays if plays > 0 else 0
    comment_rate = comments / plays if plays > 0 else 0
    engagement = (
        like_rate * 50
        + comment_rate * 30
        + math.log1p(plays) * 1.5
    )

    # Exponential decay favors recency while still allowing evergreen hits.
    freshness = 15 * math.exp(-age_hours / 48)
    # Small exploration bonus surfaces low-play tracks for discovery.
    cold_start = 10 if plays < 3 else (4 if plays < 15 else 0)

    affinity = 0
    if beat.genre and beat.genre.lower() in liked_genres:
        affinity += 8
    if beat.producer_id in followed_ids:
        affinity += 12

    trending = 6 if beat.is_trending else 0
    # Controlled randomness prevents static ordering between similarly scored beats.
    noise = random.uniform(0, 8)

    return engagement + freshness + cold_start + affinity + trending + noise


def get_feed_beats(user, limit=15, exclude_ids=None):
    """Score and return the top `limit` beats for `user`."""
    exclude_ids = set(exclude_ids or [])
    beats = Beat.query.filter(~Beat.id.in_(exclude_ids)).all() if exclude_ids else Beat.query.all()
    if not beats:
        return []

    liked_genres, followed_ids = _get_user_context(user)
    now = datetime.utcnow()

    scored = sorted(beats, key=lambda beat: _score_beat(beat, liked_genres, followed_ids, now), reverse=True)
    return scored[:limit]
