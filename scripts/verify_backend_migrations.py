"""Replay application migrations in a disposable database without resetting local data."""
from pathlib import Path
import json
import re
import subprocess
import uuid

ROOT=Path(__file__).resolve().parents[1]

def main():
    database='motivance_verify_'+uuid.uuid4().hex
    assert re.fullmatch(r'motivance_verify_[0-9a-f]{32}',database)
    def docker(*args,sql=None):
        result=subprocess.run(['docker','exec','-i','supabase_db_motivance',*args],input=sql,text=True,capture_output=True)
        if result.returncode: raise RuntimeError(result.stderr)
        return result.stdout
    docker('createdb','-U','postgres',database)
    try:
        # Auth schema/functions are infrastructure; copy definitions only, never accounts.
        auth=docker('pg_dump','-U','postgres','-d','postgres','--schema-only','--schema=auth','--no-owner','--no-privileges')
        # Triggers on auth tables that call application functions are recreated by the migrations after those functions exist.
        auth=re.sub(r'(?m)^CREATE TRIGGER [^;]*EXECUTE FUNCTION public\.[^;]*;\n','',auth)
        assert 'public.on_user_created()' not in auth and 'public.on_email_confirmed()' not in auth
        def execute(sql): return docker('psql','-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1',sql='set search_path=public,extensions,auth;\n'+sql)
        execute('create schema extensions; create extension pgcrypto with schema extensions;\n'+auth+'\ngrant usage on schema auth,extensions to anon,authenticated;')
        # pg_cron can only be created in the postgres database, so this one stands in for its schedule function and records the jobs.
        execute("""create schema cron; create table cron.job(jobid bigserial primary key,jobname text unique,schedule text not null,command text not null);
create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language sql as $$
 insert into cron.job(jobname,schedule,command) values(p_name,p_schedule,p_command) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid $$;""")
        migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))
        for migration in migrations:
            execute(migration.read_text(encoding='utf-8').replace('create extension if not exists pg_cron with schema pg_catalog;','-- pg_cron is replaced by the stand-in above.'))
        jobs=[line.split('|',1) for line in execute('select jobname,command from cron.job order by jobname;').splitlines() if '|' in line]
        assert len(jobs)>=6,jobs
        # Planning each job's command proves it names functions that exist with those arguments, without running it.
        for _,command in jobs: execute('explain '+command)
        execute((ROOT/'supabase/seed.sql').read_text(encoding='utf-8'))
        result=execute((ROOT/'supabase/tests/access_policies.test.sql').read_text(encoding='utf-8'))
        assert '1..18' in result and not re.search(r'(?m)^not ok',result),result
        report={'fresh_application_schema':True,'copied_auth_schema_only':True,'copied_accounts':False,
                'migrations':[p.name for p in migrations],'scheduled_jobs_resolved':[name for name,_ in jobs],'foundation_sql_tests_passed':18,'exit_code':0,
                'main_local_database_reset':False}
        (ROOT/'docs/validation/backend-clean-build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print('Fresh application migrations, catalogue seed and 18 SQL tests passed; main local data preserved.')
    finally:
        docker('dropdb','-U','postgres',database)

if __name__=='__main__': main()
