"""Tests that all key page routes return expected HTTP status codes."""
from tests.conftest import login, logout


PUBLIC_ROUTES = [
    '/login',
    '/register',
    '/discover',
    '/feed',
    '/search',
]

PROTECTED_ROUTES = [
    '/upload',
    '/profile/edit',
]


class TestPublicRoutes:
    def test_root_redirects(self, client):
        r = client.get('/', follow_redirects=False)
        assert r.status_code == 302

    def test_public_pages_load(self, client):
        for path in PUBLIC_ROUTES:
            r = client.get(path)
            assert r.status_code == 200, f'{path} returned {r.status_code}'


class TestProtectedRoutes:
    def test_unauthenticated_redirected(self, client):
        """Unauthenticated requests to protected pages must redirect to login."""
        logout(client)
        for path in PROTECTED_ROUTES:
            r = client.get(path, follow_redirects=False)
            assert r.status_code == 302, f'{path} should redirect unauthenticated users'
            assert '/login' in r.headers.get('Location', ''), f'{path} did not redirect to login'

    def test_authenticated_pages_load(self, client, seeded_db):
        login(client)
        for path in PROTECTED_ROUTES:
            r = client.get(path)
            assert r.status_code == 200, f'{path} returned {r.status_code} when authenticated'
        logout(client)


class TestBeatDetailRoute:
    def test_beat_detail_loads(self, client, seeded_db):
        beat_id = seeded_db['beat_id']
        r = client.get(f'/beats/{beat_id}')
        assert r.status_code == 200

    def test_beat_detail_404_for_missing_beat(self, client):
        r = client.get('/beats/999999')
        assert r.status_code == 404


class TestProfileRoute:
    def test_profile_loads_by_id(self, client, seeded_db):
        user_id = seeded_db['user_id']
        r = client.get(f'/profile/{user_id}')
        assert r.status_code == 200

    def test_profile_404_for_missing_user(self, client):
        r = client.get('/profile/999999')
        assert r.status_code == 404


class TestSearchRoute:
    def test_search_empty_query_loads(self, client):
        r = client.get('/search')
        assert r.status_code == 200

    def test_search_with_query(self, client, seeded_db):
        r = client.get('/search?q=Test')
        assert r.status_code == 200

    def test_search_with_genre_filter(self, client):
        r = client.get('/search?genre=hip-hop')
        assert r.status_code == 200
