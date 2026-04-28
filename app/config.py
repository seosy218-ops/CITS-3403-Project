import os

class Config:
    # Fall back to a hard-coded dev secret; MUST be overridden via env var in production
    SECRET_KEY = os.environ.get('SECRET_KEY', 'tunefeed-dev-2025-change-in-prod')

    # SQLite for development; swap DATABASE_URL for Postgres/MySQL in production
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL', 'sqlite:///tunefeed.db')

    # Disable SQLAlchemy event system overhead — not needed unless using signals
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    WTF_CSRF_ENABLED = True
    WTF_CSRF_TIME_LIMIT = 3600  # CSRF tokens expire after 1 hour
