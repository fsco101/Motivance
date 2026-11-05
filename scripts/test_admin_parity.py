#!/usr/bin/env python3
"""Proves the parity check catches each kind of gap, using small sample projects."""
import tempfile
from pathlib import Path

from check_admin_parity import gaps


def project(root, android=True, web=True, matrix=True, call='admin_thing'):
    files = {
        'supabase/migrations/1.sql': 'create function public.admin_thing() returns void',
        'android/app/src/main/java/App.kt': f'call("/rest/v1/rpc/{call}")' if android else '',
        'web/src/data/admin.ts': f"db.rpc('{call}')" if web else '',
        'docs/architecture/ADMIN-PARITY.md': '`admin_thing`' if matrix else '',
    }
    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')


def check(expected, **options):
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        project(root, **options)
        functions, problems = gaps(root)
    assert functions == ['admin_thing'], functions
    assert problems == expected, problems


check([])
check(['admin_thing is not called by Android'], android=False)
check(['admin_thing is not called by the web app'], web=False)
check(['admin_thing is not in docs/architecture/ADMIN-PARITY.md'], matrix=False)
check(['admin_thing is not called by Android', 'admin_thing is not called by the web app'], call='admin_other')

with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    project(root)
    gallery = root / 'web/src/gallery/routes.tsx'
    gallery.parent.mkdir(parents=True)
    gallery.write_text("db.rpc('admin_thing')", encoding='utf-8')
    (root / 'web/src/data/admin.ts').write_text('', encoding='utf-8')
    assert gaps(root)[1] == ['admin_thing is not called by the web app'], 'Sample data must not count as a call'

# A name that is only the start of a real call does not count as called.
check(['admin_thing is not called by Android', 'admin_thing is not called by the web app'], call='admin_things')

with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    project(root)
    (root / 'supabase/migrations/2.sql').write_text('drop function public.admin_thing();\nCREATE OR REPLACE FUNCTION public.admin_new() returns void', encoding='utf-8')
    functions, problems = gaps(root)
    assert functions == ['admin_new'], 'A dropped function stops being required, and capitals still count'
    assert len(problems) == 3, problems

with tempfile.TemporaryDirectory() as folder:
    root = Path(folder) / 'gallery' / 'Motivance'
    root.mkdir(parents=True)
    project(root)
    assert gaps(root)[1] == [], 'The checkout folder must not decide what is skipped'

print('The parity check catches every kind of gap.')
