# Report format

Read this file in Step 6 (audit report) and after Step R2 (reverify report). Fill every field from real results only. Leave out a section only when the check behind it was not run, and say so in "Checks run".

## Audit report

```markdown
# Shoot archive audit: {project folder name}

- Date: {date and time of the run}
- Skill: shoot-archive-audit 1.0.0
- Working copy: {PROJECT_PATH}
- Archive copy: {ARCHIVE_PATH or "not checked"}
- Depth: {quick or deep}
- Checks run: {lineage, copy check} / Coverage: {COMPLETE or PARTIAL, with the folders not covered}

## Verdict: {SAFE TO CLEAR WORKING COPY | NOT YET | UNVERIFIED}

{One sentence that explains the verdict.}

## Summary

| Tier | Files | Total size |
|---|---|---|
| RAW original | | |
| Edited | | |
| Delivered | | |
| Project file | | |
| Sidecar | | |
| Other | | |

| Lineage | Count |
|---|---|
| Linked by name | |
| Linked by EXIF | |
| Linked (merge) | |
| Linked (ambiguous) | |
| ORIGINAL MISSING | |
| Edited, not delivered | |
| RAW only (not selected) | |

| Copy check | Count |
|---|---|
| match | |
| missing-in-archive | |
| size-mismatch | |
| hash-mismatch | |
| unreadable | |
| archive-only | |

## CRITICAL findings

| Finding | Relative path | Detail |
|---|---|---|

## WARNING findings

| Finding | Relative path | Detail |
|---|---|---|

## SHA-256 manifest

Deep mode only. One row for every hashed file whose status is match.

| Relative path | Size (bytes) | SHA-256 |
|---|---|---|
```

## Reverify report

```markdown
# Archive re-verification: {archive folder name}

- Date: {date and time of the run}
- Skill: shoot-archive-audit 1.0.0
- Archive: {ARCHIVE_PATH}
- Manifest: {MANIFEST_PATH}, created {date in the manifest report}

## Verdict: {INTACT | DAMAGED | PARTIAL}

| Result | Count |
|---|---|
| intact | |
| CHANGED | |
| MISSING | |
| unreadable | |
| new (not in manifest) | |

## CRITICAL findings

| Finding | Relative path | Manifest SHA-256 | Current SHA-256 |
|---|---|---|---|
```

INTACT means every manifest row is intact. DAMAGED means at least one row is CHANGED, MISSING or unreadable. PARTIAL means some batches did not complete.

## Size of the report

If the CRITICAL or WARNING table has more than 200 rows, show the first 200 in the conversation and state the total. The saved file always holds every row.
