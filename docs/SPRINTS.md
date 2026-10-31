# Sprint planning and synchronization

The numbered JSON files contain the authoritative editable backlog for the ten-week Motivance implementation. Each sprint JSON includes goals, a demo, entry/exit criteria, estimates, risks and six mapped issues with function descriptions. Function names describe planned capabilities, not existing application code.

```text
sprints/
  config.json
  sprint-01.json
  sprint-02.json
  sprint-03.json
  sprint-04.json
  sprint-05.json
```

The feature-complete MVP is targeted for week 8; weeks 9-10 cover final validation, fixes, deployment and handover. Confirm three to four contributors and therapist availability. Estimates are provisional points, not elapsed days; reserve approximately 20% of actual capacity for integration and defects. Calendar dates and owners remain unset until confirmed.

`config.json` defines the repository, central plan issue, label catalogue and sprint paths. Edit current progress only in the sprint JSON files. The application folder structure, database and dependency decisions are maintained in [PLAN.md](PLAN.md).

## Completing a sprint

1. Confirm owners, dependencies and demo; change the sprint status to `in-progress`.
2. Update each issue status: `planned`, `in-progress`, `blocked`, `review` or `done`. Record actual blockers in GitHub.
3. For completed work, set every acceptance criterion's `passed` to `true` and add evidence such as PR URLs, test runs or reviewed reports. Fill issue `completion.completed_at` (ISO 8601 with timezone), `reviewed_by` and `evidence`. Mark it `done` only after acceptance; dependencies must also be done.
4. When all six issues and the demo pass, record evidence for every sprint exit criterion and fill the sprint completion record. Set the sprint status to `completed`.
5. Validate, preview and push reviewed JSON changes to `main`. The workflow syncs descriptions and labels, closes completed-sprint issues, then closes the milestone when all its issues are closed. The central plan closes after all five sprints finish.

```powershell
python scripts/sync_sprints.py --validate-only
python scripts/sync_sprints.py --sprint S1
python scripts/sync_sprints.py --sprint S1 --apply
```

The second command is read-only preview. The third applies changes using the authenticated GitHub CLI account. Omit `--sprint` for all sprints. Only Python's standard library and `gh` are needed. Relevant pushes to `main` or manual workflow dispatch trigger automatic sync; local edits alone do not.

## Labels and reconciliation

- `type:*` identifies feature, task, spike, validation or epic.
- `area:*` identifies the main component.
- `priority:p0` is release-critical; `priority:p1` is required supporting work; `priority:p2` is optional/deferred.
- `sprint:01` through `sprint:05` provide searchable grouping alongside milestones.
- `status:*` is derived from issue status. A done issue remains open until its whole sprint is completed.

Sync replaces its marked section inside each issue while preserving human-authored text elsewhere and labels outside the managed categories. The marked acceptance record is the current progress record; the original issue text remains the planning baseline. Sync never posts comments, deletes issues or reopens closed work. Remote-closed/local-unfinished conflicts stop all writes for manual reconciliation. A successful rerun is idempotent; partial API failures can be retried.

Completion validation verifies the presence of evidence, not its truth. The reviewer must assess adequacy. Store only de-identified evidence references; never place credentials or patient-identifying records in these files or public issues. Do not mark a sprint complete to move unfinished work out of view: explicitly replan its issue and milestone.
