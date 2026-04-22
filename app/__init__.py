import click
from flask import Flask
from flask_login import LoginManager
from app.config import Config


def create_app(config_class=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_class)

    from app.models import db
    db.init_app(app)

    login_manager = LoginManager()
    login_manager.init_app(app)
    login_manager.login_view = 'main.login'
    login_manager.login_message = 'Please sign in to access that page.'
    login_manager.login_message_category = 'info'

    @login_manager.user_loader
    def load_user(user_id):
        from app.models import User
        return User.query.get(int(user_id))

    from app.routes import main
    app.register_blueprint(main)

    with app.app_context():
        db.create_all()

    @app.cli.command('seed-db')
    def seed_db():
        """Populate the database with sample producers and beats."""
        from app.models import User, Beat

        if User.query.first():
            click.echo('Database already seeded. Delete tunefeed.db to start fresh.')
            return

        producers_data = [
            ('metro_nova',   'metro@tunefeed.io',  'Trap and drill producer out of Atlanta. Heavy 808s, dark melodies.', 'Trap'),
            ('cloud_harbor', 'cloud@tunefeed.io',  'Lo-fi and chillhop for late-night sessions. Samples vinyl exclusively.', 'Lo-Fi'),
            ('echo_frame',   'echo@tunefeed.io',   'Cinematic drill with orchestral layers and punchy percussion.', 'Drill'),
            ('solar_vibe',   'solar@tunefeed.io',  'Afrobeats and R&B fusion. West African roots, global sound.', 'Afrobeats'),
        ]

        beats_data = [
            ('Midnight Ritual',  'Trap',      140, 'A minor', 29.99, 'Non-exclusive', 0),
            ('Paper Route',      'Drill',     145, 'D minor', 49.99, 'Non-exclusive', 0),
            ('Rainfall Study',   'Lo-Fi',      85, 'D minor', 14.99, 'Non-exclusive', 1),
            ('Ocean Drive',      'Lo-Fi',      78, 'G major', 12.99, 'Non-exclusive', 1),
            ('Lagos Sunset',     'Afrobeats', 105, 'G minor', 34.99, 'Non-exclusive', 3),
            ('Concrete Steps',   'Boom Bap',   92, 'C minor', 24.99, 'Non-exclusive', 2),
            ('Ghost Protocol',   'Trap',      138, 'F minor', 44.99, 'Exclusive',     0),
            ('Neon Drift',       'Drill',     148, 'E minor', 39.99, 'Non-exclusive', 2),
        ]

        producers = []
        for username, email, bio, _ in producers_data:
            user = User(username=username, email=email, role='producer', bio=bio)
            user.set_password('password123')
            db.session.add(user)
            producers.append(user)

        listener = User(username='demo_listener', email='demo@tunefeed.io', role='listener')
        listener.set_password('password123')
        db.session.add(listener)

        db.session.flush()

        for i, (title, genre, bpm, key, price, licence, prod_idx) in enumerate(beats_data):
            beat = Beat(
                title=title,
                genre=genre,
                bpm=bpm,
                key=key,
                price=price,
                licence_type=licence,
                audio_url=f'/static/audio/sample_{i + 1}.mp3',
                play_count=(8 - i) * 1400 + i * 200,
                producer_id=producers[prod_idx].id,
            )
            db.session.add(beat)

        db.session.commit()
        click.echo(f'Seeded {len(producers)} producers, 1 listener, and {len(beats_data)} beats.')
        click.echo('Demo accounts: metro@tunefeed.io / password123  |  demo@tunefeed.io / password123')

    return app
