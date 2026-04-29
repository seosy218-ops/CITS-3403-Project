# TuneFeed

**TuneFeed** is a music discovery and beat marketplace web application built for CITS3403 at the University of Western Australia. Producers upload beats; listeners discover them through a vertical scroll feed, like and save tracks, leave comments, and follow producers.

## Features

| Feature | Details |
|---|---|
| Scroll feed | TikTok-style vertical snap feed with auto-play and waveform visualiser |
| Beat marketplace | Per-beat pricing with Basic, Premium, and Exclusive licence tiers |
| Social layer | Likes, saves, comments (with threaded replies), follow/unfollow |
| Producer profiles | Avatar, bio, beat catalogue, and engagement stats |
| Discovery page | Trending and new-drops sections with genre/BPM/key metadata |
| Search | Full-text beat and producer search |
| Authentication | Flask-Login sessions with CSRF protection via Flask-WTF |

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3, Flask 3.1, SQLAlchemy 3.1, Flask-Login, Flask-WTF |
| Database | SQLite (development) — swap `DATABASE_URL` env var for Postgres in production |
| Frontend | Jinja2, Bootstrap 5, Bootstrap Icons, Web Audio API |
| Avatar generation | DiceBear avataaars API |

## Group Members

| UWA ID | Name | GitHub Username |
|---|---|---|
| 23474825 | Griffin Hudson | griffhudson |
| 23474826 | Member Two | member2 |
| 23474827 | Member Three | member3 |

## How to Run

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Seed the database (creates instance/tunefeed.db with demo data)
python seed.py

# 4. Start the development server
python run.py
```

Open [http://127.0.0.1:5002](http://127.0.0.1:5002) in your browser.

**Demo accounts** (pre-seeded by `seed.py`):

| Role | Email | Password |
|---|---|---|
| Listener | demo@tunefeed.io | password123 |
| Producer | metro@tunefeed.io | password123 |

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | `tunefeed-dev-2025-change-in-prod` | Flask session signing key — **must** be overridden in production |
| `DATABASE_URL` | `sqlite:///tunefeed.db` | SQLAlchemy connection string |
| `FLASK_DEBUG` | `false` | Set to `true` to enable the Werkzeug debugger |
| `PORT` | `5002` | Port the dev server binds to |

## Running Tests

```bash
pytest
```

Tests live in `tests/` and cover authentication flows, protected route access, and the JSON API endpoints.

## Project Structure

```
app/
├── __init__.py          # Application factory
├── config.py            # Config class (reads env vars)
├── models.py            # SQLAlchemy models
├── forms.py             # Flask-WTF form definitions
├── routes.py            # Main blueprint (pages + auth)
├── services/
│   └── feed_service.py  # Feed ranking algorithm
├── api/
│   └── routes.py        # JSON API blueprint
├── static/              # CSS, JS, uploaded files
└── templates/           # Jinja2 HTML templates

tests/
├── conftest.py          # App and client fixtures
├── test_auth.py         # Registration, login, logout
├── test_routes.py       # Page route status codes
└── test_api.py          # Like, save, follow API endpoints
```

## Known Limitations

- **No rate limiting** — the API endpoints (like, save, follow, play) have no per-user request throttling. A production deployment would add rate limiting via a middleware such as `flask-limiter`.
- **SQLite only** — the default database is SQLite, which does not support concurrent writes well. Set `DATABASE_URL` to a Postgres connection string for any multi-user deployment.
- **Audio hosted externally** — beat audio files are streamed from GitHub raw URLs for the demo. A production version would store audio in an object store (e.g., S3) and stream from there.
- **No email verification** — accounts are activated immediately on registration without email confirmation.
- **No password reset flow** — there is no "forgot password" route.

## Academic Integrity

All external libraries are listed in `requirements.txt`. Third-party assets (DiceBear avatars, Bootstrap, Bootstrap Icons) are referenced from their respective CDNs or package sources. No code was copied from other student submissions.
