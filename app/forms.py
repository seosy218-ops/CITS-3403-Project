"""WTForms definitions for auth, profile, search, and beat upload flows."""

from flask_wtf import FlaskForm
from wtforms import FloatField, IntegerField, StringField, PasswordField, SubmitField, SelectField, TextAreaField
from wtforms.validators import DataRequired, Email, EqualTo, Length, NumberRange, Optional, URL


class SignupForm(FlaskForm):
    """Registration form for new accounts."""
    username = StringField('Username', validators=[DataRequired(), Length(min=3, max=64)])
    email    = StringField('Email',    validators=[DataRequired(), Email(), Length(max=120)])
    password = PasswordField('Password', validators=[DataRequired(), Length(min=6)])
    confirm_password = PasswordField('Confirm Password', validators=[
        DataRequired(), EqualTo('password', message='Passwords must match')
    ])
    submit = SubmitField('Create Account')


class LoginForm(FlaskForm):
    """Email/password sign-in form."""
    email    = StringField('Email',    validators=[DataRequired(), Email(), Length(max=120)])
    password = PasswordField('Password', validators=[DataRequired()])
    submit   = SubmitField('Log In')


class UploadBeatForm(FlaskForm):
    """Producer beat upload form including optional multi-tier pricing."""
    title        = StringField('Title',       validators=[DataRequired(), Length(max=128)])
    genre        = StringField('Genre',       validators=[Optional(), Length(max=64)])
    bpm          = IntegerField('BPM',        validators=[Optional(), NumberRange(min=1, max=300)])
    key          = StringField('Key',         validators=[Optional(), Length(max=16)])
    mood_tag     = StringField('Mood Tag',    validators=[Optional(), Length(max=64)])
    licence_type = SelectField('Licence Type',
        choices=[('Non-exclusive', 'Non-exclusive'), ('Premium Lease', 'Premium Lease'), ('Exclusive', 'Exclusive')],
        validators=[Optional()]
    )
    price           = FloatField('Basic Lease Price',     validators=[DataRequired(), NumberRange(min=0)])
    premium_price   = FloatField('Premium License Price', validators=[Optional(), NumberRange(min=0)])
    exclusive_price = FloatField('Exclusive Rights Price', validators=[Optional(), NumberRange(min=0)])
    audio_url = StringField('Audio File URL', validators=[DataRequired(), Length(max=256)])
    cover_url = StringField('Cover Image URL', validators=[Optional(), Length(max=256)])
    submit    = SubmitField('Upload Beat')


class SearchForm(FlaskForm):
    """Cross-entity search form for beats and producers."""
    query       = StringField('Search',      validators=[Optional(), Length(max=128)])
    search_type = SelectField('Search Type',
        choices=[('all', 'All'), ('beats', 'Beats'), ('producers', 'Producers')],
        default='all'
    )
    genre  = StringField('Genre', validators=[Optional(), Length(max=64)])
    submit = SubmitField('Search')


class EditProfileForm(FlaskForm):
    """Profile edit form (bio text only)."""
    bio = TextAreaField('Bio', validators=[Optional(), Length(max=300)])
    submit = SubmitField('Save Bio')
