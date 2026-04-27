"""
TuneFeed — Sample database seeder.
Run from the project root:  python seed.py

Creates sample producers, beats (BeatStars-inspired data), likes,
comments, and replies so every feed feature can be tested immediately.
Drops and recreates all tables on each run.
"""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timedelta
import random

from app import create_app
from app.models import db, User, Beat, Like, Comment

random.seed(42)

# ---------------------------------------------------------------------------
# Producer accounts
# ---------------------------------------------------------------------------

PRODUCERS = [
    {
        "username": "MetroPhantom",
        "email": "metro@tunefeed.io",
        "password": "password123",
        "bio": "Trap & Melodic Hip-Hop producer. 8+ years crafting cinematic soundscapes.",
        "avatar_url": "https://api.dicebear.com/9.x/avataaars/svg?seed=metro",
    },
    {
        "username": "CxidBlooded",
        "email": "cxid@tunefeed.io",
        "password": "password123",
        "bio": "Lo-Fi & Chill beats. Perfect for late-night study sessions and creative flow.",
        "avatar_url": "https://api.dicebear.com/9.x/avataaars/svg?seed=cxid",
    },
    {
        "username": "BasslineKing",
        "email": "bassline@tunefeed.io",
        "password": "password123",
        "bio": "UK Drill & Grime. Hard-hitting 808s and razor-sharp hi-hats.",
        "avatar_url": "https://api.dicebear.com/9.x/avataaars/svg?seed=bass",
    },
    {
        "username": "SynthWave",
        "email": "synth@tunefeed.io",
        "password": "password123",
        "bio": "Synthwave & Retrowave specialist. 80s-inspired neon sonic worlds.",
        "avatar_url": "https://api.dicebear.com/9.x/avataaars/svg?seed=synth",
    },
    {
        "username": "AfrobeatsLab",
        "email": "afro@tunefeed.io",
        "password": "password123",
        "bio": "Afrobeats, Amapiano & Dancehall. Authentic African sounds for the world stage.",
        "avatar_url": "https://api.dicebear.com/9.x/avataaars/svg?seed=afro",
    },
    {
        "username": "JazzFusion",
        "email": "jazz@tunefeed.io",
        "password": "password123",
        "bio": "Jazz, Funk & Soul production. Smooth grooves that hit differently.",
        "avatar_url": "https://api.dicebear.com/9.x/avataaars/svg?seed=jazz",
    },
    {
        "username": "TechnoVortex",
        "email": "techno@tunefeed.io",
        "password": "password123",
        "bio": "Techno & House music. Hypnotic loops and pulsing rhythms for the dancefloor.",
        "avatar_url": "https://api.dicebear.com/9.x/avataaars/svg?seed=techno",
    },
    {
        "username": "SoulSmoke",
        "email": "soul@tunefeed.io",
        "password": "password123",
        "bio": "R&B & Soul beats with deep grooves. Emotion first, technique second.",
        "avatar_url": "https://api.dicebear.com/9.x/avataaars/svg?seed=soul",
    },
    {
        "username": "PhonkDealer",
        "email": "phonk@tunefeed.io",
        "password": "password123",
        "bio": "Memphis Phonk & Dark Trap. Distorted 808s and eerie samples.",
        "avatar_url": "https://api.dicebear.com/9.x/avataaars/svg?seed=phonk",
    },
]

# Demo listener account for testing interactions
DEMO_USER = {
    "username": "DemoUser",
    "email": "demo@tunefeed.io",
    "password": "password123",
    "bio": "Just here to discover fire beats.",
    "avatar_url": "https://api.dicebear.com/9.x/avataaars/svg?seed=demo",
}

# ---------------------------------------------------------------------------
# Beat catalogue  — BeatStars-inspired realistic data
# (title, prod_idx, genre, bpm, key, mood_tag, duration, licence,
#  lease_price, premium_price, exclusive_price, plays, is_trending, days_ago)
# ---------------------------------------------------------------------------

BEATS = [
    # CORS_AUDIO cycles: position % 11 selects the audio file.
    # Beats are ordered so every 11th position reuses the same audio, and
    # the BPM / genre / key are matched to the actual audio character.
    #
    # (title, prod, genre, bpm, key, mood, dur, licence, lease, premium, excl, plays, trending, days_ago)

    # pos 0 / 11 / 22 → viper.mp3  (energetic electronic ~130 BPM)
    ("Phantom Nights",       0, "Trap",       130, "C Min",  "Dark",       "3:24", "Non-exclusive",  29.99,  79.99, 299.99,    9, True,   2),
    # pos 1 / 12 / 23 → rave_digger.mp3  (rave / EDM ~140 BPM)
    ("Drift Mode",           8, "Phonk",      140, "D Min",  "Aggressive", "2:58", "Non-exclusive",  14.99,  39.99, 149.99,   12, True,   1),
    # pos 2 / 13 / 24 → outfoxing.mp3  (upbeat jazz / folk ~110 BPM)
    ("Smooth Jazz Nights",   5, "Jazz",       110, "F Maj",  "Smooth",     "4:12", "Non-exclusive",  17.99,  44.99, 179.99,    6, False,  5),
    # pos 3 / 14 / 25 → 80s_vibe.mp3  (synthwave ~120–124 BPM)
    ("Neon Retrograde",      3, "Synthwave",  120, "F# Maj", "Nostalgic",  "3:45", "Non-exclusive",  24.99,  64.99, 249.99,   11, True,   2),
    # pos 4 / 15 / 26 → bassguitar.mp3  (bass groove ~105–108 BPM)
    ("Soul Voyage",          7, "R&B",        105, "G Min",  "Smooth",     "3:42", "Non-exclusive",  18.99,  47.99, 189.99,   10, True,   1),
    # pos 5 / 16 / 27 → running_out.mp3  (energetic ~125 BPM)
    ("UK Drill Energy",      2, "Drill",      125, "D Min",  "Aggressive", "3:12", "Non-exclusive",  22.99,  59.99, 229.99,    7, False,  4),
    # pos 6 / 17 / 28 → drums.mp3  (drum groove ~120 BPM)
    ("Cold Pavement",        2, "Drill",      120, "C Min",  "Dark",       "3:05", "Exclusive",      29.99,  74.99, 299.99,    4, True,   1),
    # pos 7 / 18 / 29 → leadguitar.mp3  (rock guitar ~128–130 BPM)
    ("Haunted Highway",      8, "Phonk",      130, "A Min",  "Dark",       "3:12", "Non-exclusive",  14.99,  39.99, 149.99,   11, True,   2),
    # pos 8 / 19 / 30 → horns.mp3  (brass / afro ~110–112 BPM)
    ("Amapiano Sunrise",     4, "Amapiano",   112, "A Min",  "Smooth",     "3:24", "Non-exclusive",  19.99,  49.99, 199.99,   10, True,   1),
    # pos 9 / 20 / 31 → clav.mp3  (funky clavinet ~95–96 BPM)
    ("Midnight Coffee",      1, "Lo-Fi",       96, "A Min",  "Chill",      "2:45", "Non-exclusive",  12.99,  34.99, 129.99,    5, False, 21),
    # pos 10 / 21 / 32 → rnb-lofi-melody-loop.wav  (R&B lo-fi ~78–85 BPM)
    ("Chill Vibes Study",    1, "Lo-Fi",        85, "A Min",  "Chill",     "2:58", "Non-exclusive",  14.99,  39.99, 149.99,   13, True,   1),

    # ── Second cycle (positions 11–21) ────────────────────────────────────────
    ("Melodic Trap Flow",    0, "Trap",       128, "B Min",  "Emotional",  "3:18", "Non-exclusive",  24.99,  64.99, 249.99,    8, True,   5),
    ("Hellfire 808",         8, "Dark Trap",  142, "F Min",  "Aggressive", "2:45", "Exclusive",      24.99,  64.99, 249.99,    6, False,  9),
    ("Lagos Groove",         4, "Afrobeats",  112, "G Min",  "Energetic",  "3:33", "Non-exclusive",  19.99,  49.99, 199.99,   10, False,  3),
    ("Retrowave Drive",      3, "Synthwave",  122, "E Min",  "Energetic",  "4:02", "Non-exclusive",  22.99,  59.99, 229.99,    9, True,   6),
    ("Midnight Groove",      7, "Hip-Hop",    108, "C Min",  "Dark",       "3:35", "Non-exclusive",  19.99,  49.99, 199.99,    9, False,  4),
    ("Grime Cypher",         2, "Drill",      126, "A Min",  "Energetic",  "3:28", "Non-exclusive",  21.99,  54.99, 219.99,    5, False,  9),
    ("Bass Cathedral",       6, "Techno",     122, "A Maj",  "Dark",       "4:10", "Non-exclusive",  21.99,  54.99, 219.99,    8, False,  6),
    ("Memphis Nights",       8, "Phonk",      128, "C Min",  "Dark",       "3:05", "Non-exclusive",  14.99,  39.99, 149.99,    9, False,  5),
    ("Lagos Sunset",         4, "Amapiano",   110, "G Min",  "Smooth",     "3:41", "Non-exclusive",  19.99,  49.99, 199.99,    8, False, 10),
    ("Velvet Dreams",        7, "R&B",         96, "Eb Maj", "Romantic",   "3:55", "Premium Lease",  22.99,  54.99, 229.99,    4, False, 13),
    ("Deep Focus",           1, "Lo-Fi",        80, "C Maj", "Ambient",    "3:05", "Non-exclusive",  14.99,  39.99, 149.99,   11, True,   3),

    # ── Third cycle (positions 22–32) ─────────────────────────────────────────
    ("Dark Skyline",         0, "Hip-Hop",    130, "C Min",  "Aggressive", "3:15", "Exclusive",      34.99,  89.99, 349.99,    3, False, 12),
    ("Hypnotic Pulse",       6, "Techno",     140, "D Maj",  "Energetic",  "4:22", "Non-exclusive",  21.99,  54.99, 219.99,    9, True,   2),
    ("Funk Laboratory",      5, "Funk",       108, "Bb Maj", "Energetic",  "3:56", "Non-exclusive",  17.99,  44.99, 179.99,    7, False,  8),
    ("Club Frequency",       6, "House",      124, "F# Min", "Energetic",  "4:35", "Non-exclusive",  19.99,  49.99, 199.99,    7, False, 11),
    ("Afro Love",            4, "Afrobeats",  107, "D Min",  "Romantic",   "3:15", "Non-exclusive",  17.99,  44.99, 179.99,    4, False, 16),
    ("Block Politics",       2, "Grime",      126, "G Min",  "Aggressive", "3:18", "Non-exclusive",  19.99,  49.99, 199.99,    2, False, 14),
    ("Retro Pulse",          3, "Synthwave",  125, "F# Maj", "Energetic",  "3:52", "Non-exclusive",  24.99,  64.99, 249.99,   10, False,  8),
    ("Neon Aura",            0, "Hip-Hop",    128, "G Maj",  "Chill",      "3:42", "Premium Lease",  19.99,  49.99, 199.99,    3, False, 22),
    ("Soul Journey",         5, "R&B",        108, "G Min",  "Emotional",  "3:48", "Premium Lease",  22.99,  54.99, 219.99,    3, False, 19),
    ("Digital Sunset",       3, "Synthwave",   95, "B Min",  "Chill",      "4:15", "Premium Lease",  19.99,  49.99, 199.99,    3, False, 22),
    ("Rainy Afternoon",      1, "Lo-Fi",        78, "F Maj", "Nostalgic",  "3:22", "Non-exclusive",  12.99,  34.99, 129.99,    9, False,  7),
]

# ---------------------------------------------------------------------------
# Sample comments and replies — tests the full comment system
# ---------------------------------------------------------------------------

COMMENTS = [
    # (beat_title, author_username, body, replies: [(username, body)])
    ("Phantom Nights", "DemoUser",   "This hits different at 2am 🔥 need the stems ASAP",
     [("CxidBlooded", "Facts, the melody is insane on this one"),
      ("MetroPhantom", "Glad you like it! DM me for custom orders")]),
    ("Phantom Nights", "SoulSmoke",  "The 808 slide at 1:20 is perfect. Copping the exclusive",
     [("MetroPhantom", "Appreciate that! Exclusive is still available 🙏")]),
    ("Chill Vibes Study", "DemoUser", "Been listening to this on loop for 3 hours straight, no cap",
     [("CxidBlooded", "That's exactly what it was made for 🎧"),
      ("PhonkDealer", "Bro same this whole pack is crazy")]),
    ("Drift Mode", "BasslineKing", "The distorted 808 is INSANE. Memphis phonk is back fr",
     [("PhonkDealer", "Always been back 😤 we just louder now"),
      ("DemoUser",    "Copped this yesterday, already got a verse on it"),
      ("SynthWave",   "Not my genre but I respect the craft on this one")]),
    ("Amapiano Sunrise", "JazzFusion", "The piano chops are immaculate. Love how you layered the log drum",
     [("AfrobeatsLab", "Spent 3 days on those chops 😅 glad it shows!")]),
    ("Neon Retrograde",  "TechnoVortex", "This gives me Drive OST vibes. Absolute cinema",
     [("SynthWave", "That's the biggest compliment you could give 🙏🏻"),
      ("DemoUser",  "Just listened with headphones and my mind is blown")]),
    ("Soul Voyage",  "MetroPhantom", "The chord progression on the bridge is elite. Clean mix too",
     [("SoulSmoke", "Thank you bro, spent a week on that mix")]),
    ("UK Drill Energy", "PhonkDealer", "The sample flip at the drop is cold. UK producers different",
     [("BasslineKing", "We built different out here 💪"),
      ("DemoUser",     "This goes hard in the whip no cap")]),
    ("Hypnotic Pulse", "AfrobeatsLab", "Put this on at a house party last week, the floor went CRAZY",
     [("TechnoVortex", "That's what I make it for 🔊 let's collab sometime")]),
    ("Lagos Groove", "DemoUser", "Afrobeats need more producers like this. Pure vibes only",
     [("AfrobeatsLab", "That means everything, thank you 🙏")]),
]


# ---------------------------------------------------------------------------
# Seed function
# ---------------------------------------------------------------------------

def seed():
    app = create_app()
    with app.app_context():
        print("Dropping and recreating all tables...")
        db.drop_all()
        db.create_all()

        now = datetime.utcnow()

        # ── Create demo listener ──
        demo = User(
            username=DEMO_USER["username"],
            email=DEMO_USER["email"],
            bio=DEMO_USER["bio"],
            avatar_url=DEMO_USER["avatar_url"],
        )
        demo.set_password(DEMO_USER["password"])
        db.session.add(demo)

        # ── Create producers ──
        producer_objs = []
        for p in PRODUCERS:
            u = User(
                username=p["username"],
                email=p["email"],
                bio=p["bio"],
                avatar_url=p["avatar_url"],
            )
            u.set_password(p["password"])
            db.session.add(u)
            producer_objs.append(u)

        db.session.flush()  # assigns IDs before creating beats

        # ── Create beats ──
        beat_map = {}  # title → Beat object (for linking comments)
        for row in BEATS:
            (title, prod_idx, genre, bpm, key, mood_tag,
             duration, licence, price, premium_price, exclusive_price,
             plays, is_trending, days_ago) = row

            # Spread upload dates across the last month for algorithm freshness testing
            uploaded = now - timedelta(days=days_ago, hours=random.randint(0, 23))

            # Remote audio needs permissive CORS headers so Web Audio can read it.
            CORS_AUDIO = [
                "https://raw.githubusercontent.com/mdn/webaudio-examples/main/audio-analyser/viper.mp3",
                "https://raw.githubusercontent.com/goldfire/howler.js/master/examples/player/audio/rave_digger.mp3",
                "https://raw.githubusercontent.com/mdn/webaudio-examples/main/audio-basics/outfoxing.mp3",
                "https://raw.githubusercontent.com/goldfire/howler.js/master/examples/player/audio/80s_vibe.mp3",
                "https://raw.githubusercontent.com/mdn/webaudio-examples/main/multi-track/bassguitar.mp3",
                "https://raw.githubusercontent.com/goldfire/howler.js/master/examples/player/audio/running_out.mp3",
                "https://raw.githubusercontent.com/mdn/webaudio-examples/main/multi-track/drums.mp3",
                "https://raw.githubusercontent.com/mdn/webaudio-examples/main/multi-track/leadguitar.mp3",
                "https://raw.githubusercontent.com/mdn/webaudio-examples/main/multi-track/horns.mp3",
                "https://raw.githubusercontent.com/mdn/webaudio-examples/main/multi-track/clav.mp3",
                "https://raw.githubusercontent.com/mdn/webaudio-examples/main/audio-buffer-source-node/loop/rnb-lofi-melody-loop.wav",
            ]
            audio_url = CORS_AUDIO[BEATS.index(row) % len(CORS_AUDIO)]
            cover_url = f"https://api.dicebear.com/9.x/shapes/svg?seed={title.replace(' ', '')}"

            beat = Beat(
                title=title,
                genre=genre,
                bpm=bpm,
                key=key,
                mood_tag=mood_tag,
                duration=duration,
                licence_type=licence,
                price=price,
                premium_price=premium_price,
                exclusive_price=exclusive_price,
                play_count=plays,
                is_trending=is_trending,
                uploaded_at=uploaded,
                producer_id=producer_objs[prod_idx].id,
                audio_url=audio_url,
                cover_url=cover_url,
            )
            db.session.add(beat)
            beat_map[title] = beat

        db.session.flush()

        # ── Seed likes — spread across beats and users so algorithm has signal ──
        all_users = [demo] + producer_objs
        max_plays = max(b.play_count for b in beat_map.values()) or 1
        for beat in beat_map.values():
            # Scale like probability 0.10–0.70 relative to the most-played beat
            # so popular beats still receive proportionally more likes.
            like_rate = 0.10 + (beat.play_count / max_plays) * 0.60
            for user in all_users:
                if user.id != beat.producer_id and random.random() < like_rate:
                    db.session.add(Like(user_id=user.id, beat_id=beat.id))

        db.session.flush()

        # ── Seed follows — create a social graph ──
        for i, producer in enumerate(producer_objs):
            # Each producer follows 2-4 other producers
            others = [p for j, p in enumerate(producer_objs) if j != i]
            for followed in random.sample(others, min(3, len(others))):
                producer.follow(followed)
            # Demo user follows everyone
            demo.follow(producer)

        db.session.flush()

        # ── Seed comments and replies ──
        for (beat_title, commenter_name, body, replies) in COMMENTS:
            beat = beat_map.get(beat_title)
            commenter = User.query.filter_by(username=commenter_name).first()
            if not beat or not commenter:
                continue

            parent_comment = Comment(
                beat_id=beat.id,
                author_id=commenter.id,
                body=body,
                created_at=now - timedelta(hours=random.randint(1, 72)),
            )
            db.session.add(parent_comment)
            db.session.flush()

            for (reply_username, reply_body) in replies:
                reply_author = User.query.filter_by(username=reply_username).first()
                if not reply_author:
                    continue
                reply = Comment(
                    beat_id=beat.id,
                    author_id=reply_author.id,
                    parent_id=parent_comment.id,
                    body=reply_body,
                    created_at=now - timedelta(hours=random.randint(0, 48)),
                )
                db.session.add(reply)

        db.session.commit()

        print("\nDatabase seeded successfully!")
        print("\n   Demo accounts:")
        print("   demo@tunefeed.io    / password123  (listener)")
        print("   metro@tunefeed.io   / password123  (MetroPhantom)")
        print("   phonk@tunefeed.io   / password123  (PhonkDealer)")
        print("   afro@tunefeed.io    / password123  (AfrobeatsLab)")
        print(f"\n   {len(BEATS)} beats across {len(set(b[2] for b in BEATS))} genres")
        print(f"   Likes, follows, and comments seeded for algorithm testing\n")


if __name__ == '__main__':
    seed()
