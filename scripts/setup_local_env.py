"""Create ignored android/.env using Supabase's public client configuration."""
import json
import os
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]

def main():
    command=['npx.cmd' if os.name=='nt' else 'npx','--yes','supabase@2.20.12','status','-o','json']
    result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',check=True)
    status=json.loads(result.stdout)
    endpoint=status['API_URL'].rstrip('/')
    if endpoint not in ['http://127.0.0.1:54321','http://localhost:54321']:
        raise RuntimeError('Only local development configuration may be generated automatically')
    path=ROOT/'android'/'.env'
    old=path.read_text(encoding='utf-8') if path.exists() else ''
    for line in old.splitlines():
        if line.startswith('SUPABASE_URL=') and line.split('=',1)[1].strip() not in ['',endpoint,'http://localhost:54321','http://127.0.0.1:54321']:
            raise RuntimeError('Existing .env targets another backend; refusing to overwrite it')
    values={'SUPABASE_URL':endpoint,'ANDROID_SUPABASE_URL':'http://10.0.2.2:54321','SUPABASE_PUBLISHABLE_KEY':status['ANON_KEY']}
    preserved=[line for line in old.splitlines() if not any(line.startswith(key+'=') for key in values)]
    text='\n'.join(preserved).rstrip()+'\n' if preserved else '# Generated local development configuration; ignored by Git.\n'
    text+='\n'.join(f'{key}={value}' for key,value in values.items())+'\n'
    path.write_text(text,encoding='utf-8')
    if os.name!='nt': path.chmod(0o600)
    print('Configured ignored android/.env for local Supabase and Android emulator; no privileged keys stored.')

if __name__=='__main__': main()
