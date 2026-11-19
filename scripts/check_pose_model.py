"""Checks that the Android and web copies of the pose model are the file recorded in docs/validation/pose-model.json."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / 'docs/validation/pose-model.json'


def main() -> None:
    record = json.loads(RECORD.read_text(encoding='utf-8'))
    problems = []
    for key in ('asset', 'web_asset'):
        path = ROOT / record[key]
        if not path.is_file():
            problems.append(f'{record[key]} is missing')
            continue
        data = path.read_bytes()
        if len(data) != record['size_bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
            problems.append(f'{record[key]} is not the recorded model ({len(data)} bytes, sha256 {hashlib.sha256(data).hexdigest()})')
    if problems:
        sys.exit('\n'.join(problems))
    print(f"Android and web pose models match {record['upstream_version']} ({record['sha256'][:12]}...).")


if __name__ == '__main__':
    main()
