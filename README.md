# TuneFeed

TuneFeed is a web application project for CITS3403/CITS5505. The platform is designed to support a music-focused community where users can sign in and interact with shared content.

## Purpose and Design

The application aims to provide an engaging and intuitive user experience for discovering and sharing music-related updates.

Current implementation focus:
- Flask client-server architecture setup
- Authentication page UI (login interface)
- Reusable base template and shared styling system

Planned implementation focus:
- Full user authentication flow (login/logout/session handling)
- Persistent user data with SQLite + SQLAlchemy
- User-generated content and cross-user visibility features

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

1. Create and activate a virtual environment (recommended):
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

Planned test coverage:
- Unit tests for backend logic
- Selenium/integration tests for core user workflows

Once tests are added, this section will include exact commands to run them.

## Project Status

This repository is the baseline for iterative development across project checkpoints (UI, backend, and testing/security milestones).

## Academic Integrity

All external references, libraries, and assets used in this project should be documented clearly in commit history and/or project documentation.
