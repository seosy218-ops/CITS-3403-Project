"""Tests for authentication flows: register, login, logout."""
from tests.conftest import login, logout


class TestRegister:
    def test_register_page_loads(self, client):
        r = client.get('/register')
        assert r.status_code == 200
        assert b'Register' in r.data or b'Sign up' in r.data or b'register' in r.data.lower()

    def test_register_creates_account(self, client, app):
        r = client.post('/register', data={
            'username': 'newuser',
            'email': 'newuser@example.com',
            'password': 'newpass123',
            'confirm_password': 'newpass123',
        }, follow_redirects=True)
        assert r.status_code == 200

    def test_register_duplicate_username_rejected(self, client, seeded_db):
        r = client.post('/register', data={
            'username': 'testuser',
            'email': 'other@example.com',
            'password': 'somepass',
            'confirm_password': 'somepass',
        }, follow_redirects=True)
        assert b'already' in r.data.lower()

    def test_register_duplicate_email_rejected(self, client, seeded_db):
        r = client.post('/register', data={
            'username': 'brandnew',
            'email': 'test@example.com',
            'password': 'somepass',
            'confirm_password': 'somepass',
        }, follow_redirects=True)
        assert b'already' in r.data.lower()


class TestLogin:
    def test_login_page_loads(self, client):
        r = client.get('/login')
        assert r.status_code == 200

    def test_login_valid_credentials(self, client, seeded_db):
        r = login(client)
        assert r.status_code == 200
        assert b'Logged in successfully' in r.data

    def test_login_wrong_password(self, client, seeded_db):
        logout(client)  # ensure clean anonymous state
        r = client.post('/login', data={
            'email': 'test@example.com',
            'password': 'wrongpass',
        }, follow_redirects=True)
        assert b'Invalid' in r.data or b'invalid' in r.data.lower()

    def test_login_unknown_email(self, client):
        logout(client)  # ensure clean anonymous state
        r = client.post('/login', data={
            'email': 'nobody@example.com',
            'password': 'anything',
        }, follow_redirects=True)
        assert b'Invalid' in r.data or b'invalid' in r.data.lower()


class TestLogout:
    def test_logout_redirects_to_login(self, client, seeded_db):
        login(client)
        r = client.get('/logout', follow_redirects=False)
        assert r.status_code == 302
        assert '/login' in r.headers.get('Location', '')

    def test_logout_requires_login(self, client):
        # Without an active session, /logout should redirect to login (not 500)
        r = client.get('/logout', follow_redirects=False)
        assert r.status_code == 302
        assert '/login' in r.headers.get('Location', '')
