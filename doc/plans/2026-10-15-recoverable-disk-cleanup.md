# Recoverable disk cleanup — delivery state

## Outcome and boundaries

Automatically expire reproducible skill caches and finished isolated Git workspaces,
then restore them through normal use. Deliver two reviewed slices and verify actual
reclamation plus restoration on `paperclip.staging.paperclip.app`. Keep the current
storage architecture, unique work, and recovery data. Git restoration may depend
on upstream availability; skill restoration must use saved database bytes alone.

Apply dotta-kickoff, goal-poteto-style-definition, shorten-feedback-loop,
paperclip-feature-to-production, and test-it-for-real. Retain one deployment owner.

## Acceptance matrix

| Case | Required outcome |
| --- | --- |
| Old skill version, upstream unavailable | Identical restored bytes and executable modes |
| Current/active/unsettled skill version | Preserved through concurrent preparation and cleanup |
| Finished Git workspace/base, upstream advanced | Reopen at recorded commit and perform subsequent work |
| Unique files, live consumers, pending recovery | Skip cleanup |
| Restart/concurrent reopen/interrupted deletion | Recover safely and preserve lifecycle fencing |
| Upstream failure/cross-company access | Explicit failure or skip; no fallback or access widening |

## Delivery slices

1. Skill `__versions__` cache: one-hour inactivity, current/in-use protection,
   persistent access records, cross-process exclusion, hourly batches of 50.
2. Owned isolated Git workspace/base caches: 24-hour terminal-tree cooldown,
   verified exact-commit recipe before deletion, safe on-demand restoration.

Each slice gets focused tests, required repository checks, review, single-workspace
deployment at an exact SHA, dry-run inspection, measured reclamation, and ordinary
product acceptance. Rollback disables deletion and retains restoration support.

## Current state

- User authorized merging every PR from this effort after checks pass.
- Skill [PR #16433](https://github.com/paperclipai/paperclip/pull/16433) merged
  after exact-head CI, security review, and Greptile 5/5 passed. Reviewed head:
  `afc159cf39a1228608c1f864648ab359a57bf357`; merge:
  `86c965ce7ab1499864f74b8dd6ed0d2d8db15197`. Devin's original implementation
  and authorship are retained. The earlier prototype on `codex/recoverable-skill-cache`
  must not ship as a competing worker.
- Git [PR #16457](https://github.com/paperclipai/paperclip/pull/16457) is open on
  `codex/recoverable-git-cache`, rebased onto that merge. Initial review head:
  `bb3984d3fd13e7a5604e9d90c7d58748d4b50708`. CI and review are pending.
- Git evidence: 17 real database/filesystem cases passed in 48.04s, including
  expiration/reopening at A after upstream B, subsequent commits, interrupted
  trash deletion, concurrent reopening, unique files/Git state, live consumers,
  upstream failure, company boundaries, shared bases, and nested private sources.
  Three final guard cases passed; 328 existing controls passed in 238.69s.
  Evidence: `/tmp/paperclip-git-expiration-tests4.log`,
  `/tmp/paperclip-git-final-guards.log`, `/tmp/paperclip-git-existing-controls.log`.
- Skill evidence: 21 final focused cases passed in 29.99s and 35 affected
  skill/heartbeat controls passed. Streaming discovery holds directory cursors
  across bounded pages; a regression counts actual reads. Preparation/pinning
  and eviction share company locks; filesystem inspection/deletion do not hold
  the preparation lock. Immutable snapshots remain in the database.
- Full local typecheck/build passed for both slices. The full test attempt ran
  for 3,547.58s and did not pass: startup IPC capacity failures, mixed-revision
  discovery tests, two unrelated controls, and module failures after the checkout
  disappeared. It is not evidence of one clean SHA. Exact-head CI supersedes
  the mixed-revision run for the merged skill PR. Focused final-code retries
  classified the remaining failures: all 103 tests in the affected final-code
  retry passed in 42.25s. Do not repeat an hour-long loop without cause.
- The checkout unexpectedly disappeared at about 17:22 UTC after all code was
  pushed. Restored the same branch/path from Git, reinstalled frozen dependencies
  in 24.8s, and rebuilt successfully. Managed attachment recovery was unavailable
  because the app could not verify ownership. All retained evidence is in `/tmp`.
- Staging target: `paperclip.staging.paperclip.app`, `stack-pool-50531a9d17dd`.
  One deployment request owns this task's rollout:
  `38a0a286-7a97-4cd5-b58e-eabdaa4d38bd`, source merge `86c965ce7a…`.
  First prepare failed with `direct_migrator_artifact_invalid` while the exact
  source artifact was still publishing. After its publisher passed, reran that
  failed prepare and resumed the same request. No campaign duplication.
- Latest read-only staging baseline at 17:26 UTC: serving
  `03f22f4cb9be9a34906bda0e4906262dc359e9ce`, disk 73%, 106,903,482,368 bytes
  used and 40,395,079,680 available. This task has not deleted staging data.
  Skill cleanup is configured enabled with dry-run true; Git cleanup is not enabled.
- Existing unresolved staging runs have missing skill-version pins. The approved
  conservative policy skips that company. Do not clear recovery or fabricate pins
  to obtain savings. A disposable fixture must distinguish worker proof from the
  ordinary product restoration journey and disclose this legacy-data limitation.
- UI fixture created through Studio: skill `06a02b07-ee23-421c-afd1-5aa4b1dad423`,
  slug `cache-restoration-acceptance-20261015`, initial saved marker
  `SAVED-SKILL-V1-20261015`. No test run yet. Clean up only this task's fixtures.
- Live Git inventory: 152 active Git workspaces, 150 with runtime ownership and
  37 with isolated remote sources. Other owned task worktrees use shared managed
  bases. Support both layouts while preserving shared bases.
- Temporary Railway key `paperclip-cleanup-acceptance-2026-10-15` remains
  registered under explicit user approval. Revoke it and remove both local copies
  when access is no longer needed; private paths are in retained task evidence.
- Git review found two second-cycle bugs. The worker now clears the consumed
  reopen fence before expiration dispatch; successful reopening marks the
  recipe restored so a later missing worktree can reattach its newer branch. Eighteen
  cases passed; an added symlink fixture initially broke its own relative Git
  commondir. After retaining a valid absolute commondir, that safety case passed
  in 10.63s. The new guard rejects symlinked administration storage before deletion.
  A second review caught the normal preparation refresh moving A to B after
  recipe retirement. Keeping a restored recipe preserves the refresh guard while
  accepting subsequent branch commits. Both joined lifecycle tests now pass in
  35.99s, including normal runtime preparation after reopening and another
  missing-worktree rebuild after new work. The premature partial-edit test run
  is excluded; `/tmp/paperclip-git-resumed-preparation2.log` is the completed run.
  Full typecheck/build at `465e57ad52` passed; the guard change has its own server
  typecheck. A CI policy test also mistook a script filename for a
  GitHub secret expression; scope its check to expressions and retain explicit
  dot/bracket/multiline secret controls.
- Remaining: address Git review, merge after all gates pass, verify exact serving
  SHAs, dry-run both slices, measure actual reclamation, use restored skill and
  reopened workspace through the product, inspect persisted results and protected
  data, record final evidence, and revoke temporary access. No live acceptance yet.
- Latest branch-adoption review fix keeps the retained recipe's branch synchronized
  with the row inside the existing reconciliation transaction. The joined restore,
  rename, adoption, and normal-preparation case passed in 16.67s; 11 existing
  reconciliation controls passed in 21.83s. Full typecheck/build passed for this
  change. Evidence: `/tmp/paperclip-git-branch-adoption.log`,
  `/tmp/paperclip-git-reconcile-controls.log`, and
  `/tmp/paperclip-git-adoption-{typecheck,build}.log`.
- Skill deployment artifacts finished, but its deploy stage was rejected at
  17:50 UTC because another campaign already held the target. No competing
  campaign was created. Inspect that operation before rerunning the same request.
  UI fixture v2 is saved; neither staging fixture eviction nor restoration has run.

## Feedback-loop evidence

| Question | Environment / loop | Elapsed / main wait | Result / next decision |
| --- | --- | --- | --- |
| Can this checkout run focused tests? | Local dependency setup | 43.2s install; later one-time Runner build took several minutes | Baseline manifest/lock drift required install without changing CI-owned lockfile. Warm builds are now reusable. |
| Can an older skill restore without upstream? | Existing service with real Postgres snapshots, pre-cleanup proof at baseline `57fa6b358d` | 4.83s warm test attempt; setup excluded as one-time above | Normal runtime path restored saved binary/script bytes and executable bits with fetch unavailable; proceed with cleanup. |
| Do the integrated safety cases hold? | Devin's `0f3adda980` plus local follow-up; real Postgres and filesystem | 49s from launch through inspected result, 47.23s runner (62% tests, 21% import) | 22 tests passed, server typecheck passed. Added deleted-skill and failure-budget review cases plus heartbeat controls. No cloud proof claimed. |

| Does Git reopening preserve A after upstream moves? | `5eb505ff5d`, local bare remote plus real runtime/service/database path | 6.398s setup/run/inspection script, about 9s launch through result review | Missing branch returned B; missing base failed. Preserve fixture for exact-commit restoration tests. |
| Does cleanup block preparation during a slow file walk? | Same checkout plus review fixes, two DB clients and a deliberately paused filesystem read | 24.94s affected suite, about 28s through inspected result | 18 tests pass; preparation completes while scan is paused and its new pin prevents eviction. |

## Deferred

Skill-version creation/deduplication, recovery retention, non-Git workspace expiry,
shared/operator checkout expiry, and moving storage off the webserver.
