"""Reject APKs whose selectable ABIs lack the MediaPipe vision runtime."""
import argparse
from pathlib import Path
import zipfile

ROOT=Path(__file__).resolve().parents[1]
def check(path):
    with zipfile.ZipFile(path) as archive:
        names=set(archive.namelist())
    abis=sorted({n.split('/')[1] for n in names if n.startswith('lib/') and n.endswith('.so')})
    if not abis: raise ValueError('APK has no native runtime')
    missing=[abi for abi in abis if f'lib/{abi}/libmediapipe_tasks_vision_jni.so' not in names]
    if missing: raise ValueError('MediaPipe JNI missing for selectable ABI: '+', '.join(missing))
    return abis

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk',nargs='?',type=Path,default=ROOT/'android/app/build/outputs/apk/debug/app-debug.apk')
    print('Complete MediaPipe native runtime for: '+', '.join(check(parser.parse_args().apk)))
