import os
import secrets as _secrets


def _require_secret_key():
    key = os.environ.get('SECRET_KEY')
    if key:
        return key
    if os.environ.get('FLASK_DEBUG', 'false').lower() == 'true':
        # Ephemeral key for local dev — sessions reset on every restart, which is fine
        return _secrets.token_hex(32)
    raise ValueError(
        'SECRET_KEY environment variable must be set in production. '
        'Generate one with: python -c "import secrets; print(secrets.token_hex(32))"'
    )


class Config:
    SECRET_KEY = _require_secret_key()

    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL', 'sqlite:///tunefeed.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    WTF_CSRF_ENABLED = True
    WTF_CSRF_TIME_LIMIT = 3600

    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    # Only send the cookie over HTTPS; disabled in local dev (FLASK_DEBUG=true) where there is no TLS
    SESSION_COOKIE_SECURE = os.environ.get('FLASK_DEBUG', 'false').lower() != 'true'
