"""Fail if Android/SDK types leak into pure Kotlin core modules."""
from pathlib import Path
import re

root=Path(__file__).resolve().parents[1]
errors=[]
for path in (root/'android/core').rglob('*.kt'):
    for line in path.read_text(encoding='utf-8').splitlines():
        if re.match(r'\s*import\s+(android\.|androidx\.|com\.google\.mediapipe\.|okhttp3\.|io\.github\.jan\.)',line):
            errors.append(f'{path.relative_to(root)}: {line}')
if errors:
    raise SystemExit('\n'.join(errors))
print('Core domain and assessment contain no platform, camera or backend SDK imports.')
