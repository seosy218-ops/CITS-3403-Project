"""
TuneFeed — AJAX API
All endpoints return JSON. Used by the feed and other interactive elements.
"""

import random
from datetime import datetime, timedelta
from uuid import uuid4

from flask import Blueprint, jsonify, request, session
from flask_login import current_user

from app.models import db, Beat, User, Comment, BeatPlayEvent, CommentReport
from app.services.feed_service import get_feed_beats

api = Blueprint('api', __name__)

# Minimum seconds between play events from the same actor.
# Prevents double-click inflation while still allowing real replays.
PLAY_DEDUPE_SECONDS = 8


# ---------------------------------------------------------------------------
# Feed endpoint (AJAX infinite scroll)
# ---------------------------------------------------------------------------

@api.route('/feed')
def feed():
    page = request.args.get('page', 1, type=int)
    per_page = 10
    # Client sends comma-separated IDs it has already rendered; algorithm excludes them
    exclude_raw = request.args.get('seen', '')
    exclude_ids = [int(x) for x in exclude_raw.split(',') if x.strip().isdigit()]

    # Fetch one extra page-worth so we can determine `has_next` without a separate COUNT query
    beats = get_feed_beats(current_user, limit=page * per_page + per_page, exclude_ids=exclude_ids)
    page_beats = beats[(page - 1) * per_page: page * per_page]

    result = []
    for b in page_beats:
        producer = b.producer
        result.append({
            'id':                  b.id,
            'title':               b.title,
            'genre':               b.genre or '',
            'bpm':                 b.bpm,
            'key':                 b.key or '',
            'mood_tag':            b.mood_tag or '',
            'duration':            b.duration or '3:00',
            'price':               b.price,
            'premium_price':       b.premium_price,
            'exclusive_price':     b.exclusive_price,
            'licence_type':        b.licence_type or '',
            'play_count':          b.play_count,
            'likes_count':         b.likes_count,
            'comment_count':       b.comment_count,
            'producer_id':         b.producer_id,
            'producer_username':   producer.username if producer else 'Unknown',
            'producer_avatar':     producer.avatar_url if producer else '',
            'audio_url':           b.audio_url or '',
            'is_liked':            current_user.has_liked(b) if current_user.is_authenticated else False,
            'is_saved':            current_user.has_saved(b) if current_user.is_authenticated else False,
            'is_following':        (current_user.is_following(producer)
                                    if current_user.is_authenticated and producer else False),
            'is_trending':         b.is_trending,
        })

    return jsonify({'beats': result, 'has_next': len(beats) > page * per_page, 'page': page})


# ---------------------------------------------------------------------------
# Beat interactions
# ---------------------------------------------------------------------------

@api.route('/beats/<int:beat_id>/save', methods=['POST'])
def toggle_save(beat_id):
    """Toggle the saved/bookmark state for `beat_id`. Returns {'saved': bool}."""
    if not current_user.is_authenticated:
        return jsonify({'error': 'Authentication required'}), 401
    beat = Beat.query.get_or_404(beat_id)
    if current_user.has_saved(beat):
        current_user.unsave_beat(beat)
        saved = False
    else:
        current_user.save_beat(beat)
        saved = True
    db.session.commit()
    return jsonify({'saved': saved})


@api.route('/beats/<int:beat_id>/like', methods=['POST'])
def toggle_like(beat_id):
    """Toggle the like state for `beat_id`. Returns {'liked': bool, 'likes_count': int}."""
    if not current_user.is_authenticated:
        return jsonify({'error': 'Authentication required'}), 401
    beat = Beat.query.get_or_404(beat_id)
    if current_user.has_liked(beat):
        current_user.unlike_beat(beat)
        liked = False
    else:
        current_user.like_beat(beat)
        liked = True
    db.session.commit()
    return jsonify({'liked': liked, 'likes_count': beat.likes_count})


@api.route('/beats/<int:beat_id>/play', methods=['POST'])
def record_play(beat_id):
    """Increment play count with per-user/session deduplication window."""
    beat = Beat.query.get_or_404(beat_id)

    # Resolve actor: logged-in user ID, or a session-scoped anonymous key
    user_id = current_user.id if current_user.is_authenticated else None
    session_key = None
    if not user_id:
        session_key = session.get('play_session_id')
        if not session_key:
            # Generate a persistent anonymous key stored in the Flask session cookie
            session_key = uuid4().hex
            session['play_session_id'] = session_key

    # Only count if no play event exists for this actor within the deduplication window
    window_start = datetime.utcnow() - timedelta(seconds=PLAY_DEDUPE_SECONDS)
    q = BeatPlayEvent.query.filter(
        BeatPlayEvent.beat_id == beat.id,
        BeatPlayEvent.created_at >= window_start,
    )
    q = q.filter_by(user_id=user_id) if user_id else q.filter_by(session_key=session_key)
    counted = q.first() is None

    if counted:
        beat.play_count += 1
        db.session.add(BeatPlayEvent(beat_id=beat.id, user_id=user_id, session_key=session_key))
        db.session.commit()

    return jsonify({'play_count': beat.play_count, 'counted': counted})


# ---------------------------------------------------------------------------
# Follow
# ---------------------------------------------------------------------------

@api.route('/producers/<int:producer_id>/follow', methods=['POST'])
def toggle_follow(producer_id):
    """Toggle follow state for `producer_id`. Returns {'following': bool, 'followers_count': int}."""
    if not current_user.is_authenticated:
        return jsonify({'error': 'Authentication required'}), 401
    producer = User.query.get_or_404(producer_id)
    if producer.id == current_user.id:
        return jsonify({'error': 'Cannot follow yourself'}), 400
    if current_user.is_following(producer):
        current_user.unfollow(producer)
        following = False
    else:
        current_user.follow(producer)
        following = True
    db.session.commit()
    return jsonify({'following': following, 'followers_count': producer.followers.count()})


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

def _serialize_comment(comment):
    author = comment.author
    name   = author.username if author else 'Deleted User'
    avatar = author.avatar_url if (author and author.avatar_url) else ''

    is_liked    = False
    is_disliked = False
    is_reported = False
    can_delete  = False
    if current_user.is_authenticated:
        is_liked    = current_user.has_liked_comment(comment)
        is_disliked = current_user.has_disliked_comment(comment)
        is_reported = current_user.has_reported_comment(comment)
        can_delete  = current_user.id == comment.author_id  # only the author can delete

    # Resolve the username being replied to (for the "↩ @username" display)
    reply_to = comment.parent.author.username if (comment.parent and comment.parent.author) else None

    # Only load replies for top-level comments; nested replies are not recursed further
    replies = comment.replies.order_by(Comment.created_at.asc()).all() if comment.parent_id is None else []

    return {
        'id':             comment.id,
        'body':           comment.body,
        'author_id':      comment.author_id,
        'author_username': name,
        'author_avatar':  avatar,
        'created_at':     comment.created_at.isoformat() if comment.created_at else None,
        'likes_count':    comment.likes_count,
        'dislikes_count': comment.dislikes_count,
        'is_liked':       is_liked,
        'is_disliked':    is_disliked,
        'is_reported':    is_reported,
        'can_delete':     can_delete,
        'parent_id':      comment.parent_id,
        'reply_to':       reply_to,
        'replies':        [_serialize_comment(r) for r in replies],
    }


@api.route('/beats/<int:beat_id>/comments', methods=['GET'])
def get_comments(beat_id):
    Beat.query.get_or_404(beat_id)
    limit = min(request.args.get('limit', 20, type=int), 100)  # cap at 100 to prevent abuse
    now = datetime.utcnow()

    # Only fetch top-level comments; replies are loaded as nested children
    raw = Comment.query.filter_by(beat_id=beat_id, parent_id=None).all()

    # Engagement-first ranking with freshness decay and bounded randomness.
    # Prevents older comments from locking in permanently.
    def comment_score(c):
        age_h = max((now - c.created_at).total_seconds() / 3600, 0) if c.created_at else 0
        return (
            c.likes_count * 2.4                             # likes are the primary signal
            + 6.0 / (1.0 + age_h / 3.0)                    # decaying freshness boost (half-life ~3h)
            + (1.2 if age_h < 2 else 0)                     # extra bump for very new comments
            + random.uniform(0, 2.0 if age_h < 12 else 0.45)  # wider noise window for recent comments
        )

    scored = sorted(raw, key=comment_score, reverse=True)[:limit]
    return jsonify({'comments': [_serialize_comment(c) for c in scored]})


@api.route('/beats/<int:beat_id>/comments', methods=['POST'])
def post_comment(beat_id):
    if not current_user.is_authenticated:
        return jsonify({'error': 'Authentication required'}), 401
    beat = Beat.query.get_or_404(beat_id)
    data      = request.get_json() or {}
    body      = data.get('body', '').strip()
    parent_id = data.get('parent_id')

    if not body:
        return jsonify({'error': 'Comment cannot be empty'}), 400
    if len(body) > 500:
        return jsonify({'error': 'Comment too long (max 500 chars)'}), 400

    parent = None
    if parent_id is not None:
        parent = Comment.query.get_or_404(int(parent_id))
        # Guard against cross-beat replies from crafted API calls.
        if parent.beat_id != beat.id:
            return jsonify({'error': 'Parent comment not on this beat'}), 400

    comment = Comment(beat_id=beat_id, author_id=current_user.id, body=body,
                      parent_id=parent.id if parent else None)
    db.session.add(comment)
    db.session.commit()
    return jsonify(_serialize_comment(comment)), 201


@api.route('/comments/<int:comment_id>/like', methods=['POST'])
def toggle_comment_like(comment_id):
    """Toggle like on a comment. Removes any dislike first (mutually exclusive)."""
    if not current_user.is_authenticated:
        return jsonify({'error': 'Authentication required'}), 401
    comment = Comment.query.get_or_404(comment_id)
    if current_user.has_liked_comment(comment):
        current_user.unlike_comment(comment)
        liked = False
    else:
        current_user.like_comment(comment)
        liked = True
    db.session.commit()
    return jsonify({'liked': liked, 'likes_count': comment.likes_count,
                    'dislikes_count': comment.dislikes_count})


@api.route('/comments/<int:comment_id>/dislike', methods=['POST'])
def toggle_comment_dislike(comment_id):
    """Toggle dislike on a comment. Removes any like first (mutually exclusive). Client hides the comment on dislike."""
    if not current_user.is_authenticated:
        return jsonify({'error': 'Authentication required'}), 401
    comment = Comment.query.get_or_404(comment_id)
    if current_user.has_disliked_comment(comment):
        current_user.undislike_comment(comment)
        disliked = False
    else:
        current_user.dislike_comment(comment)
        disliked = True
    db.session.commit()
    return jsonify({'disliked': disliked, 'dislikes_count': comment.dislikes_count,
                    'likes_count': comment.likes_count})


@api.route('/comments/<int:comment_id>/report', methods=['POST'])
def report_comment(comment_id):
    if not current_user.is_authenticated:
        return jsonify({'error': 'Authentication required'}), 401
    comment = Comment.query.get_or_404(comment_id)

    # Prevent duplicate reports from the same user
    existing = CommentReport.query.filter_by(
        comment_id=comment_id, user_id=current_user.id
    ).first()
    if existing:
        return jsonify({'error': 'Already reported'}), 409

    data   = request.get_json() or {}
    reason = data.get('reason', 'inappropriate')[:64]

    report = CommentReport(comment_id=comment_id, user_id=current_user.id, reason=reason)
    comment.report_count += 1
    db.session.add(report)
    db.session.commit()
    return jsonify({'reported': True, 'report_count': comment.report_count})


@api.route('/comments/<int:comment_id>/report', methods=['DELETE'])
def unreport_comment(comment_id):
    """Undo a previous report by the current user. Decrements the comment's report count."""
    if not current_user.is_authenticated:
        return jsonify({'error': 'Authentication required'}), 401
    report = CommentReport.query.filter_by(
        comment_id=comment_id, user_id=current_user.id
    ).first()
    if not report:
        return jsonify({'error': 'Report not found'}), 404
    comment = Comment.query.get_or_404(comment_id)
    comment.report_count = max(0, comment.report_count - 1)
    db.session.delete(report)
    db.session.commit()
    return jsonify({'reported': False})


@api.route('/comments/<int:comment_id>', methods=['DELETE'])
def delete_comment(comment_id):
    """Permanently delete a comment. Only the comment's author is allowed."""
    if not current_user.is_authenticated:
        return jsonify({'error': 'Authentication required'}), 401
    comment = Comment.query.get_or_404(comment_id)
    if comment.author_id != current_user.id:
        return jsonify({'error': 'Forbidden'}), 403
    db.session.delete(comment)
    db.session.commit()
    return jsonify({'deleted': True})
