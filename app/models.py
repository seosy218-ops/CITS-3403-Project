from datetime import datetime
from flask_login import UserMixin
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()

# ---------------------------------------------------------------------------
# Association tables
# ---------------------------------------------------------------------------

follows = db.Table('follows',
    db.Column('follower_id', db.Integer, db.ForeignKey('user.id'), primary_key=True),
    db.Column('followed_id', db.Integer, db.ForeignKey('user.id'), primary_key=True),
)

comment_likes = db.Table('comment_likes',
    db.Column('user_id',    db.Integer, db.ForeignKey('user.id'),    primary_key=True),
    db.Column('comment_id', db.Integer, db.ForeignKey('comment.id'), primary_key=True),
)

comment_dislikes = db.Table('comment_dislikes',
    db.Column('user_id',    db.Integer, db.ForeignKey('user.id'),    primary_key=True),
    db.Column('comment_id', db.Integer, db.ForeignKey('comment.id'), primary_key=True),
)


# ---------------------------------------------------------------------------
# User
# `role` is retained for compatibility; current routes treat all users the same.
# ---------------------------------------------------------------------------

class User(UserMixin, db.Model):
    __tablename__ = 'user'

    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(64),  unique=True, nullable=False)
    email         = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role          = db.Column(db.String(16),  nullable=False, default='user')  # all users have same permissions
    bio           = db.Column(db.Text,        nullable=True)
    avatar_url    = db.Column(db.String(256), nullable=True)
    created_at    = db.Column(db.DateTime,    default=datetime.utcnow)

    beats     = db.relationship('Beat',     back_populates='producer', lazy='dynamic')
    likes     = db.relationship('Like',     back_populates='user',     lazy='dynamic')
    purchases = db.relationship('Purchase', back_populates='buyer',    lazy='dynamic')

    liked_comments = db.relationship(
        'Comment', secondary=comment_likes,
        backref=db.backref('likers', lazy='dynamic'), lazy='dynamic',
    )
    disliked_comments = db.relationship(
        'Comment', secondary=comment_dislikes,
        backref=db.backref('dislikers', lazy='dynamic'), lazy='dynamic',
    )
    following = db.relationship(
        'User', secondary=follows,
        primaryjoin=(follows.c.follower_id == id),
        secondaryjoin=(follows.c.followed_id == id),
        backref=db.backref('followers', lazy='dynamic'),
        lazy='dynamic',
    )

    # ---- auth ----
    def set_password(self, password):
        """Hash and store a plaintext password."""
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        """Validate a plaintext password against the stored hash."""
        return check_password_hash(self.password_hash, password)

    # ---- follow ----
    def follow(self, user):
        """Follow `user` if not already following (idempotent)."""
        if not self.is_following(user):
            self.following.append(user)

    def unfollow(self, user):
        """Unfollow `user` if currently following (idempotent)."""
        if self.is_following(user):
            self.following.remove(user)

    def is_following(self, user):
        """Return True when this user follows `user`."""
        return self.following.filter(follows.c.followed_id == user.id).count() > 0

    def follower_count(self):
        return self.followers.count()

    # ---- beat likes ----
    def has_liked(self, beat):
        """Return True if this user has liked `beat`."""
        return self.likes.filter_by(beat_id=beat.id).count() > 0

    def like_beat(self, beat):
        """Create a like edge if one does not already exist."""
        if not self.has_liked(beat):
            db.session.add(Like(user_id=self.id, beat_id=beat.id))

    def unlike_beat(self, beat):
        """Remove this user's like edge for `beat` if present."""
        Like.query.filter_by(user_id=self.id, beat_id=beat.id).delete()

    # ---- comment likes / dislikes ----
    def has_liked_comment(self, comment):
        """Return True if this user has liked `comment`."""
        return self.liked_comments.filter(comment_likes.c.comment_id == comment.id).count() > 0

    def like_comment(self, comment):
        """Like `comment`, removing any existing dislike first (mutually exclusive)."""
        if not self.has_liked_comment(comment):
            if self.has_disliked_comment(comment):
                self.disliked_comments.remove(comment)
            self.liked_comments.append(comment)

    def unlike_comment(self, comment):
        """Remove this user's like on `comment` if present."""
        if self.has_liked_comment(comment):
            self.liked_comments.remove(comment)

    def has_disliked_comment(self, comment):
        """Return True if this user has disliked `comment`."""
        return self.disliked_comments.filter(comment_dislikes.c.comment_id == comment.id).count() > 0

    def dislike_comment(self, comment):
        """Dislike `comment`, removing any existing like first (mutually exclusive)."""
        if not self.has_disliked_comment(comment):
            if self.has_liked_comment(comment):
                self.liked_comments.remove(comment)
            self.disliked_comments.append(comment)

    def undislike_comment(self, comment):
        """Remove this user's dislike on `comment` if present."""
        if self.has_disliked_comment(comment):
            self.disliked_comments.remove(comment)

    def __repr__(self):
        return f'<User {self.username}>'


# ---------------------------------------------------------------------------
# Beat
# ---------------------------------------------------------------------------

class Beat(db.Model):
    __tablename__ = 'beat'

    id           = db.Column(db.Integer, primary_key=True)
    title        = db.Column(db.String(128), nullable=False)
    audio_url    = db.Column(db.String(256), nullable=False)
    cover_url    = db.Column(db.String(256), nullable=True)
    genre        = db.Column(db.String(64),  nullable=True)
    bpm          = db.Column(db.Integer,     nullable=True)
    key          = db.Column(db.String(16),  nullable=True)
    mood_tag     = db.Column(db.String(64),  nullable=True)
    duration     = db.Column(db.String(10),  default='3:00')
    licence_type    = db.Column(db.String(64), nullable=True)
    price           = db.Column(db.Float, nullable=False, default=0.0)   # Basic Lease price
    premium_price   = db.Column(db.Float, nullable=True)                 # Premium License tier
    exclusive_price = db.Column(db.Float, nullable=True)                 # Exclusive Rights tier
    play_count   = db.Column(db.Integer,     nullable=False, default=0)
    is_trending  = db.Column(db.Boolean,     default=False)
    uploaded_at  = db.Column(db.DateTime,    default=datetime.utcnow)
    producer_id  = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    producer  = db.relationship('User',     back_populates='beats')
    likes     = db.relationship('Like',     back_populates='beat', lazy='dynamic', cascade='all, delete-orphan')
    purchases = db.relationship('Purchase', back_populates='beat', lazy='dynamic', cascade='all, delete-orphan')
    comments  = db.relationship('Comment',  back_populates='beat', lazy='dynamic', cascade='all, delete-orphan')

    @property
    def likes_count(self):
        return self.likes.count()

    @property
    def comment_count(self):
        return self.comments.filter_by(parent_id=None).count()

    def __repr__(self):
        return f'<Beat "{self.title}">'


# ---------------------------------------------------------------------------
# Like
# ---------------------------------------------------------------------------

class Like(db.Model):
    __tablename__ = 'like'

    id       = db.Column(db.Integer, primary_key=True)
    user_id  = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    beat_id  = db.Column(db.Integer, db.ForeignKey('beat.id'), nullable=False)
    liked_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (db.UniqueConstraint('user_id', 'beat_id', name='unique_like'),)

    user = db.relationship('User', back_populates='likes')
    beat = db.relationship('Beat', back_populates='likes')


# ---------------------------------------------------------------------------
# Purchase
# ---------------------------------------------------------------------------

class Purchase(db.Model):
    __tablename__ = 'purchase'

    id           = db.Column(db.Integer, primary_key=True)
    buyer_id     = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    beat_id      = db.Column(db.Integer, db.ForeignKey('beat.id'), nullable=False)
    price_paid   = db.Column(db.Float,   nullable=False)
    licence_type = db.Column(db.String(64), nullable=True)
    purchased_at = db.Column(db.DateTime, default=datetime.utcnow)

    buyer = db.relationship('User', back_populates='purchases')
    beat  = db.relationship('Beat', back_populates='purchases')


# ---------------------------------------------------------------------------
# Comment  (self-referential nested replies via parent_id)
# ---------------------------------------------------------------------------

class Comment(db.Model):
    __tablename__ = 'comment'

    id           = db.Column(db.Integer, primary_key=True)
    beat_id      = db.Column(db.Integer, db.ForeignKey('beat.id'),    nullable=False)
    author_id    = db.Column(db.Integer, db.ForeignKey('user.id'),    nullable=False)
    parent_id    = db.Column(db.Integer, db.ForeignKey('comment.id'), nullable=True)
    body         = db.Column(db.Text,    nullable=False)
    created_at   = db.Column(db.DateTime, default=datetime.utcnow)
    report_count = db.Column(db.Integer,  default=0)  # incremented by report endpoint

    beat   = db.relationship('Beat', back_populates='comments', foreign_keys=[beat_id])
    author = db.relationship('User', foreign_keys=[author_id],
                             backref=db.backref('comments', lazy='dynamic'))
    parent = db.relationship('Comment', remote_side=[id],
                             backref=db.backref('replies', lazy='dynamic',
                                                cascade='all, delete-orphan'))

    @property
    def likes_count(self):
        return self.likers.count()

    @property
    def dislikes_count(self):
        return self.dislikers.count()

    def __repr__(self):
        return f'<Comment beat={self.beat_id}>'


# ---------------------------------------------------------------------------
# CommentReport  (one row per user report; prevents duplicate reports)
# ---------------------------------------------------------------------------

class CommentReport(db.Model):
    __tablename__ = 'comment_report'

    id         = db.Column(db.Integer, primary_key=True)
    comment_id = db.Column(db.Integer, db.ForeignKey('comment.id'), nullable=False, index=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('user.id'),    nullable=False, index=True)
    reason     = db.Column(db.String(64), nullable=True)  # e.g. 'spam', 'hate', 'inappropriate'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (db.UniqueConstraint('comment_id', 'user_id', name='unique_report'),)


# ---------------------------------------------------------------------------
# BeatPlayEvent  (deduplicates rapid play pings within an 8-second window)
# ---------------------------------------------------------------------------

class BeatPlayEvent(db.Model):
    __tablename__ = 'beat_play_event'

    id          = db.Column(db.Integer, primary_key=True)
    beat_id     = db.Column(db.Integer, db.ForeignKey('beat.id'), nullable=False, index=True)
    user_id     = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True,  index=True)
    session_key = db.Column(db.String(64), nullable=True, index=True)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow, index=True)
