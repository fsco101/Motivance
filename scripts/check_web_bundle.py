"""Checks the built web app: no secrets, no design gallery, and initial JavaScript within budget. Run after `npm run build`."""
import gzip
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'web/dist'
BUDGET_BYTES = 300 * 1024
# A publishable key is meant for browsers. Anything below is not.
SECRETS = {
    'service-role JWT': re.compile(r'eyJ[\w-]+\.[\w-]*c2VydmljZV9yb2xl[\w-]*\.[\w-]+'),
    'Supabase secret key': re.compile(r'sb_secret_[A-Za-z0-9_-]{8,}'),
    'service-role name': re.compile(r'SERVICE_ROLE_KEY'),
    'Cloudinary secret name': re.compile(r'CLOUDINARY_API_SECRET'),
}
# Sample people must never reach production.
GALLERY = ['Ana Dela Cruz', 'motivance web design review']


def main():
    if not DIST.is_dir():
        sys.exit('Run `npm run build` in web/ first.')
    problems = []
    files = [p for p in DIST.rglob('*') if p.is_file() and p.suffix in {'.js', '.css', '.html', '.map', '.json'}]
    for path in files:
        text = path.read_text(encoding='utf-8', errors='ignore')
        problems += [f'{name} found in {path.name}' for name, pattern in SECRETS.items() if pattern.search(text)]
        problems += [f'gallery content "{needle}" found in {path.name}' for needle in GALLERY if needle in text]
    html = (DIST / 'index.html').read_text(encoding='utf-8')
    initial = [DIST / ref.lstrip('/') for ref in re.findall(r'(?:src|href)="(/assets/[^"]+\.js)"', html)]
    total = sum(len(gzip.compress(path.read_bytes(), 9)) for path in initial)
    if total > BUDGET_BYTES:
        problems.append(f'initial JavaScript is {total / 1024:.0f} KB compressed, over the {BUDGET_BYTES / 1024:.0f} KB budget')
    if problems:
        sys.exit('\n'.join(problems))
    print(f'{len(files)} files clean; initial JavaScript {total / 1024:.0f} KB compressed of {BUDGET_BYTES / 1024:.0f} KB allowed.')


if __name__ == '__main__':
    main()
