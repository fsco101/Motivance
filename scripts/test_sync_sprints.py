"""Completion policy and GitHub reconciliation tests; never contact GitHub."""
import copy
import unittest

import sync_sprints as sync


class FakeGitHub:
    def __init__(self, config, sprints):
        self.calls=[]
        self.labels=copy.deepcopy(config['labels'])
        self.issues={1:{'number':1,'title':'Plan','state':'open','labels':[],'body':'Plan','milestone':{'number':5}}}
        self.milestones={i:{'number':i,'state':'open'} for i in range(1,6)}
        for s in sprints:
            for t in s['issues']:
                self.issues[t['github_issue']]={'number':t['github_issue'],'title':f"[{t['id']}] Task",'state':'open',
                    'labels':[],'body':'Human-authored baseline','milestone':{'number':s['github_milestone']}}

    def pages(self,path):
        return copy.deepcopy(list(self.issues.values()) if path.startswith('issues?') else
                             list(self.milestones.values()) if path.startswith('milestones?') else self.labels)

    def request(self,path,method='GET',data=None):
        collection,number=path.split('/')
        value=(self.issues if collection=='issues' else self.milestones)[int(number)]
        if method=='PATCH':
            self.calls.append((path,copy.deepcopy(data)))
            for key,item in data.items():
                value[key]=[{'name':label} for label in item] if key=='labels' else {'number':item} if key=='milestone' else item
        return copy.deepcopy(value)


def fixtures():
    labels=['type:task','area:planning','priority:p0']+[f'sprint:{i:02}' for i in range(1,6)]
    config={'schema_version':1,'plan_issue':1,'labels':[{'name':l,'color':'ffffff','description':l} for l in labels]}
    completion={'completed_at':'2026-10-31T08:00:00+00:00','reviewed_by':'Codex engineering evidence review','evidence':['docs/validation/SPRINT-04-HISTORY.md']}
    sprints=[]
    for i in range(1,6):
        task={'id':f'MOT-{i:02}','github_issue':i+1,'status':'planned','description':'Task','estimate_points':1,
              'labels':labels[:3]+[f'sprint:{i:02}'],'dependencies':[],'functions':[{'name':'entry','description':'Behavior'}],
              'target_paths':['docs/'],'completion':copy.deepcopy(completion),
              'acceptance_criteria':[{'description':'Engineering check','passed':True,'evidence':['docs/validation/SPRINT-04-HISTORY.md']}]}
        sprints.append({'schema_version':1,'id':f'S{i}','title':f'Sprint {i}','goal':'Goal','status':'in-progress',
                        'github_milestone':i,'total_estimate_points':1,'issues':[task],
                        'exit_criteria':[{'description':'Demo','passed':True,'evidence':['docs/validation/SPRINT-04-HISTORY.md']}],
                        'completion':copy.deepcopy(completion)})
    return config,sprints


def deferred():
    return {'description':'Unexecuted physical check','passed':False,'evidence':['docs/validation/SPRINT-04-HISTORY.md'],
            'deferred_to':'docs/validation/POST-IMPLEMENTATION-CHECKLIST.md','non_blocking':True,
            'deferral_authority':'User instruction: defer physical checks and close implemented work',
            'disposition':'Physical check remains unchecked in the follow-up checklist.'}


class SprintSyncTest(unittest.TestCase):
    def test_solved_issue_closes_before_its_sprint(self):
        config,sprints=fixtures();sprints[0]['issues'][0]['status']='done'
        api=FakeGitHub(config,sprints)
        sync.synchronize(config,sprints,api,True,'S1')
        self.assertEqual('closed',api.issues[2]['state'])
        self.assertEqual('open',api.milestones[1]['state'])
        self.assertTrue(api.issues[2]['body'].startswith('Human-authored baseline'))

    def test_explicit_deferred_closure_keeps_the_check_unchecked(self):
        config,sprints=fixtures();task=sprints[0]['issues'][0]
        task['status']='done';task['acceptance_criteria']=[deferred()]
        task['completion']['acceptance_basis']='engineering-implementation'
        api=FakeGitHub(config,sprints);sync.synchronize(config,sprints,api,True,'S1')
        self.assertEqual('closed',api.issues[2]['state'])
        self.assertIn('- [ ] Unexecuted physical check',api.issues[2]['body'])
        self.assertIn('not executed',api.issues[2]['body'])
        self.assertFalse(task['acceptance_criteria'][0]['passed'])

    def test_failed_engineering_check_cannot_close(self):
        config,sprints=fixtures();task=sprints[0]['issues'][0]
        task['status']='done';task['acceptance_criteria'][0]['passed']=False
        with self.assertRaises(ValueError):sync.validate(config,sprints)

    def test_incomplete_deferral_cannot_close(self):
        for missing in ['non_blocking','deferral_authority','disposition','deferred_to','evidence']:
            config,sprints=fixtures();task=sprints[0]['issues'][0]
            task['status']='done';criterion=deferred();criterion.pop(missing)
            task['acceptance_criteria']=[criterion];task['completion']['acceptance_basis']='engineering-implementation'
            with self.subTest(missing=missing),self.assertRaises(ValueError):sync.validate(config,sprints)

    def test_deferred_closure_requires_an_explicit_implementation_basis(self):
        config,sprints=fixtures();task=sprints[0]['issues'][0]
        task['status']='done';task['acceptance_criteria']=[deferred()]
        with self.assertRaises(ValueError):sync.validate(config,sprints)

    def test_dependency_implementation_must_have_evidence(self):
        config,sprints=fixtures();task=sprints[1]['issues'][0]
        task['status']='done';task['dependencies']=['MOT-01']
        with self.assertRaises(ValueError):sync.validate(config,sprints)
        dependency=sprints[0]['issues'][0];dependency['implementation_status']='implemented'
        with self.assertRaises(ValueError):sync.validate(config,sprints)
        dependency['implementation_evidence']=['docs/validation/SPRINT-04-HISTORY.md']
        sync.validate(config,sprints)

    def test_completed_sprint_closes_milestone_and_rerun_is_idempotent(self):
        config,sprints=fixtures();sprints[0]['status']='completed';sprints[0]['issues'][0]['status']='done'
        sprints[0]['exit_criteria']=[deferred()];sprints[0]['completion']['acceptance_basis']='engineering-implementation'
        api=FakeGitHub(config,sprints);sync.synchronize(config,sprints,api,True,'S1')
        self.assertEqual('closed',api.milestones[1]['state'])
        self.assertIn('remain unexecuted',api.milestones[1]['description'])
        self.assertEqual([],sync.synchronize(config,sprints,api,True,'S1'))

    def test_open_extra_milestone_issue_keeps_the_milestone_open(self):
        config,sprints=fixtures();sprints[0]['status']='completed';sprints[0]['issues'][0]['status']='done'
        api=FakeGitHub(config,sprints)
        api.issues[99]={'number':99,'state':'open','milestone':{'number':1}}
        sync.synchronize(config,sprints,api,True,'S1')
        self.assertEqual('open',api.milestones[1]['state'])

    def test_remote_closed_local_unfinished_conflict_blocks_all_writes(self):
        config,sprints=fixtures();api=FakeGitHub(config,sprints);api.issues[2]['state']='closed'
        with self.assertRaises(ValueError):sync.synchronize(config,sprints,api,True)
        self.assertEqual([],api.calls)

    def test_dry_run_does_not_change_github(self):
        config,sprints=fixtures();sprints[0]['issues'][0]['status']='done'
        api=FakeGitHub(config,sprints);sync.synchronize(config,sprints,api,False,'S1')
        self.assertEqual([],api.calls);self.assertEqual('open',api.issues[2]['state'])


if __name__=='__main__':unittest.main()
