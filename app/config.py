import os

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-key-change-me-in-prod')
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL', 'sqlite:///tunefeed.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    WTF_CSRF_ENABLED = True
