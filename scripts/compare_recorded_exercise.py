"""Compare the web and Android measurements of the same recorded exercise (#141).

The web regression (web/tests/e2e/recorded-exercise.spec.ts) draws the recording into web/test-videos/recorded-exercise and
measures it in the browser (web.json). This pushes the same JPEG frames to an Android device, runs RecordedExerciseTest there
(the phone's MediaPipe and Kotlin engine), pulls android.json back, and compares the two against criteria declared before the
first run:

* the same number of counted repetitions on each side;
* session range of motion within 5 degrees on each side;
* on frames both apps measured, a mean absolute elbow-angle difference of at most 5 degrees.

Use a throwaway emulator (docs/operations/DEVELOPMENT.md, "Live tests without touching a working emulator") and set
ANDROID_SERIAL, or pass --serial. --skip-android compares an android.json that is already there.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FOLDER = ROOT / 'web' / 'test-videos' / 'recorded-exercise'
PACKAGE = 'com.motivance.debug'
RUNNER = f'{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner'
TEST = 'com.motivance.feature.exercise.RecordedExerciseTest'
LIMITS = {'range_degrees': 5.0, 'angle_mad_degrees': 5.0}


def run(command, **options):
    print('>', ' '.join(str(part) for part in command), flush=True)
    return subprocess.run(command, check=True, **options)


def android(serial):
    adb = ['adb', '-s', serial]
    gradle = ROOT / 'android' / ('gradlew.bat' if os.name == 'nt' else 'gradlew')
    run([str(gradle), ':app:assembleDebug', ':app:assembleDebugAndroidTest', '--console=plain'], cwd=ROOT / 'android')
    outputs = ROOT / 'android' / 'app' / 'build' / 'outputs' / 'apk'
    run(adb + ['install', '-r', '-t', str(outputs / 'debug' / 'app-debug.apk')])
    run(adb + ['install', '-r', '-t', str(outputs / 'androidTest' / 'debug' / 'app-debug-androidTest.apk')])
    # Files adb pushes into the app's external folder belong to the shell, which the app cannot read. They go to the shell's
    # own folder instead, and run-as copies them into the app's private files, where the test reads them.
    staging = '/data/local/tmp/recorded-exercise'
    run(adb + ['shell', 'rm', '-rf', staging])
    run(adb + ['shell', 'mkdir', '-p', staging])
    frames = sorted((FOLDER / 'frames').glob('frame-*.jpg'))
    # One push of the folder's contents is much faster than a push per frame.
    run(adb + ['push', str(FOLDER / 'frames') + os.sep + '.', staging])
    run(adb + ['shell', f"run-as {PACKAGE} sh -c 'rm -rf files/recorded-exercise; mkdir -p files/recorded-exercise && cp {staging}/*.jpg files/recorded-exercise/'"])
    result = run(adb + ['shell', 'am', 'instrument', '-w', '-e', 'recorded', 'true', '-e', 'class', TEST, RUNNER], capture_output=True, text=True)
    print(result.stdout)
    if 'OK (1 test)' not in result.stdout:
        sys.exit('RecordedExerciseTest did not pass')
    pulled = run(adb + ['exec-out', 'run-as', PACKAGE, 'cat', 'files/recorded-exercise/android.json'], capture_output=True)
    (FOLDER / 'android.json').write_bytes(pulled.stdout)
    run(adb + ['shell', 'rm', '-rf', staging])
    print(f'{len(frames)} frames measured on {serial}')


def compare():
    web = json.loads((FOLDER / 'web.json').read_text(encoding='utf-8'))
    phone = json.loads((FOLDER / 'android.json').read_text(encoding='utf-8'))
    report = {'limits': LIMITS, 'web_delegate': web['delegate'], 'android_delegate': phone['delegate'], 'sides': []}
    passed = True
    for w, a in zip(web['sides'], phone['sides']):
        both = [(x, y) for x, y in zip(w['readings'], a['readings']) if x is not None and y is not None]
        mad = sum(abs(x - y) for x, y in both) / len(both) if both else None
        worst = max((abs(x - y) for x, y in both), default=None)
        range_gap = abs(w['romDegrees'] - a['romDegrees']) if w['romDegrees'] is not None and a['romDegrees'] is not None else None
        side = {
            'side': w['side'],
            'web': {'completed': w['completed'], 'incomplete': w['incomplete'], 'rom': w['romDegrees'], 'ready_frames': sum(r is not None for r in w['readings'])},
            'android': {'completed': a['completed'], 'incomplete': a['incomplete'], 'rom': a['romDegrees'], 'ready_frames': sum(r is not None for r in a['readings'])},
            'frames_both_ready': len(both), 'angle_mad': mad, 'angle_worst': worst, 'range_gap': range_gap,
        }
        side['pass'] = (w['completed'] == a['completed'] and range_gap is not None and range_gap <= LIMITS['range_degrees']
                        and mad is not None and mad <= LIMITS['angle_mad_degrees'])
        passed = passed and side['pass']
        report['sides'].append(side)
    report['pass'] = passed
    (FOLDER / 'comparison.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    for s in report['sides']:
        print(f"{s['side']}: web {s['web']['completed']} reps, {s['web']['rom']:.1f} deg; android {s['android']['completed']} reps, "
              f"{s['android']['rom']:.1f} deg; range gap {s['range_gap']:.2f}; angle MAD {s['angle_mad']:.2f} (worst {s['angle_worst']:.2f}) "
              f"over {s['frames_both_ready']} frames; {'pass' if s['pass'] else 'FAIL'}")
    return passed


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--serial', default=os.environ.get('ANDROID_SERIAL'))
    parser.add_argument('--skip-android', action='store_true')
    options = parser.parse_args()
    if not (FOLDER / 'web.json').exists():
        sys.exit('Run the web regression first: cd web; npx playwright test recorded-exercise --workers=1')
    if not options.skip_android:
        if not options.serial:
            sys.exit('Set ANDROID_SERIAL or pass --serial, for a throwaway emulator')
        android(options.serial)
    sys.exit(0 if compare() else 1)


if __name__ == '__main__':
    main()
