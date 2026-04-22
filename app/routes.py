from flask import Blueprint, render_template, redirect, url_for, flash, request, jsonify
from flask_login import login_user, logout_user, login_required, current_user
from app.forms import SignupForm, LoginForm, UploadBeatForm, SearchForm
from app.models import db, User, Beat, Like

main = Blueprint('main', __name__)


@main.route('/')
def index():
    beats = Beat.query.order_by(Beat.play_count.desc()).limit(8).all()
    producers = User.query.filter_by(role='producer').limit(4).all()
    return render_template('main/home.html', beats=beats, producers=producers)


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
            return redirect(url_for('main.feed'))
        else:
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

        user = User(username=form.username.data, email=form.email.data, role=form.role.data)
        user.set_password(form.password.data)
        db.session.add(user)
        db.session.commit()

        flash('Account created. Please sign in.', 'success')
        return redirect(url_for('main.login'))

    return render_template('auth/register.html', form=form)


@main.route('/logout')
@login_required
def logout():
    logout_user()
    flash('You have been signed out.', 'info')
    return redirect(url_for('main.index'))


@main.route('/discover')
def discover():
    genre = request.args.get('genre', '')
    sort  = request.args.get('sort', 'new')

    q = Beat.query
    if genre:
        q = q.filter_by(genre=genre)
    q = q.order_by(Beat.play_count.desc() if sort == 'popular' else Beat.uploaded_at.desc())
    beats = q.all()

    genres = sorted({b.genre for b in Beat.query.all() if b.genre})
    return render_template('main/discover.html', beats=beats, genres=genres,
                           active_genre=genre, sort=sort)


@main.route('/feed')
def feed():
    beats = Beat.query.order_by(Beat.uploaded_at.desc()).all()
    return render_template('main/feed.html', beats=beats)


@main.route('/beat/<int:beat_id>')
def beat_detail(beat_id):
    beat = Beat.query.get_or_404(beat_id)
    beat.increment_plays()
    db.session.commit()
    is_liked = (current_user.is_authenticated and
                Like.query.filter_by(user_id=current_user.id, beat_id=beat_id).first() is not None)
    return render_template('main/beat_detail.html', beat=beat, is_liked=is_liked)


@main.route('/like/<int:beat_id>', methods=['POST'])
@login_required
def toggle_like(beat_id):
    beat = Beat.query.get_or_404(beat_id)
    existing = Like.query.filter_by(user_id=current_user.id, beat_id=beat_id).first()

    if existing:
        db.session.delete(existing)
        liked = False
    else:
        db.session.add(Like(user_id=current_user.id, beat_id=beat_id))
        liked = True

    db.session.commit()
    return jsonify({'liked': liked, 'count': beat.like_count()})


@main.route('/upload', methods=['GET', 'POST'])
@login_required
def upload():
    if not current_user.is_producer():
        flash('Only producers can upload beats.', 'danger')
        return redirect(url_for('main.feed'))

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
            audio_url=form.audio_url.data,
            cover_url=form.cover_url.data,
            producer_id=current_user.id,
        )
        db.session.add(beat)
        db.session.commit()
        flash('Beat uploaded successfully!', 'success')
        return redirect(url_for('main.profile', user_id=current_user.id))

    return render_template('main/upload.html', form=form)


@main.route('/profile/<int:user_id>')
def profile(user_id):
    user = User.query.get_or_404(user_id)
    page = request.args.get('page', 1, type=int)
    beats = user.beats.order_by(Beat.uploaded_at.desc()).paginate(page=page, per_page=12)
    is_following = current_user.is_following(user) if current_user.is_authenticated else False
    return render_template('main/profile.html', user=user, beats=beats, is_following=is_following)


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

    return redirect(request.referrer or url_for('main.discover'))


@main.route('/search', methods=['GET', 'POST'])
def search():
    form = SearchForm()
    beats = []
    producers = []
    query = request.args.get('q', '')
    search_type = request.args.get('type', 'all')
    genre_filter = request.args.get('genre', '')

    if query:
        if search_type in ('all', 'beats'):
            bq = Beat.query
            bq = bq.filter(
                Beat.title.ilike(f'%{query}%') |
                Beat.genre.ilike(f'%{query}%') |
                Beat.mood_tag.ilike(f'%{query}%')
            )
            if genre_filter:
                bq = bq.filter(Beat.genre.ilike(f'%{genre_filter}%'))
            beats = bq.order_by(Beat.uploaded_at.desc()).all()

        if search_type in ('all', 'producers'):
            pq = User.query.filter_by(role='producer')
            pq = pq.filter(
                User.username.ilike(f'%{query}%') |
                User.bio.ilike(f'%{query}%')
            )
            producers = pq.all()

    return render_template('main/search.html', form=form, beats=beats, producers=producers,
                           query=query, search_type=search_type, genre_filter=genre_filter)
