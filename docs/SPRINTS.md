# Sprint planning and synchronization

The numbered JSON files contain the authoritative editable backlog for the ten-week Motivance implementation. Each sprint JSON includes goals, a demo, entry/exit criteria, estimates, risks and six mapped issues with function descriptions. Each function record indicates whether it describes a planned capability or an implemented entry point.

Per the user's standing instruction, close solved GitHub issues as part of implementation and close fully implemented sprint milestones. Individual issues do not wait for the rest of their sprint. Therapist and physical-device checks explicitly deferred by the user remain in `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`; they do not prevent engineering implementation closure and are never represented as passed clinical/device tests. Real engineering failures and unimplemented work stay open.

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
3. Record executed evidence and set `passed: true` only for checks actually passed. An explicitly user-deferred check stays `passed: false` and requires `non_blocking: true`, `deferral_authority`, `disposition`, `deferred_to` pointing to the follow-up checklist and evidence of the delivered implementation. Deferred closure also requires `completion.acceptance_basis: engineering-implementation`. Fill `completion.completed_at` (ISO 8601 with timezone), `reviewed_by` and `evidence`; name Codex accurately when it performs the engineering evidence review rather than inventing human approval. Set a solved issue to `done` and sync its closure immediately.
4. Dependencies must be done, or their delivered implementation must be explicitly recorded as `implementation_status: implemented` with `implementation_evidence`. This permits a solved dependent feature to close while a separately tracked CI acceptance failure remains open; it does not close the failing dependency. When every sprint issue is done, record its engineering exit/demo evidence, preserve any explicitly deferred physical demo as unchecked using the same fields, fill sprint completion and set `completed`.
5. Validate, preview and apply the reviewed JSON to GitHub in the same work session. Push local changes through the user's chosen Git workflow. Once published, pushes to `develop` or `main` and manual dispatch run the sync workflow. It closes each solved issue independently, closes completed sprint milestones only when all milestone issues are closed, and closes the central plan after all five sprints finish.

```powershell
python scripts/sync_sprints.py --validate-only
python scripts/sync_sprints.py --sprint S1
python scripts/sync_sprints.py --sprint S1 --apply
```

The second command is read-only preview. The third applies changes using the authenticated GitHub CLI account. Omit `--sprint` for all sprints. Only Python's standard library and `gh` are needed. Run `python -m unittest discover -s scripts -p test_sync_sprints.py` after changing reconciliation logic. Local edits alone do not update GitHub; use `--apply` or publish the configured workflow.

## Labels and reconciliation

- `type:*` identifies feature, task, spike, validation or epic.
- `area:*` identifies the main component.
- `priority:p0` is release-critical; `priority:p1` is required supporting work; `priority:p2` is optional/deferred.
- `sprint:01` through `sprint:05` provide searchable grouping alongside milestones.
- `status:*` is derived from issue status. A done issue closes after its own evidence validates, even while its sprint is in progress.

Sync replaces its marked section inside each issue while preserving human-authored text elsewhere and labels outside the managed categories. The marked acceptance record is the current progress record; the original issue text remains the planning baseline. Sync never posts comments, deletes issues or reopens closed work. Remote-closed/local-unfinished conflicts stop all writes for manual reconciliation. A successful rerun is idempotent; partial API failures can be retried.

Completion validation verifies the presence of evidence and explicit deferral records, not their truth. The reviewer must assess adequacy. Store only de-identified evidence references; never place credentials or patient-identifying records in these files or public issues. Do not mark a sprint complete to move unfinished implementation or failed engineering checks out of view. An implementation closure is not clinical validation, production deployment or completion of the separate follow-up checklist.
