#!/usr/bin/env python3
"""Fails when an administrator database function is not called by both apps, or is missing from the parity matrix."""
import argparse
import re
from pathlib import Path

STATEMENT = re.compile(r'\b(create(?:\s+or\s+replace)?|drop)\s+function\s+(?:if\s+exists\s+)?public\.(admin_\w+)', re.IGNORECASE)


def read(root, pattern, skip=()):
    return '\n'.join(path.read_text(encoding='utf-8') for path in sorted(root.glob(pattern))
                     if path.is_file() and not any(part in path.relative_to(root).as_posix() for part in skip))


def current_functions(root):
    """Replays the migrations in order, so a function dropped later is no longer required."""
    functions = set()
    for action, name in STATEMENT.findall(read(root, 'supabase/migrations/*.sql')):
        (functions.discard if action.lower() == 'drop' else functions.add)(name)
    return sorted(functions)


def gaps(root):
    functions = current_functions(root)
    android = read(root, 'android/app/src/main/java/**/*.kt')
    # Sample data and generated types mention these names without calling them.
    web = read(root, 'web/src/**/*.ts*', skip=('web/src/gallery/', 'database.types', '.test.'))
    matrix_path = root / 'docs/architecture/ADMIN-PARITY.md'
    matrix = matrix_path.read_text(encoding='utf-8') if matrix_path.exists() else ''
    problems = []
    for name in functions:
        if not re.search(rf'rpc/{name}\b', android):
            problems.append(f'{name} is not called by Android')
        if f"rpc('{name}'" not in web:
            problems.append(f'{name} is not called by the web app')
        if f'`{name}`' not in matrix:
            problems.append(f'{name} is not in docs/architecture/ADMIN-PARITY.md')
    return functions, problems


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    functions, problems = gaps(parser.parse_args().root)
    if not functions:
        raise SystemExit('No admin_* functions found. Check the migrations path.')
    if problems:
        raise SystemExit('Administrator features must ship to both apps in the same change:\n- ' + '\n- '.join(problems))
    print(f'{len(functions)} administrator functions are called by Android and the web app, and are in the matrix.')


if __name__ == '__main__':
    main()
