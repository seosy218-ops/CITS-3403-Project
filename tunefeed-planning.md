# TuneFeed — CITS3403 Checkpoint 2 Planning

---

## 1) Application Choice

**Application: TuneFeed**

TuneFeed is a vertical-scrolling music discovery platform where music producers upload beats and listeners discover, preview, like, and purchase tracks through a TikTok-style infinite feed. Think of it as the "For You Page" for beats — built specifically for the producer-to-buyer pipeline that existing platforms like BeatStars and SoundCloud handle poorly.

**Why TuneFeed is a good fit for CITS3403:**

Existing beat marketplaces have a discoverability problem — producers must drive their own traffic, and listeners have no passive way to stumble across new music. TuneFeed solves this with a feed-first design: beats auto-preview as users scroll, removing the friction of tapping play on every track. This mirrors how TikTok turned unknown creators into viral sensations, applied directly to the music production industry.

From a technical standpoint, TuneFeed satisfies every core requirement of the project:

- **Authentication** — producers and listeners register with role-based accounts, enabling personalised feeds and purchase history
- **User data persistence** — likes, follows, purchase records, and uploaded beats are all stored between sessions via SQLite/SQLAlchemy
- **Viewing other users' data** — the feed surfaces beats from all producers; producer profile pages display uploads, follower counts, and play statistics
- **Client-server architecture** — Flask handles all routing, data manipulation, and page generation; JavaScript drives the feed interactions, audio playback, and AJAX calls without full page reloads
- **Rich frontend** — Bootstrap 5 provides responsive layout; custom CSS delivers the dark, branded aesthetic; JavaScript powers the Intersection Observer-based autoplay and DOM manipulation

Beyond the technical requirements, TuneFeed is a genuinely useful application. It creates real value for producers who want organic reach and for listeners who want fast, low-effort music discovery — making it engaging, effective, and intuitive by design.

---

## 2) User Stories (12 Stories)

User stories are written from the end-user perspective following Agile methodology as taught in CITS3403. Each story describes one deliverable feature and the value it provides.

| # | Role | Story | Value |
|---|------|-------|-------|
| 1 | New user | I want to register an account so I can personalise my feed and save my activity. | Core authentication — enables everything else |
| 2 | Returning user | I want to log in securely so I can access my profile, liked beats, and purchase history. | Session persistence across visits |
| 3 | Producer | I want to upload a beat with a title, genre tag, BPM, key, and price so listeners can discover and buy it. | Core content upload functionality |
| 4 | Listener | I want to scroll a vertical feed of beats that auto-preview as I scroll, so I can discover music the same way I discover content on TikTok — fast and frictionless. | The core TikTok-style UX loop |
| 5 | Listener | I want beats to auto-play as they enter my screen so I don't have to manually press play on every track. | Feed engagement and retention |
| 6 | User | I want to tap a heart icon to like a beat without leaving the feed so I can save favourites while continuing to browse. | In-feed interaction, mirrors TikTok double-tap |
| 7 | User | I want to follow a producer directly from their beat card in the feed so I can see their future uploads without searching for them. | Social graph — follows feed personalisation |
| 8 | Buyer | I want to tap a beat card to open a detail page showing the full waveform, licence type, and price so I can decide whether to purchase. | Beat detail page — conversion step |
| 9 | User | I want to search beats by keyword, genre, BPM range, or mood tag so I can find tracks that fit a specific creative project. | Discovery beyond the feed |
| 10 | Producer | I want a profile page that displays all my uploaded beats, total play count, and follower count so I can track my reach and showcase my work to potential buyers. | Producer dashboard / storefront |
| 11 | User | I want to edit my username, bio, and profile picture so my account accurately reflects my identity and brand. | Profile management |
| 12 | Authenticated user | I want to log out so my account stays secure when I'm on a shared or public device. | Security and session management |

---

## 3) Main Website Pages

The following pages make up the full TuneFeed application. Pages are structured to support the navigation flow a user naturally takes — from discovery, to detail, to purchase or follow.

| Page | Purpose |
|------|---------|
| **Landing / Home** | Public-facing intro page. Explains TuneFeed's value, shows a preview of trending beats, and prompts sign-up. |
| **Sign Up** | Registration form with username, email, password, and role selection (Producer or Listener). |
| **Login** | Secure login form. Redirects to feed on success. |
| **Feed / Discover** | The core page. Vertical scrolling beat cards with auto-preview audio, like buttons, follow buttons, genre tags, and BPM. Sortable by Trending, New Drops, or Genre. |
| **Beat Detail** | Full detail view for a single beat: waveform player, full metadata (BPM, key, genre, licence type), producer info, price, and buy button. |
| **Upload Beat** | Producer-only form to upload an audio file with metadata. Includes validation for file type, BPM range, and required fields. |
| **Producer Profile** | Public profile page for a producer showing their uploaded beats, follower count, total plays, and bio. |
| **Producers List** | Browsable/searchable directory of all producers on the platform. |
| **Search Results** | Displays beats and/or producers matching a search query. Filterable by genre, BPM, and price range. |
| **Marketplace** | Curated page of purchasable beats, sortable by price, popularity, or recency. |
| **User Settings** | Authenticated user can update username, bio, and profile picture. |

---

## 4) CSS Framework Decision

**Framework: Bootstrap 5** (with Bootstrap Icons)

Bootstrap 5 is the chosen framework for TuneFeed for the following reasons:

- **Grid system** — Bootstrap's 12-column grid makes the feed layout, beat cards, and producer profile pages responsive across mobile, tablet, and desktop without writing custom media queries from scratch.
- **Components** — modals (beat detail overlay), navbars (top navigation), badges (genre/BPM tags), cards (beat cards in the feed), and buttons are all available as well-tested Bootstrap components that we can extend with custom CSS.
- **Bootstrap Icons** — provides the icon set used throughout the UI: play/pause controls, heart (like), person-plus (follow), music note, and search icons, all consistent and lightweight.
- **Custom CSS on top** — Bootstrap provides the structural foundation, but TuneFeed's dark aesthetic, gradient accents, waveform styling, and animated feed transitions are written in custom CSS. This keeps Bootstrap as the responsive scaffold while the brand identity is entirely our own.
- **Allowed by the unit** — Bootstrap is explicitly listed as an approved CSS framework in the CITS3403 project specification.

We are **not** using Tailwind, SemanticUI, or SASS directly, as per the project technical requirements.

---

## 5) Optional Pre-Meeting Progress

The following static mockups have been created as non-interactive HTML/CSS pages to demonstrate the visual design direction before backend integration. All pages use Bootstrap 5 and custom CSS matching the TuneFeed brand (dark background, purple/pink gradient accents, card-based layout).

**Completed static mockups:**

- **Home / Landing page** — hero section with tagline, animated beat cards preview strip, and call-to-action buttons for Sign Up and Explore Feed.
- **Login page** — centred card with email/password fields, Bootstrap form validation markup, and a link to Sign Up.
- **Sign Up page** — registration form with role selection toggle (Producer / Listener) and client-side field validation.
- **Feed / Discover page** — vertical scrolling beat cards, each showing cover art, producer name, genre badge, BPM, like button, and follow button. Demonstrates the TikTok-style layout.
- **Beat Detail page** — full-width waveform area, beat metadata panel, producer info section, price display, and a Buy Beat button.
- **Upload Beat page** — producer form with file upload dropzone, text fields for metadata, and a genre/tag selector.
- **Producer Profile page** — profile header with avatar, bio, follower/upload stats, and a grid of the producer's uploaded beat cards.

**All mockups have been committed to the group's private GitHub repository** under the `frontend/mockups` branch, with individual commits per page and descriptive commit messages following the Agile GitHub workflow taught in CITS3403.

**Next steps (Checkpoint 3):**
- Implement Flask routes and Jinja2 templates for each page
- Set up SQLite database with SQLAlchemy models (User, Beat, Like, Follow, Purchase)
- Connect upload form to backend file storage
- Implement AJAX-based like and follow actions in the feed
- Add Flask-Login for session management and Flask-WTF for CSRF-protected forms
