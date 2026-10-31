"""Build from a fresh source copy without local properties or existing outputs."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]

def main():
    scratch=ROOT/'tmp'
    scratch.mkdir(exist_ok=True)
    clean=Path(tempfile.mkdtemp(prefix='sprint-1-clean-',dir=scratch)).resolve()
    if not clean.is_relative_to(scratch.resolve()): raise RuntimeError('Unexpected clean-build path')
    shutil.copytree(ROOT/'android',clean/'android',ignore=shutil.ignore_patterns('build','.gradle','local.properties','.env','.env.*'))
    assert not (clean/'android'/'.env').exists()
    env=os.environ.copy()
    env.pop('SUPABASE_URL',None); env.pop('SUPABASE_PUBLISHABLE_KEY',None)
    env.pop('ANDROID_SUPABASE_URL',None)
    env['ANDROID_HOME']=env.get('ANDROID_HOME') or str(Path.home()/'AppData/Local/Android/Sdk')
    wrapper=str(clean/'android'/('gradlew.bat' if os.name=='nt' else 'gradlew'))
    command=[wrapper,':app:assembleDebug',':app:lintDebug',':app:testDebugUnitTest',':core:assessment:test','--no-daemon']
    if os.name!='nt': command=['bash',*command]
    with (clean/'build.log').open('w',encoding='utf-8') as log:
        result=subprocess.run(command,cwd=clean/'android',env=env,stdout=log,stderr=subprocess.STDOUT)
    report={'exit_code':result.returncode,'fresh_source_copy':True,'copied_local_properties':False,'supabase_config_supplied':False,'command':':app:assembleDebug :app:lintDebug :app:testDebugUnitTest :core:assessment:test --no-daemon','log':str((clean/'build.log').relative_to(ROOT)).replace('\\','/')}
    (ROOT/'docs/validation/clean-android-build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print('Clean-source Android build exit:',result.returncode)
    if result.returncode: print('See',report['log'])
    raise SystemExit(result.returncode)

if __name__=='__main__': main()
