import os
import random
from secrets import token_hex
from urllib.parse import quote
from werkzeug.utils import secure_filename

from flask import Blueprint, render_template, redirect, url_for, flash, request, current_app
from flask_login import login_user, logout_user, login_required, current_user
from app.forms import SignupForm, LoginForm, UploadBeatForm, SearchForm, EditProfileForm
from app.models import db, User, Beat
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
    if file.tell() > MAX_UPLOAD_SIZE:
        file.seek(0)  # Reset for potential re-used file object
        return None
    file.seek(0)  # Reset
    
    file.save(filepath)
    return f'/static/uploads/profiles/{filename}'


@main.route('/')
def index():
    return redirect(url_for('main.discover'))


@main.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('main.feed'))
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user and user.check_password(form.password.data):
            login_user(user)
            flash('Logged in successfully.', 'success')
            next_page = request.args.get('next')
            return redirect(next_page or url_for('main.feed'))
        flash('Invalid email or password.', 'danger')
    return render_template('auth/login.html', form=form)


@main.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('main.feed'))
    form = SignupForm()
    if form.validate_on_submit():
        if User.query.filter_by(username=form.username.data).first():
            flash('Username already taken.', 'danger')
            return render_template('auth/register.html', form=form)
        if User.query.filter_by(email=form.email.data).first():
            flash('Email already registered.', 'danger')
            return render_template('auth/register.html', form=form)
        avatar_url = _random_avataaars_avatar_url()
        user = User(username=form.username.data, email=form.email.data, avatar_url=avatar_url)
        user.set_password(form.password.data)
        db.session.add(user)
        db.session.commit()
        flash('Account created. Welcome to TuneFeed!', 'success')
        return redirect(url_for('main.login'))
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
    is_following_map = {}
    if current_user.is_authenticated:
        is_liked_map = {b.id: current_user.has_liked(b) for b in beats}
        seen_producers = {}
        for b in beats:
            pid = b.producer_id
            # Cache producer rows so repeated beats by the same producer do not
            # trigger duplicate queries while building follow-state for the view.
            if pid not in seen_producers:
                seen_producers[pid] = User.query.get(pid)
            p = seen_producers[pid]
            if p and pid not in is_following_map:
                is_following_map[pid] = current_user.is_following(p)

    return render_template('main/feed.html',
                           beats=beats,
                           is_liked_map=is_liked_map,
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

    # Aggregate stats computed once here so the template doesn't trigger N+1 queries
    all_beats = user.beats.all()
    total_plays = sum(b.play_count for b in all_beats)
    total_likes = sum(b.likes_count for b in all_beats)
    followers_count = user.followers.count()
    following_count = user.following.count()

    return render_template('main/profile.html',
                           user=user,
                           beats=beats,
                           is_following=is_following,
                           total_plays=total_plays,
                           total_likes=total_likes,
                           followers_count=followers_count,
                           following_count=following_count)


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
    return redirect(request.referrer or url_for('main.feed'))


@main.route('/search', methods=['GET', 'POST'])
def search():
    form = SearchForm()
    beats, producers = [], []
    query       = request.args.get('q', '')
    search_type = request.args.get('type', 'all')
    genre_filter = request.args.get('genre', '')

    if form.validate_on_submit() or query:
        query        = form.query.data or query
        search_type  = form.search_type.data or search_type
        genre_filter = form.genre.data or genre_filter

        if search_type in ['all', 'beats']:
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

        if search_type in ['all', 'producers']:
            pq = User.query
            if query:
                pq = pq.filter(
                    User.username.ilike(f'%{query}%') |
                    User.bio.ilike(f'%{query}%')
                )
            producers = pq.all()

    return render_template('main/search.html', form=form, beats=beats, producers=producers,
                           query=query, search_type=search_type, genre_filter=genre_filter)
