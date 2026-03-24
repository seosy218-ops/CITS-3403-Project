# TuneFeed

**TuneFeed** is a modern music discovery and beat marketplace web application for CITS3403/CITS5505. It combines short-form content discovery with a professional beat marketplace so producers, artists, and listeners can connect in one platform.

## General Project Idea

TuneFeed addresses a common problem in existing beat marketplaces: discovering high-quality beats quickly is often slow and filter-heavy.

The core concept combines:

| Concept | Description |
|------|------|
| Short-form discovery | Scrollable feed for fast track discovery |
| Music streaming | Smooth in-app playback experience |
| Beat marketplace | Producer listings with licensing options |

Instead of long result pages, users discover content through a feed-based experience with lightweight social interaction and recommendation support.

## Target Users

### Producers
- Upload beats and samples
- Build an audience
- Sell licenses (including exclusive options)
- Track engagement/performance

### Artists / Musicians
- Discover suitable beats quickly
- Purchase licenses
- Contact producers for collaboration

### Listeners
- Explore new music
- Follow producers
- Engage with content

## Planned Core Features

### Discovery Feed
- Vertical scrolling beat feed
- Auto-play progression between items
- Metadata display (title, producer, BPM, key, genre, price)
- Engagement indicators

### Social Layer
- Like, repost, follow, comment
- Engagement signals used to improve recommendations

### Recommendation Logic
- Personalized feed based on listening and interaction behavior
- Genre and preference adaptation over time

### Producer Profiles
- Profile identity, bio, and external links
- Catalogue sections (new, trending, sold)

### Marketplace and Licensing
- Multiple license tiers (basic/premium/exclusive)
- Clear license display before purchase
- Exclusive purchase handling in feed visibility

## Current Scope (Implemented)

- Flask client-server architecture setup
- Login page UI with reusable base template
- Shared style system for auth/layout components

## Planned Scope (Next Milestones)

- Full authentication flow (login/logout/session handling)
- Persistent data storage using SQLite + SQLAlchemy
- Cross-user content visibility and interaction
- Testing and security hardening

## Group Members

| UWA ID | Name | GitHub Username |
|---|---|---|
| TODO | TODO | TODO |
| TODO | TODO | TODO |
| TODO | TODO | TODO |

## Tech Stack

- Python 3
- Flask
- HTML + Jinja templates
- CSS
- SQLite (planned)
- SQLAlchemy (planned)

## How to Run the Application

1. Create and activate a virtual environment:
	- Windows (PowerShell):
	  - `py -3 -m venv .venv`
	  - `.\.venv\Scripts\Activate.ps1`
2. Install dependencies:
	- `python -m pip install -r requirements.txt`
3. Run the app:
	- `python run.py`
4. Open in browser:
	- `http://127.0.0.1:5000/login`

## Running Tests

Test suite is not yet included in the current baseline.

Planned coverage:
- Unit tests for backend logic
- Integration/Selenium tests for core user flows

## Project Status

TuneFeed is currently in early implementation. The project is being developed incrementally across checkpoints (frontend, backend, testing, and security).

## Academic Integrity

All external references, libraries, and assets used in this project should be documented in project documentation and commit history.