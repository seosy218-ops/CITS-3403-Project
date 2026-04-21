from flask import Blueprint, render_template, redirect, url_for, flash, request
from flask_login import login_user, logout_user, login_required, current_user
from app.forms import SignupForm, LoginForm, UploadBeatForm, SearchForm
from app.models import db, User, Beat

main = Blueprint('main', __name__)

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
        existing_username = User.query.filter_by(username=form.username.data).first()
        existing_email = User.query.filter_by(email=form.email.data).first()

        if existing_username:
            flash('Username already taken.', 'danger')
            return render_template('auth/register.html', form=form)

        if existing_email:
            flash('Email already registered.', 'danger')
            return render_template('auth/register.html', form=form)

        user = User(
            username=form.username.data,
            email=form.email.data,
            role=form.role.data
        )
        user.set_password(form.password.data)

        db.session.add(user)
        db.session.commit()

        flash('Account created successfully. Please log in.', 'success')
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
    producers = User.query.filter_by(role='producer').limit(12).all()
    return render_template('main/discover.html', producers=producers)

@main.route('/feed')
def feed():
    beats = Beat.query.order_by(Beat.uploaded_at.desc()).all()
    return render_template('main/feed.html', beats=beats)

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
            producer_id=current_user.id
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
        flash(f'You unfollowed {user.username}.', 'info')
    else:
        current_user.follow(user)
        db.session.commit()
        flash(f'You are now following {user.username}.', 'success')
    
    return redirect(request.referrer or url_for('main.feed'))

@main.route('/search', methods=['GET', 'POST'])
def search():
    form = SearchForm()
    beats = []
    producers = []
    query = ''
    search_type = 'all'
    genre_filter = ''
    
    if form.validate_on_submit() or request.args.get('q'):
        query = form.query.data or request.args.get('q', '')
        search_type = form.search_type.data or request.args.get('type', 'all')
        genre_filter = form.genre.data or request.args.get('genre', '')
        
        # Search beats
        if search_type in ['all', 'beats']:
            beat_query = Beat.query
            if query:
                beat_query = beat_query.filter(
                    (Beat.title.ilike(f'%{query}%')) | 
                    (Beat.genre.ilike(f'%{query}%')) |
                    (Beat.mood_tag.ilike(f'%{query}%'))
                )
            if genre_filter:
                beat_query = beat_query.filter(Beat.genre.ilike(f'%{genre_filter}%'))
            beats = beat_query.order_by(Beat.uploaded_at.desc()).all()
        
        # Search producers
        if search_type in ['all', 'producers']:
            producer_query = User.query.filter_by(role='producer')
            if query:
                producer_query = producer_query.filter(
                    (User.username.ilike(f'%{query}%')) | 
                    (User.bio.ilike(f'%{query}%'))
                )
            producers = producer_query.all()
    
    return render_template('main/search.html', form=form, beats=beats, producers=producers, 
                         query=query, search_type=search_type, genre_filter=genre_filter)