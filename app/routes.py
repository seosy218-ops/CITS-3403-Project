import logging
import os
from secrets import token_hex
from urllib.parse import quote, urlsplit
from werkzeug.utils import secure_filename

logger = logging.getLogger(__name__)

from flask import Blueprint, render_template, redirect, url_for, flash, request, current_app
from flask_login import login_user, logout_user, login_required, current_user
from sqlalchemy.exc import IntegrityError
from app import limiter
from app.forms import SignupForm, LoginForm, UploadBeatForm, EditProfileForm
from app.models import db, User, Beat, Like, saved_beats, follows
from app.services.feed_service import get_feed_beats

main = Blueprint('main', __name__)


# Avatar generation — avataaars style only for consistent profile aesthetic
# Single background color that complements the dark theme and orange accent
AVATAR_BG_COLOR = '1a1f3a'  # Deep indigo — sophisticated, matches website aesthetic

ALLOWED_UPLOAD_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MAX_UPLOAD_SIZE_MB = 5
MAX_UPLOAD_SIZE = MAX_UPLOAD_SIZE_MB * 1024 * 1024  # 5 MB


def _random_avataaars_avatar_url():
    """Generate a randomized avataaars avatar URL with consistent background color."""
    seed = quote(token_hex(12))
    return f'https://api.dicebear.com/9.x/avataaars/svg?seed={seed}&backgroundColor={AVATAR_BG_COLOR}'


def _allowed_file(filename):
    """Check if uploaded file has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_UPLOAD_EXTENSIONS


def _save_user_upload(file, user_id):
    """Save uploaded profile picture and return the relative path.
    
    Returns: relative path to saved file, or None if save failed
    """
    if not file or file.filename == '':
        return None
    
    if not _allowed_file(file.filename):
        return None
    
    # Ensure uploads directory exists
    upload_dir = os.path.join(current_app.root_path, 'static', 'uploads', 'profiles')
    os.makedirs(upload_dir, exist_ok=True)
    
    # Generate unique filename with user_id and timestamp
    ext = secure_filename(file.filename).rsplit('.', 1)[1].lower()
    filename = f'user_{user_id}_{token_hex(8)}.{ext}'
    filepath = os.path.join(upload_dir, filename)
    
    # Read size from the stream, then reset so save() starts from byte 0.
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size == 0 or size > MAX_UPLOAD_SIZE:
        return None
    
    file.save(filepath)
    return f'/static/uploads/profiles/{filename}'


@main.route('/')
def index():
    return redirect(url_for('main.feed'))


@main.route('/login', methods=['GET', 'POST'])
@limiter.limit('20 per minute')
def login():
    if current_user.is_authenticated:
        return redirect(url_for('main.feed'))
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user and user.check_password(form.password.data):
            login_user(user, remember=form.remember.data)
            flash('Logged in successfully.', 'success')
            next_page = request.args.get('next', '')
            # Guard against open-redirect: only allow relative URLs (no scheme or netloc)
            if next_page and urlsplit(next_page).netloc:
                next_page = ''
            return redirect(next_page or url_for('main.feed'))
        logger.warning('Failed login attempt for email: %s', form.email.data)
        flash('Invalid email or password.', 'danger')
    return render_template('auth/login.html', form=form)


@main.route('/register', methods=['GET', 'POST'])
@limiter.limit('10 per hour')
def register():
    if current_user.is_authenticated:
        return redirect(url_for('main.feed'))
    form = SignupForm()
    if form.validate_on_submit():
        username = form.username.data.strip()
        email = form.email.data.strip().lower()
        if User.query.filter_by(username=username).first():
            flash('Username already taken.', 'danger')
            return render_template('auth/register.html', form=form)
        if User.query.filter_by(email=email).first():
            flash('Email already registered.', 'danger')
            return render_template('auth/register.html', form=form)
        user = User(
            username=username,
            email=email,
            avatar_url=_random_avataaars_avatar_url(),
        )
        user.set_password(form.password.data)
        db.session.add(user)
        try:
            db.session.commit()
        except IntegrityError:
            # Race: another request claimed the same username/email between
            # the lookup above and this commit. Fall back to a friendly message.
            db.session.rollback()
            flash('Username or email already registered.', 'danger')
            return render_template('auth/register.html', form=form)
        flash('Account created. Welcome to TuneFeed!', 'success')
        return redirect(url_for('main.login'))
    if form.errors:
        # Surface server-side validation errors (password rules, username pattern, etc.)
        # so the user sees why submission was rejected when JS validation is bypassed.
        for field_name, errors in form.errors.items():
            for error in errors:
                flash(error, 'danger')
    return render_template('auth/register.html', form=form)


@main.route('/logout')
@login_required
def logout():
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('main.login'))


@main.route('/discover')
def discover():
    # Genre filter from query string
    selected_genre = request.args.get('genre', '')

    # Trending beats (top by play count), optionally filtered by genre
    trending_q = Beat.query.filter(Beat.play_count > 0)
    if selected_genre:
        trending_q = trending_q.filter(Beat.genre.ilike(f'%{selected_genre}%'))
    trending_beats = trending_q.order_by(Beat.play_count.desc()).limit(10).all()

    # New drops — most recently uploaded
    new_beats = Beat.query.order_by(Beat.uploaded_at.desc()).limit(8).all()

    # Top producers — ordered by total play count of their beats
    producers = (User.query
                 .join(Beat, Beat.producer_id == User.id)
                 .group_by(User.id)
                 .order_by(db.func.sum(Beat.play_count).desc())
                 .limit(8).all())

    # All distinct genres for the filter pills
    genre_rows = db.session.query(Beat.genre).filter(Beat.genre.isnot(None)).distinct().all()
    genres = sorted({r[0] for r in genre_rows if r[0]})

    return render_template('main/discover.html',
                           trending_beats=trending_beats,
                           new_beats=new_beats,
                           producers=producers,
                           genres=genres,
                           selected_genre=selected_genre)


@main.route('/feed')
def feed():
    # Service-layer ranking blends engagement, freshness, and user affinity.
    beats = get_feed_beats(current_user, limit=15)

    is_liked_map     = {}
    is_saved_map     = {}
    is_following_map = {}
    if current_user.is_authenticated:
        beat_ids = [b.id for b in beats]
        # Batch-load liked and saved states in two queries instead of 2*N
        liked_ids = {
            row[0] for row in
            db.session.query(Like.beat_id)
            .filter(Like.user_id == current_user.id, Like.beat_id.in_(beat_ids))
            .all()
        }
        saved_ids = {
            row[0] for row in
            db.session.query(saved_beats.c.beat_id)
            .filter(saved_beats.c.user_id == current_user.id,
                    saved_beats.c.beat_id.in_(beat_ids))
            .all()
        }
        is_liked_map = {bid: bid in liked_ids for bid in beat_ids}
        is_saved_map = {bid: bid in saved_ids for bid in beat_ids}

        # Batch-load follow state for unique producers on this page
        producer_ids = list({b.producer_id for b in beats if b.producer_id})
        following_ids = {
            row[0] for row in
            db.session.query(follows.c.followed_id)
            .filter(follows.c.follower_id == current_user.id,
                    follows.c.followed_id.in_(producer_ids))
            .all()
        }
        is_following_map = {pid: pid in following_ids for pid in producer_ids}

    return render_template('main/feed.html',
                           beats=beats,
                           is_liked_map=is_liked_map,
                           is_saved_map=is_saved_map,
                           is_following_map=is_following_map)


@main.route('/upload', methods=['GET', 'POST'])
@login_required
def upload():
    form = UploadBeatForm()
    if form.validate_on_submit():
        beat = Beat(
            title=form.title.data,
            genre=form.genre.data,
            bpm=form.bpm.data,
            key=form.key.data,
            mood_tag=form.mood_tag.data,
            licence_type=form.licence_type.data,
            price=form.price.data,
            premium_price=form.premium_price.data or None,
            exclusive_price=form.exclusive_price.data or None,
            audio_url=form.audio_url.data,
            cover_url=form.cover_url.data,
            producer_id=current_user.id,
        )
        db.session.add(beat)
        # Promote the user to 'producer' the first time they upload, so the
        # role accurately reflects their activity on the platform.
        if current_user.role != 'producer':
            current_user.role = 'producer'
        db.session.commit()
        flash('Beat uploaded successfully!', 'success')
        return redirect(url_for('main.feed'))
    return render_template('main/upload.html', form=form)


@main.route('/profile/<int:user_id>')
def profile(user_id):
    user = User.query.get_or_404(user_id)
    page = request.args.get('page', 1, type=int)
    beats = user.beats.order_by(Beat.uploaded_at.desc()).paginate(page=page, per_page=12)
    is_following = current_user.is_following(user) if current_user.is_authenticated else False

    # Aggregate stats via SQL to avoid N+1 per-beat count queries
    total_plays = (db.session.query(db.func.coalesce(db.func.sum(Beat.play_count), 0))
                   .filter(Beat.producer_id == user.id).scalar())
    total_likes = (db.session.query(db.func.count(Like.id))
                   .join(Beat, Beat.id == Like.beat_id)
                   .filter(Beat.producer_id == user.id).scalar())
    followers_count = user.followers.count()
    following_count = user.following.count()

    # Saved beats — only shown on the user's own profile page
    saved_beats_page = None
    if current_user.is_authenticated and current_user.id == user.id:
        saved_pg = request.args.get('saved_page', 1, type=int)
        saved_beats_page = current_user.saved.order_by(Beat.uploaded_at.desc()).paginate(
            page=saved_pg, per_page=12
        )

    return render_template('main/profile.html',
                           user=user,
                           beats=beats,
                           is_following=is_following,
                           total_plays=total_plays,
                           total_likes=total_likes,
                           followers_count=followers_count,
                           following_count=following_count,
                           saved_beats_page=saved_beats_page)


@main.route('/profile/edit', methods=['GET', 'POST'])
@login_required
def edit_profile():
    form = EditProfileForm()

    # This endpoint multiplexes three POST actions: avatar randomize,
    # picture upload, and bio update. `action` routes to the right branch.

    # Handle randomize avatar action
    if request.method == 'POST' and request.form.get('action') == 'randomize_avatar':
        current_user.avatar_url = _random_avataaars_avatar_url()
        db.session.commit()
        flash('Avatar randomized.', 'success')
        return redirect(url_for('main.edit_profile'))

    # Handle profile picture upload
    if request.method == 'POST' and request.form.get('action') == 'upload_picture':
        if 'profile_picture' in request.files:
            file = request.files['profile_picture']
            if file and file.filename and _allowed_file(file.filename):
                saved_path = _save_user_upload(file, current_user.id)
                if saved_path:
                    current_user.avatar_url = saved_path
                    db.session.commit()
                    flash('Profile picture updated successfully!', 'success')
                    return redirect(url_for('main.edit_profile'))
                else:
                    flash(f'File must be under {MAX_UPLOAD_SIZE_MB}MB.', 'danger')
            else:
                flash('Only PNG, JPG, GIF, and WebP files are allowed.', 'danger')
        else:
            flash('No file selected.', 'danger')
        return redirect(url_for('main.edit_profile'))

    # Handle bio update
    if form.validate_on_submit():
        current_user.bio = (form.bio.data or '').strip() or None
        db.session.commit()
        flash('Profile updated.', 'success')
        return redirect(url_for('main.profile', user_id=current_user.id))

    # Populate form with current data if loading page
    if request.method == 'GET':
        form.bio.data = current_user.bio or ''

    return render_template('main/edit_profile.html', form=form)


@main.route('/beats/<int:beat_id>')
def beat_detail(beat_id):
    beat = Beat.query.get_or_404(beat_id)
    is_liked = current_user.has_liked(beat) if current_user.is_authenticated else False
    is_following = (current_user.is_following(beat.producer)
                    if current_user.is_authenticated and beat.producer else False)
    return render_template('main/beat_detail.html',
                           beat=beat,
                           is_liked=is_liked,
                           is_following=is_following)


@main.route('/follow/<int:user_id>')
@login_required
def follow(user_id):
    user = User.query.get_or_404(user_id)
    if user == current_user:
        flash('You cannot follow yourself.', 'warning')
    elif current_user.is_following(user):
        current_user.unfollow(user)
        db.session.commit()
        flash(f'Unfollowed {user.username}.', 'info')
    else:
        current_user.follow(user)
        db.session.commit()
        flash(f'Now following {user.username}.', 'success')
    referrer = request.referrer or ''
    if referrer and urlsplit(referrer).netloc not in ('', request.host):
        referrer = ''
    return redirect(referrer or url_for('main.feed'))


@main.route('/search')
def search():
    beats, producers = [], []
    query        = request.args.get('q', '').strip()
    search_type  = request.args.get('type', 'all')
    genre_filter = request.args.get('genre', '').strip()

    if query or genre_filter:
        if search_type in ('all', 'beats'):
            bq = Beat.query
            if query:
                bq = bq.filter(
                    Beat.title.ilike(f'%{query}%') |
                    Beat.genre.ilike(f'%{query}%') |
                    Beat.mood_tag.ilike(f'%{query}%')
                )
            if genre_filter:
                bq = bq.filter(Beat.genre.ilike(f'%{genre_filter}%'))
            beats = bq.order_by(Beat.uploaded_at.desc()).all()

        if search_type in ('all', 'producers') and query:
            producers = User.query.filter(
                User.username.ilike(f'%{query}%') |
                User.bio.ilike(f'%{query}%')
            ).all()

    # Batch-load follower counts so the template doesn't fire one query per producer
    follower_counts = {}
    if producers:
        rows = (db.session.query(follows.c.followed_id, db.func.count(follows.c.follower_id))
                .filter(follows.c.followed_id.in_([p.id for p in producers]))
                .group_by(follows.c.followed_id)
                .all())
        follower_counts = {pid: cnt for pid, cnt in rows}

    return render_template('main/search.html', beats=beats, producers=producers,
                           query=query, search_type=search_type, genre_filter=genre_filter,
                           follower_counts=follower_counts)
