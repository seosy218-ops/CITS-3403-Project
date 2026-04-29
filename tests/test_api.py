"""Tests for the JSON API endpoints: like, save, follow, play, feed."""
import json
from tests.conftest import login, logout


class TestUnauthenticatedAPI:
    def test_like_requires_auth(self, client, seeded_db):
        logout(client)
        r = client.post(f'/api/beats/{seeded_db["beat_id"]}/like')
        assert r.status_code == 401
        data = json.loads(r.data)
        assert 'error' in data

    def test_save_requires_auth(self, client, seeded_db):
        logout(client)
        r = client.post(f'/api/beats/{seeded_db["beat_id"]}/save')
        assert r.status_code == 401

    def test_follow_requires_auth(self, client, seeded_db):
        logout(client)
        r = client.post(f'/api/producers/{seeded_db["user_id"]}/follow')
        assert r.status_code == 401


class TestLikeAPI:
    def test_like_toggle(self, client, seeded_db):
        login(client)
        beat_id = seeded_db['beat_id']

        r = client.post(f'/api/beats/{beat_id}/like')
        assert r.status_code == 200
        data = json.loads(r.data)
        assert 'liked' in data
        assert 'likes_count' in data
        first_liked = data['liked']

        r2 = client.post(f'/api/beats/{beat_id}/like')
        data2 = json.loads(r2.data)
        assert data2['liked'] != first_liked  # toggled
        logout(client)

    def test_like_missing_beat(self, client, seeded_db):
        login(client)
        r = client.post('/api/beats/999999/like')
        assert r.status_code == 404
        logout(client)


class TestSaveAPI:
    def test_save_toggle(self, client, seeded_db):
        login(client)
        beat_id = seeded_db['beat_id']

        r = client.post(f'/api/beats/{beat_id}/save')
        assert r.status_code == 200
        data = json.loads(r.data)
        assert 'saved' in data
        first_saved = data['saved']

        r2 = client.post(f'/api/beats/{beat_id}/save')
        data2 = json.loads(r2.data)
        assert data2['saved'] != first_saved
        logout(client)


class TestPlayAPI:
    def test_play_increments_count(self, client, seeded_db):
        beat_id = seeded_db['beat_id']
        r = client.post(f'/api/beats/{beat_id}/play')
        assert r.status_code == 200
        data = json.loads(r.data)
        assert 'play_count' in data
        assert 'counted' in data

    def test_play_deduplication(self, client, seeded_db):
        beat_id = seeded_db['beat_id']
        r1 = client.post(f'/api/beats/{beat_id}/play')
        r2 = client.post(f'/api/beats/{beat_id}/play')
        d1, d2 = json.loads(r1.data), json.loads(r2.data)
        # Second play within the dedup window must not be counted
        assert not d2['counted']


class TestFeedAPI:
    def test_feed_returns_json(self, client):
        r = client.get('/api/feed')
        assert r.status_code == 200
        data = json.loads(r.data)
        assert 'beats' in data
        assert 'has_next' in data
        assert 'page' in data

    def test_feed_page_param(self, client):
        r = client.get('/api/feed?page=1')
        assert r.status_code == 200


class TestCommentsAPI:
    def test_get_comments_returns_list(self, client, seeded_db):
        beat_id = seeded_db['beat_id']
        r = client.get(f'/api/beats/{beat_id}/comments')
        assert r.status_code == 200
        data = json.loads(r.data)
        assert 'comments' in data
        assert isinstance(data['comments'], list)

    def test_post_comment_requires_auth(self, client, seeded_db):
        logout(client)
        r = client.post(f'/api/beats/{seeded_db["beat_id"]}/comments',
                        json={'body': 'test comment'})
        assert r.status_code == 401

    def test_post_comment_creates_and_returns(self, client, seeded_db):
        login(client)
        beat_id = seeded_db['beat_id']
        r = client.post(f'/api/beats/{beat_id}/comments',
                        json={'body': 'Great beat!'})
        assert r.status_code == 201
        data = json.loads(r.data)
        assert data['body'] == 'Great beat!'
        assert data['beat_id'] == beat_id
        logout(client)

    def test_post_comment_empty_body_rejected(self, client, seeded_db):
        login(client)
        r = client.post(f'/api/beats/{seeded_db["beat_id"]}/comments',
                        json={'body': '   '})
        assert r.status_code == 400
        logout(client)

    def test_post_comment_too_long_rejected(self, client, seeded_db):
        login(client)
        r = client.post(f'/api/beats/{seeded_db["beat_id"]}/comments',
                        json={'body': 'x' * 501})
        assert r.status_code == 400
        logout(client)

    def test_like_comment_requires_auth(self, client, seeded_db):
        # Post a comment first so we have an ID to test against
        login(client)
        beat_id = seeded_db['beat_id']
        rc = client.post(f'/api/beats/{beat_id}/comments', json={'body': 'Like target'})
        comment_id = json.loads(rc.data)['id']
        logout(client)

        r = client.post(f'/api/comments/{comment_id}/like')
        assert r.status_code == 401

    def test_like_comment_toggle(self, client, seeded_db):
        login(client)
        beat_id = seeded_db['beat_id']
        rc = client.post(f'/api/beats/{beat_id}/comments', json={'body': 'Like me'})
        comment_id = json.loads(rc.data)['id']

        r = client.post(f'/api/comments/{comment_id}/like')
        assert r.status_code == 200
        data = json.loads(r.data)
        assert 'liked' in data
        assert 'likes_count' in data
        logout(client)

    def test_delete_comment_requires_auth(self, client, seeded_db):
        login(client)
        beat_id = seeded_db['beat_id']
        rc = client.post(f'/api/beats/{beat_id}/comments', json={'body': 'Delete me'})
        comment_id = json.loads(rc.data)['id']
        logout(client)

        r = client.delete(f'/api/comments/{comment_id}')
        assert r.status_code == 401

    def test_delete_comment_by_author(self, client, seeded_db):
        login(client)
        beat_id = seeded_db['beat_id']
        rc = client.post(f'/api/beats/{beat_id}/comments', json={'body': 'Temporary'})
        comment_id = json.loads(rc.data)['id']

        r = client.delete(f'/api/comments/{comment_id}')
        assert r.status_code == 200
        data = json.loads(r.data)
        assert data['deleted'] is True
        logout(client)
