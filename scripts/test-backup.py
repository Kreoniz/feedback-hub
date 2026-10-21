#!/usr/bin/env python3
"""Restore a local backup into new databases; never overwrite the live database."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

root = Path(__file__).resolve().parent.parent
os.chdir(root)
docker = shutil.which('docker')
if not docker:
    raise SystemExit('Docker required')

def run(args, data=None):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout

container = run([docker, 'compose', 'ps', '-q', 'db']).decode().strip()
if not container:
    raise SystemExit('Start the local Compose stack first')

def pg(command, *args, data=None):
    return run([docker, 'exec', '-i', container, command, '-U', 'postgres', *args], data)

databases = ['feedback_restore_' + uuid.uuid4().hex[:12] for _ in range(2)]
created = []
try:
    # The current backup script selects its source from the app's URL-file mount.
    run(['bash', 'scripts/backup.sh'])
    original = max((root / '.local/backups').glob('*.dump'), key=lambda p: p.stat().st_mtime_ns)
    for database in databases:
        pg('createdb', '-O', 'feedback', database)
        created.append(database)
    pg('pg_restore', '-d', databases[0], '--no-owner', '--role=feedback', data=original.read_bytes())
    counts_sql = b'SELECT (SELECT count(*) FROM reports), (SELECT count(*) FROM votes);'
    original_counts = pg('psql', '-d', databases[0], '-At', data=counts_sql)
    pg('psql', '-d', databases[0], '-v', 'ON_ERROR_STOP=1', data=b"CREATE TABLE backup_probe(value text); INSERT INTO backup_probe VALUES('post-restore-marker');")
    with tempfile.TemporaryDirectory(prefix='backup-regression-', dir=root / '.local') as temporary:
        fixture = Path(temporary)
        (fixture / 'scripts').mkdir()
        (fixture / 'bin').mkdir()
        shutil.copy2(root / 'scripts/backup.sh', fixture / 'scripts/backup.sh')
        url = fixture / 'database_url'
        url.write_text(f'postgres://feedback@db:5432/{databases[0]}?sslmode=disable\n')
        config = {'services': {'app': {'environment': {'DATABASE_URL_FILE': '/run/secrets/database_url'}, 'volumes': [{'target': '/run/secrets/database_url', 'source': str(url)}]}}}
        # Adapt only Compose transport; execute the real backup/dump/list commands.
        adapter = fixture / 'bin/docker'
        adapter.write_text('#!/usr/bin/env python3\nimport json,os,sys\n'
            + f'config={config!r}\n'
            + "if sys.argv[1:]==['compose','config','--format','json']: print(json.dumps(config))\n"
            + "elif sys.argv[1:5]==['compose','exec','-T','db']:\n"
            + f" os.execv({docker!r},[{docker!r},'exec','-i',{container!r}]+sys.argv[5:])\n"
            + "else: raise SystemExit('Unsupported regression transport')\n")
        adapter.chmod(0o700)
        env = {**os.environ, 'PATH': str(fixture / 'bin') + os.pathsep + os.environ['PATH']}
        subprocess.run(['bash', str(fixture / 'scripts/backup.sh')], env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        after = next((fixture / '.local/backups').glob('*.dump'))
        pg('pg_restore', '-d', databases[1], '--no-owner', '--role=feedback', data=after.read_bytes())
        restored_counts = pg('psql', '-d', databases[1], '-At', data=counts_sql)
        marker = pg('psql', '-d', databases[1], '-At', data=b'SELECT value FROM backup_probe;').strip()
        assert original_counts == restored_counts, 'Report/vote counts changed during restore'
        assert marker == b'post-restore-marker', 'Next backup omitted post-restore data'
        archives = set((fixture / '.local/backups').glob('*.dump'))
        for selector in ('dbname','database','host','port','user'):
            url.write_text(f'postgres://feedback@db:5432/feedback?{selector}={databases[0]}&sslmode=disable\n')
            result = subprocess.run(['bash', str(fixture / 'scripts/backup.sh')], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            assert result.returncode != 0, f'Unsafe {selector} override accepted'
            assert set((fixture / '.local/backups').glob('*.dump')) == archives, 'Failed selector published a backup'
        print('PASS: restore, counts, selected path, post-restore backup, and fail-closed query overrides')
finally:
    for database in reversed(created):
        pg('dropdb', database)
