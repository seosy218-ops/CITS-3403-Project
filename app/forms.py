from flask_wtf import FlaskForm
from wtforms import FloatField, IntegerField, StringField, PasswordField, SubmitField, SelectField
from wtforms.validators import DataRequired, Email, EqualTo, Length, NumberRange, Optional

class SignupForm(FlaskForm):
    username = StringField('Username', validators=[DataRequired(), Length(min=3, max=64)])
    email = StringField('Email', validators=[DataRequired(), Email(), Length(max=120)])
    password = PasswordField('Password', validators=[DataRequired(), Length(min=6)])
    confirm_password = PasswordField(
        'Confirm Password',
        validators=[DataRequired(), EqualTo('password', message='Passwords must match')]
    )
    role = SelectField(
        'Role',
        choices=[('listener', 'Listener'), ('producer', 'Producer')],
        validators=[DataRequired()]
    )
    submit = SubmitField('Sign Up')


class LoginForm(FlaskForm):
    email = StringField('Email', validators=[DataRequired(), Email(), Length(max=120)])
    password = PasswordField('Password', validators=[DataRequired()])
    submit = SubmitField('Log In')

class UploadBeatForm(FlaskForm):
    title = StringField('Title', validators=[DataRequired(), Length(max=128)])
    genre = StringField('Genre', validators=[Optional(), Length(max=64)])
    bpm = IntegerField('BPM', validators=[Optional(), NumberRange(min=1, max=300)])
    key = StringField('Key', validators=[Optional(), Length(max=16)])
    mood_tag = StringField('Mood Tag', validators=[Optional(), Length(max=64)])
    licence_type = SelectField(
        'Licence Type',
        choices=[('Non-exclusive', 'Non-exclusive'), ('Exclusive', 'Exclusive')],
        validators=[Optional()]
    )
    price = FloatField('Price', validators=[DataRequired(), NumberRange(min=0)])
    audio_url = StringField('Audio File Path', validators=[DataRequired(), Length(max=256)])
    cover_url = StringField('Cover Image Path', validators=[Optional(), Length(max=256)])
    submit = SubmitField('Upload Beat')

class SearchForm(FlaskForm):
    query = StringField('Search', validators=[Optional(), Length(max=128)])
    search_type = SelectField(
        'Search Type',
        choices=[('all', 'All'), ('beats', 'Beats'), ('producers', 'Producers')],
        default='all'
    )
    genre = StringField('Genre', validators=[Optional(), Length(max=64)])
    submit = SubmitField('Search')