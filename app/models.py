from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()

# ---------------------------------------------------------------------------
# ASSOCIATION / JUNCTION TABLES
# These handle many-to-many relationships (no extra columns needed on them)
# ---------------------------------------------------------------------------

# A user (listener) can follow many producers, and a producer can have many followers
follows = db.Table(
    'follows',
    db.Column('follower_id', db.Integer, db.ForeignKey('user.id'), primary_key=True),
    db.Column('followed_id', db.Integer, db.ForeignKey('user.id'), primary_key=True)
)

# ---------------------------------------------------------------------------
# USER MODEL
# Covers both producers and listeners via the `role` field
# ---------------------------------------------------------------------------

class User(UserMixin, db.Model):
    __tablename__ = 'user'

    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(64),  unique=True, nullable=False)
    email         = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)          # store hashed passwords only!
    role          = db.Column(db.String(16),  nullable=False)          # 'producer' or 'listener'
    bio           = db.Column(db.Text,        nullable=True)
    avatar_url    = db.Column(db.String(256), nullable=True)           # path to profile picture
    created_at    = db.Column(db.DateTime,    default=datetime.utcnow)

    # --- Relationships ---

    # Beats this user has uploaded (only relevant if role == 'producer')
    beats = db.relationship('Beat', back_populates='producer', lazy='dynamic')

    # Beats this user has liked
    likes = db.relationship('Like', back_populates='user', lazy='dynamic')

    # Purchases made by this user
    purchases = db.relationship('Purchase', back_populates='buyer', lazy='dynamic')

    # Followers / following (self-referential many-to-many)
    following = db.relationship(
        'User',
        secondary=follows,
        primaryjoin=(follows.c.follower_id == id),
        secondaryjoin=(follows.c.followed_id == id),
        backref=db.backref('followers', lazy='dynamic'),
        lazy='dynamic'
    )

    # --- Helper methods ---

    def is_producer(self):
        return self.role == 'producer'

    def follow(self, user):
        if not self.is_following(user):
            self.following.append(user)

    def unfollow(self, user):
        if self.is_following(user):
            self.following.remove(user)

    def is_following(self, user):
        return self.following.filter(follows.c.followed_id == user.id).count() > 0

    def follower_count(self):
        return self.followers.count()

    def __repr__(self):
        return f'<User {self.username} ({self.role})>'
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


# ---------------------------------------------------------------------------
# BEAT MODEL
# The core content unit — uploaded by producers
# ---------------------------------------------------------------------------

class Beat(db.Model):
    __tablename__ = 'beat'

    id           = db.Column(db.Integer, primary_key=True)
    title        = db.Column(db.String(128), nullable=False)
    audio_url    = db.Column(db.String(256), nullable=False)   # path to uploaded audio file
    cover_url    = db.Column(db.String(256), nullable=True)    # optional cover art
    genre        = db.Column(db.String(64),  nullable=True)    # e.g. 'Hip-Hop', 'Trap', 'Lo-Fi'
    bpm          = db.Column(db.Integer,     nullable=True)    # beats per minute
    key          = db.Column(db.String(16),  nullable=True)    # e.g. 'C minor', 'F# major'
    mood_tag     = db.Column(db.String(64),  nullable=True)    # e.g. 'Dark', 'Chill', 'Hype'
    licence_type = db.Column(db.String(64),  nullable=True)    # e.g. 'Non-exclusive', 'Exclusive'
    price        = db.Column(db.Float,       nullable=False, default=0.0)
    play_count   = db.Column(db.Integer,     nullable=False, default=0)
    uploaded_at  = db.Column(db.DateTime,   default=datetime.utcnow)

    # Foreign key back to the producer
    producer_id  = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    # --- Relationships ---
    producer  = db.relationship('User',     back_populates='beats')
    likes     = db.relationship('Like',     back_populates='beat',     lazy='dynamic', cascade='all, delete-orphan')
    purchases = db.relationship('Purchase', back_populates='beat',     lazy='dynamic', cascade='all, delete-orphan')

    # --- Helper methods ---

    def like_count(self):
        return self.likes.count()

    def increment_plays(self):
        self.play_count += 1

    def __repr__(self):
        return f'<Beat "{self.title}" by producer_id={self.producer_id}>'


# ---------------------------------------------------------------------------
# LIKE MODEL
# Tracks which user liked which beat (many-to-many with extra timestamp)
# ---------------------------------------------------------------------------

class Like(db.Model):
    __tablename__ = 'like'

    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('user.id'),  nullable=False)
    beat_id    = db.Column(db.Integer, db.ForeignKey('beat.id'),  nullable=False)
    liked_at   = db.Column(db.DateTime, default=datetime.utcnow)

    # Ensure a user can only like a beat once
    __table_args__ = (db.UniqueConstraint('user_id', 'beat_id', name='unique_like'),)

    # --- Relationships ---
    user = db.relationship('User', back_populates='likes')
    beat = db.relationship('Beat', back_populates='likes')

    def __repr__(self):
        return f'<Like user_id={self.user_id} beat_id={self.beat_id}>'


# ---------------------------------------------------------------------------
# PURCHASE MODEL
# Records completed beat purchases
# ---------------------------------------------------------------------------

class Purchase(db.Model):
    __tablename__ = 'purchase'

    id           = db.Column(db.Integer, primary_key=True)
    buyer_id     = db.Column(db.Integer, db.ForeignKey('user.id'),  nullable=False)
    beat_id      = db.Column(db.Integer, db.ForeignKey('beat.id'),  nullable=False)
    price_paid   = db.Column(db.Float,   nullable=False)             # snapshot of price at time of purchase
    licence_type = db.Column(db.String(64), nullable=True)           # snapshot of licence at time of purchase
    purchased_at = db.Column(db.DateTime, default=datetime.utcnow)

    # --- Relationships ---
    buyer = db.relationship('User', back_populates='purchases')
    beat  = db.relationship('Beat', back_populates='purchases')

    def __repr__(self):
        return f'<Purchase buyer_id={self.buyer_id} beat_id={self.beat_id} price={self.price_paid}>'
