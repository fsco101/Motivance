"""Validate sprint records and reconcile GitHub. Dry-run unless --apply is supplied."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
STATUSES = {'planned', 'in-progress', 'blocked', 'review', 'done'}
START, END = '<!-- motivance-sprint:start -->', '<!-- motivance-sprint:end -->'

def require(condition, message):
    if not condition:
        raise ValueError(message)

def evidence(value):
    return isinstance(value, list) and bool(value) and all(isinstance(v,str) and v.strip() for v in value)

def completion(record, context):
    require(isinstance(record,dict), f'{context}: missing completion record')
    require(isinstance(record.get('reviewed_by'),str) and record['reviewed_by'].strip(), f'{context}: reviewer required')
    require(evidence(record.get('evidence')), f'{context}: evidence required')
    try:
        timestamp = datetime.fromisoformat(record['completed_at'].replace('Z','+00:00'))
        require(timestamp.tzinfo is not None, f'{context}: timestamp must include timezone')
    except (KeyError, TypeError, AttributeError):
        raise ValueError(f'{context}: valid completed_at timestamp required')

def validate(config, sprints):
    require(config['schema_version']==1, 'Unsupported config version')
    require(len(sprints)==5, 'Expected five sprint files')
    keys, numbers, milestones = {}, set(), set()
    labels={l['name'] for l in config['labels']}
    for s in sprints:
        require(s['schema_version']==1, 'Unsupported sprint version')
        require(s['status'] in {'planned','in-progress','completed'}, f"{s['id']}: invalid status")
        require(s['github_milestone'] not in milestones, 'Duplicate milestone')
        milestones.add(s['github_milestone'])
        require(bool(s['issues']), 'Empty sprint')
        require(s['total_estimate_points']==sum(t['estimate_points'] for t in s['issues']), 'Point total mismatch')
        for t in s['issues']:
            require(t['id'] not in keys and t['github_issue'] not in numbers, 'Duplicate issue mapping')
            keys[t['id']] = t
            numbers.add(t['github_issue'])
            require(t['status'] in STATUSES, f"{t['id']}: invalid status")
            require(set(t['labels']) <= labels, f"{t['id']}: unknown label")
            require(all(sum(l.startswith(prefix) for l in t['labels'])==1 for prefix in ['type:','area:','priority:','sprint:']), f"{t['id']}: exactly one label per category required")
            require(not any(l.startswith('status:') for l in t['labels']), 'Status label is generated from status')
            require(t['functions'] and all(f['name'] and f['description'] for f in t['functions']), 'Function descriptions required')
            require(t['acceptance_criteria'], 'Acceptance criteria required')
            require(all(type(c['passed']) is bool for c in t['acceptance_criteria']), 'Acceptance passed must be boolean')
            if t['status']=='done':
                require(all(c['passed'] and evidence(c['evidence']) for c in t['acceptance_criteria']), f"{t['id']}: acceptance evidence incomplete")
                completion(t['completion'],t['id'])
        if s['status']=='completed':
            require(all(t['status']=='done' for t in s['issues']), f"{s['id']}: unfinished issues")
            require(s['exit_criteria'] and all(c['passed'] is True and evidence(c['evidence']) for c in s['exit_criteria']), f"{s['id']}: exit evidence incomplete")
            completion(s['completion'],s['id'])
    def visit(key, path):
        require(key not in path, f'Dependency cycle: {path} -> {key}')
        for d in keys[key]['dependencies']:
            require(d in keys, f'{key}: unknown dependency {d}')
            visit(d,path+[key])
    for k,t in keys.items():
        visit(k,[])
        if t['status']=='done': require(all(keys[d]['status']=='done' for d in t['dependencies']), f'{k}: unfinished dependency')
    return keys

class GitHub:
    def __init__(self,repo): self.base=f'repos/{repo}'
    def request(self,path,method='GET',data=None):
        args=['gh','api',f'{self.base}/{path}','--method',method]
        if data is not None: args+=['--input','-']
        p=subprocess.run(args,input=json.dumps(data) if data is not None else None,text=True,encoding='utf-8',capture_output=True)
        if p.returncode: raise RuntimeError(p.stderr.strip())
        return json.loads(p.stdout) if p.stdout.strip() else None
    def pages(self,path):
        result=[]
        for page in range(1,10000):
            rows=self.request(f'{path}{"&" if "?" in path else "?"}per_page=100&page={page}')
            result.extend(rows)
            if len(rows)<100: return result
        raise RuntimeError('Pagination limit reached')

def managed_body(body, section):
    body=body or ''
    require(body.count(START)==body.count(END) and body.count(START)<=1, 'Malformed managed body markers')
    block=f'{START}\n{section.strip()}\n{END}'
    if START in body:
        require(body.index(START)<body.index(END),'Reversed managed markers')
        return body[:body.index(START)]+block+body[body.index(END)+len(END):]
    return body.rstrip()+'\n\n'+block

def issue_section(s,t,keys):
    text=f"## Sprint function details\n\n{s['title']} — {s['goal']}\n\n{t['description']}\n\nLocal status: **{t['status']}**. Estimate: {t['estimate_points']} points.\n\n"
    text+='\n'.join(f"- **{f['name']}**: {f['description']}" for f in t['functions'])
    text+='\n\nArchitecture, database and Kotlin dependencies: `docs/PLAN.md`.'
    if t.get('blockers'):
        text+='\n\n### Remaining acceptance work\n\n'+'\n'.join('- '+b for b in t['blockers'])
    text+='\n\nTarget paths: '+', '.join(f'`{p}`' for p in t['target_paths'])
    text+='\n\nDependencies: '+(', '.join(f"#{keys[d]['github_issue']} ({d})" for d in t['dependencies']) or 'None')
    text+='\n\n### Acceptance record\n\n'+'\n'.join(f"- [{'x' if c['passed'] else ' '}] {c['description']}"+(' Evidence: '+'; '.join(c['evidence']) if c['evidence'] else '') for c in t['acceptance_criteria'])
    if t['status']=='done': text+=f"\n\nReviewed by: {t['completion']['reviewed_by']} at {t['completion']['completed_at']}.\n\nEvidence: "+'; '.join(t['completion']['evidence'])
    return text+'\n\nSource: `sprints/sprint-'+s['id'][1:].zfill(2)+'.json`. Issue closure occurs only after completed-sprint validation.'

def synchronize(config,sprints,api,apply=False,selected=None):
    keys=validate(config,sprints)
    remote={r['number']:r for r in api.pages('issues?state=all') if 'pull_request' not in r}
    milestones={m['number']:m for m in api.pages('milestones?state=all')}
    existing_labels={l['name']:l for l in api.pages('labels')}
    # Preflight all identities and remote conflicts before the first mutation.
    for s in sprints:
        require(s['github_milestone'] in milestones,'Missing GitHub milestone')
        for t in s['issues']:
            r=remote.get(t['github_issue'])
            require(r is not None and r['title'].startswith(f"[{t['id']}] "),f"{t['id']}: remote issue identity mismatch")
            require(not (r['state']=='closed' and t['status']!='done'),f"{t['id']}: remote is closed but local is unfinished; reconcile manually")
            managed_body(r.get('body'),issue_section(s,t,keys))
        require(not (milestones[s['github_milestone']]['state']=='closed' and s['status']!='completed'), f"{s['id']}: milestone closed but local incomplete")
    require(config['plan_issue'] in remote,'Plan issue missing')
    changes=[]
    def change(path,method,data,description):
        changes.append(description)
        print(('APPLY ' if apply else 'DRY RUN ')+description,flush=True)
        if apply: return api.request(path,method,data)
    for label in config['labels']:
        old=existing_labels.get(label['name'])
        if old is None: change('labels','POST',label,f"create label {label['name']}")
        elif any(old.get(k)!=label[k] for k in ['color','description']):
            from urllib.parse import quote
            change('labels/'+quote(label['name'],safe=''),'PATCH',label,f"update label {label['name']}")
    selected_sprints=[s for s in sprints if selected is None or s['id']==selected]
    require(selected_sprints,'Unknown sprint selection')
    for s in selected_sprints:
        for t in s['issues']:
            r=remote[t['github_issue']]
            # Preserve labels outside managed categories, including future custom labels.
            labels={l['name'] for l in r['labels'] if not l['name'].startswith(('type:','area:','priority:','sprint:','status:'))}
            labels.update(t['labels']); labels.add('status:'+t['status'])
            desired={'body':managed_body(r.get('body'),issue_section(s,t,keys)),'labels':sorted(labels),'milestone':s['github_milestone']}
            patch={k:v for k,v in desired.items() if (sorted(l['name'] for l in r['labels']) if k=='labels' else (r.get('milestone') or {}).get('number') if k=='milestone' else r.get(k))!=v}
            if s['status']=='completed' and r['state']!='closed': patch.update(state='closed',state_reason='completed')
            if patch:
                change(f"issues/{t['github_issue']}",'PATCH',patch,f"update #{t['github_issue']} ({', '.join(patch)})")
                if apply:
                    check=api.request(f"issues/{t['github_issue']}")
                    require(all((sorted(l['name'] for l in check['labels']) if k=='labels' else (check.get('milestone') or {}).get('number') if k=='milestone' else check.get(k))==v for k,v in patch.items()),'Issue readback mismatch')
                    remote[t['github_issue']]=check
                else:
                    r.update({k:v for k,v in patch.items() if k in ['state','state_reason']})
    all_done=all(s['status']=='completed' for s in sprints)
    if all_done and all(remote[t['github_issue']]['state']=='closed' for s in sprints for t in s['issues']):
        if remote[config['plan_issue']]['state']!='closed':
            change(f"issues/{config['plan_issue']}",'PATCH',{'state':'closed','state_reason':'completed'},'close implementation plan')
            remote[config['plan_issue']]['state']='closed'
    for s in selected_sprints:
        if s['status']=='completed' and milestones[s['github_milestone']]['state']!='closed':
            members=[r for r in remote.values() if (r.get('milestone') or {}).get('number')==s['github_milestone']]
            if all(r['state']=='closed' for r in members):
                change(f"milestones/{s['github_milestone']}",'PATCH',{'state':'closed'},f"close milestone {s['id']}")
            else: print(f"KEEP OPEN {s['id']}: another milestone issue remains open",flush=True)
    return changes

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--apply',action='store_true'); p.add_argument('--validate-only',action='store_true')
    p.add_argument('--sprint',choices=['S1','S2','S3','S4','S5'])
    args=p.parse_args()
    config=json.loads((ROOT/'sprints/config.json').read_text())
    sprints=[json.loads((ROOT/'sprints'/f).read_text()) for f in config['files']]
    validate(config,sprints)
    if args.validate_only:
        print('Validated 5 sprints, 30 issues and dependency/completion records.'); return
    changes=synchronize(config,sprints,GitHub(config['repository']),args.apply,args.sprint)
    print(f'{len(changes)} changes '+('applied.' if args.apply else 'planned; no GitHub writes.'))

if __name__=='__main__': main()
