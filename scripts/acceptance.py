#!/usr/bin/env python3
"""Black-box proxy/API acceptance on an explicitly local synthetic installation."""
import concurrent.futures
import http.cookiejar
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

base = os.environ.get('FEEDBACK_TEST_URL', 'http://localhost:18080').rstrip('/')
if urllib.parse.urlparse(base).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Acceptance is restricted to localhost synthetic data')
password_file = os.environ.get('FEEDBACK_TEST_PASSWORD_FILE', '.local/admin-password')
password = Path(password_file).read_text().strip()
marker = 'Проверка ' + uuid.uuid4().hex[:12]
checks = []

class Client:
    def __init__(self):
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def request(self, method, path, data=None, headers=None):
        h = {'Origin': base, **(headers or {})}
        body = None if data is None else json.dumps(data, ensure_ascii=False).encode()
        if body is not None:
            h['Content-Type'] = 'application/json'
        request = urllib.request.Request(base + path, data=body, headers=h, method=method)
        try:
            response = self.opener.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            payload = response.read()
            try:
                payload = json.loads(payload)
            except (ValueError, UnicodeDecodeError):
                payload = None
            return response.status, payload, response.headers

def require(condition, name):
    if not condition:
        raise AssertionError(name)
    checks.append(name)

public, admin, stranger = Client(), Client(), Client()
status, _, headers = public.request('GET', '/health/ready')
require(status == 200, 'PostgreSQL readiness')
require('object-src' in headers.get('Content-Security-Policy', ''), 'CSP present through Caddy')
require(stranger.request('GET', '/api/admin/reports')[0] == 401, 'Anonymous admin blocked')
status, login, _ = admin.request('POST', '/api/admin/login', {'password': password})
require(status == 200 and login.get('authenticated'), 'Owner login')
csrf = {'X-CSRF-Token': login['csrf_token']}
status, proof, headers = public.request('GET', '/api/form')
require(status == 200 and 'HttpOnly' in headers.get('Set-Cookie', ''), 'Signed HttpOnly visitor proof')
token = proof['token']
time.sleep(2.1)
feature = {'project': 'campus', 'type': 'feature', 'title': marker,
           'description': marker + ' — клавиатурная навигация', 'form_token': token}
bug = {'project': 'campus', 'type': 'bug', 'description': marker + ' — не открывается',
       'context': {'page_url': 'https://campus.kreoniz.ru/?token=private#secret', 'browser': 'Firefox'},
       'form_token': token}
require(public.request('POST', '/api/reports', feature)[0] == 201, 'Anonymous feature accepted')
require(public.request('POST', '/api/reports', bug)[0] == 201, 'Description-only bug accepted')
status, result, _ = public.request('POST', '/api/reports', feature)
require(status == 201 and not result['duplicate'], 'Dedupe does not disclose private existence')
require(public.request('POST', '/api/reports', {**bug, 'website': 'bot'})[0] == 201, 'Honeypot non-disclosing response')
query = '?q=' + urllib.parse.quote(marker)
status, inbox, _ = admin.request('GET', '/api/admin/reports' + query)
require(status == 200 and inbox['total'] == 2, 'Dedupe and honeypot store no extra reports')
idea = next(x for x in inbox['items'] if x['type'] == 'feature')
problem = next(x for x in inbox['items'] if x['type'] == 'bug')
require('?' not in problem['context'].get('page_url', '') and '#' not in problem['context'].get('page_url', ''), 'Server strips sensitive URL parts')
require(public.request('GET', '/api/features' + query)[1]['total'] == 0, 'Pending features and private bugs hidden')
path = '/api/admin/reports/' + idea['id']
require(admin.request('PATCH', path, {'moderation': 'approved'})[0] == 403, 'Admin CSRF token required')
require(admin.request('PATCH', path, {'moderation': 'approved'}, {**csrf, 'Origin': 'https://evil.example'})[0] == 403, 'Foreign Origin blocked')
require(admin.request('PATCH', path, {'moderation': 'approved'}, csrf)[0] == 200, 'Feature moderation')
status, updated, _ = admin.request('PATCH', '/api/admin/reports/' + problem['id'], {'priority': 'critical', 'information': 'sparse'}, csrf)
require(status == 200 and updated['priority'] == 'critical' and updated['information'] == 'sparse', 'Sparse report can be critical')
require(admin.request('PATCH', '/api/admin/reports/' + problem['id'], {'moderation': 'approved'}, csrf)[0] == 400, 'Bug cannot become public')
status, board, _ = public.request('GET', '/api/features' + query)
require(status == 200 and board['total'] == 1, 'Only approved feature public')
require(not set(board['items'][0]).intersection({'context', 'details', 'priority', 'admin_note', 'moderation'}), 'Public projection excludes private fields')
vote_path = '/api/features/' + idea['id'] + '/vote'
require(public.request('POST', vote_path, {})[1]['votes'] == 1, 'Anonymous vote accepted')
# Concurrent identical cookies exercise DB uniqueness through the real proxy.
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    votes = list(pool.map(lambda _: public.request('POST', vote_path, {}), range(4)))
require(all(s == 200 and data['votes'] == 1 for s, data, _ in votes), 'Concurrent repeat votes remain one')
stranger.request('GET', '/api/form')
require(stranger.request('POST', vote_path, {})[0] == 429, 'Cookie reset cannot bypass network cooldown')
require(public.request('POST', '/api/features/' + problem['id'] + '/vote', {})[0] == 404, 'Private bug cannot receive public votes')
require(public.request('POST', '/api/reports', {**bug, 'description': 'x' * 40000})[0] in (400, 413), 'Oversized request blocked')
# Distinct attacker XFF values must not evade the proxy's actual client-IP limiter.
responses = [stranger.request('GET', '/api/form', headers={'X-Forwarded-For': f'198.51.100.{i+1}'}) for i in range(24)]
require(any(s == 429 and h.get('Retry-After') for s, _, h in responses), 'Forged XFF cannot bypass API rate limit')
require(admin.request('POST', '/api/admin/logout', {}, csrf)[0] == 204, 'Owner logout')
require(admin.request('GET', '/api/admin/reports')[0] == 401, 'Logged-out session invalidated')
print(json.dumps({'passed': len(checks), 'checks': checks}, ensure_ascii=False, indent=2))
