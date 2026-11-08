---
name: shoot-archive-audit
description: Archive integrity audit for photo and video shoot projects stored on the NAS. Shows which RAW originals, edited files, project files and client deliverables are present, linked or missing, whether an archive copy matches the working copy byte for byte, and whether an older archive still matches the SHA-256 manifest saved in an earlier report. Use when a photographer, videographer or editor asks whether a shoot is safely archived, whether any originals are missing, whether a backup copy is complete, whether it is safe to clear a working copy, or wants to re-check an old archive for silent corruption.
---

# Goal

Answer one question per shoot project with evidence from the NAS: "Is this project complete and safely archived?"

The Skill runs up to three read-only checks and produces one report:

1. Lineage check: links every edited file and client deliverable to its RAW original, and flags any derivative whose original is missing.
2. Copy check (optional): compares the working copy with an archive copy by existence and size, and in deep mode by SHA-256.
3. Re-verify (separate mode, used months or years later): recomputes SHA-256 for an archive and compares it with the manifest stored in an earlier deep-mode report, to detect silent corruption.

Scope and limits:

- Lineage linking covers still images. Video files are covered by the copy check and re-verify only.
- The Skill never deletes, moves, renames, tags or overwrites media files. The only write is saving the report, and only after the user confirms the folder and file name.
- The Skill gives a verdict. It never clears a working copy itself.

Skill version: 1.0.0. Matching and classification rules: [references/matching-rules.md](references/matching-rules.md). Report layout: [references/report-format.md](references/report-format.md).

# Required input

Collect these values before the first delegation. In every delegate instruction below, replace each `{NAME}` with the real value collected here or returned by an earlier step. If a required value is not available, ask the user and do not delegate.

| Value | Needed for | Notes |
|---|---|---|
| `{MODE}` | always | `audit` (default) or `reverify`. |
| `{PROJECT_PATH}` | audit | The working project folder on the NAS, as the user names it. |
| `{ARCHIVE_PATH}` | audit (optional), reverify (required) | The archive copy folder. Without it, audit runs the lineage check only. |
| `{DEPTH}` | audit with archive | `quick` (existence and size) or `deep` (adds SHA-256). Default `quick`. Before accepting `deep`, tell the user that it reads every hashed file on both copies and can take hours for a multi-terabyte project. |
| `{MANIFEST_PATH}` | reverify | A report file saved earlier by this Skill in deep mode. |
| `{REPORT_FOLDER}`, `{REPORT_NAME}` | save step | Asked only at the save step, never earlier. |

Optional: `{RAW_FOLDER}`, `{EDIT_FOLDER}`, `{DELIVERY_FOLDER}` as subfolders of `{PROJECT_PATH}`. When the user does not give them, classify files with the rules in [references/matching-rules.md](references/matching-rules.md) and ask the user to confirm the classification before matching.

Do not ask for credentials, internal IDs or parameters that belong to a child expert.

# Generation-time capability evidence

- `ug-filesystem` → `file-agent`
- `ug-photo` → `photo-agent`
- `ug-knowledge` → `knowledge-agent`

Actions this workflow relies on, checked against capability catalog 2.0.0:

| CLI | Action | Effect | Approval | Used for |
|---|---|---|---|---|
| ug-filesystem | `find` | read | none | Inventory of a folder |
| ug-filesystem | `stat` | read | none | Size and modification time |
| ug-filesystem | `sha256sum` | read | none | Byte-level comparison and manifest |
| ug-filesystem | `cat` | read | none | Reading a saved report in reverify mode |
| ug-photo | `meta` | read | none | EXIF capture time and camera for renamed exports |
| ug-knowledge | `save-text` | state-change | workflow | Saving the report after confirmation |

# Workflow

Every step passes only the real result returned by the upstream step to the downstream step. The parent never invents file names, sizes, hashes or EXIF values.

## Step 0: Confirm scope (no delegation)

Restate mode, folders and depth in one short list and ask the user to confirm. If the user changes anything, restate again.

## Audit mode

### Step 1: Inventory the working copy

`delegate --target file-agent --instruction 'Using ug-filesystem find, list every regular file under the NAS folder {PROJECT_PATH}, recursively, with no file type filter. For each file return the real full path, the path relative to {PROJECT_PATH}, the file name, the extension, the size in bytes and the modification time; use ug-filesystem stat for any file where find does not return size or time. This is read only: do not move, rename, tag or delete anything. If the folder does not exist or cannot be read, return failed with the reason. If the folder exists but has no files, return completed with an empty list and say so. If a limit truncates the listing, say so and name the subfolders that were not fully listed.'`

- Empty result: tell the user "No files were found under {PROJECT_PATH}. Please check the folder path." and stop. Do not search other folders.
- Truncated result: repeat Step 1 for each subfolder that was not fully listed. If that still fails, continue and mark the report PARTIAL with the folders that were not covered.

### Step 2: Classify (no delegation)

Using only the Step 1 inventory, put each file into one tier: RAW original, Edited, Delivered, Project file, Sidecar, Other. Follow [references/matching-rules.md](references/matching-rules.md). Show the user the count per tier, two example file names per tier and the rule that placed them, then ask for confirmation. Apply any correction the user gives.

If no RAW originals are found, say so plainly and ask whether the RAW files live in another folder. Do not guess a folder. If the user says there are none, run the copy check only and state in the report that lineage was not checked.

### Step 3: Link by name (no delegation)

Link each Edited and Delivered still image to a RAW original with the name rules in [references/matching-rules.md](references/matching-rules.md). Collect the derivatives that remain unlinked.

### Step 4: Link by EXIF (only when Step 3 left unlinked still images)

Send the real paths of the unlinked derivatives as `{UNLINKED_PATHS}` and the real paths of the RAW originals as `{RAW_PATHS}`. When there are more than 200 RAW originals, send them in batches of 200 and keep the results of each batch.

`delegate --target photo-agent --instruction 'Using ug-photo meta, read EXIF metadata for each of these NAS files: {UNLINKED_PATHS}. Then read EXIF metadata for each of these RAW files: {RAW_PATHS}. For every file return the real path, DateTimeOriginal with the sub-second value when present, camera model, camera body serial number when present, and image width and height. This is read only. If a file has no EXIF data or cannot be read, list it in a separate list with the reason and do not estimate any value.'`

Link a derivative to a RAW original only when capture time (including sub-seconds when both have them) and camera model match exactly, and the serial number matches when both have one. If more than one RAW original matches, mark the link as ambiguous and list the candidates. Derivatives that still have no link become ORIGINAL MISSING.

### Step 5: Copy check (only when `{ARCHIVE_PATH}` was given)

Set `{HASH_EXTENSIONS}` to the RAW, Delivered and Project file extensions confirmed in Step 2.

`delegate --target file-agent --instruction 'Compare two NAS folders without changing anything. Working copy: {PROJECT_PATH}. Archive copy: {ARCHIVE_PATH}. Using ug-filesystem find and ug-filesystem stat, check for every file in the working copy whether a file with the same relative path exists in the archive copy and whether the size in bytes is equal. Depth is {DEPTH}. When depth is deep, also run ug-filesystem sha256sum on both copies of every file whose extension is one of {HASH_EXTENSIONS}, and compare the two hashes. Return one row per file with the relative path, working size, archive size, working SHA-256, archive SHA-256 and a status of match, missing-in-archive, size-mismatch, hash-mismatch or unreadable. Also list files that exist only in the archive copy. This is read only: do not copy, move or delete files. If the archive folder does not exist or cannot be read, return failed with the reason.'`

### Step 6: Build and show the report (no delegation)

Build the report with [references/report-format.md](references/report-format.md) and show it in the conversation. Choose exactly one verdict:

- SAFE TO CLEAR WORKING COPY: depth was deep, every RAW, Delivered and Project file has status match, there are no CRITICAL findings, and the inventory was complete.
- NOT YET: at least one CRITICAL finding.
- UNVERIFIED: no CRITICAL findings, but the copy check was quick, was not run, or the inventory was PARTIAL.

Then continue with Step 7.

## Reverify mode

### Step R1: Read the saved manifest

`delegate --target file-agent --instruction 'Using ug-filesystem cat, read the full text of the NAS file {MANIFEST_PATH}. Read it in chunks with offset and length until the end of the file and return the text exactly as stored. This is read only. If the file does not exist or cannot be read, return failed with the reason.'`

Find the section titled "SHA-256 manifest" in the returned text. If it is missing, tell the user "This file is not a deep-mode report from shoot-archive-audit, so there is nothing to re-verify." and stop.

### Step R2: Recompute hashes

Send the relative paths from the manifest as `{MANIFEST_RELATIVE_PATHS}`, in batches of 500 when there are more.

`delegate --target file-agent --instruction 'Using ug-filesystem stat and ug-filesystem sha256sum, compute the size and SHA-256 of each of these files under the NAS folder {ARCHIVE_PATH}, given as paths relative to that folder: {MANIFEST_RELATIVE_PATHS}. Return one row per file with the relative path, size and SHA-256, or the reason it could not be read. Also list files under {ARCHIVE_PATH} that are not in the given list. This is read only: do not change, move or delete any file.'`

Compare each row with the manifest: intact, CHANGED, MISSING, unreadable, or new (not in the manifest). Build the report with the reverify layout in [references/report-format.md](references/report-format.md), show it, then continue with Step 7.

## Step 7: Save the report (only after explicit confirmation)

Ask: "Do you want to save this report as a Markdown file on the NAS? If yes, which folder and file name?" If the user says no, finish without saving.

`delegate --target knowledge-agent --instruction 'Using ug-knowledge save-text, save the Markdown report below as a new file in the NAS folder {REPORT_FOLDER} with the file name hint {REPORT_NAME}. Do not overwrite an existing file; if a file with that name already exists, return waiting_user and ask the user for another name. Return the real saved path, the verified flag and the content size. Report: {REPORT_MARKDOWN}'`

Tell the user the saved path only after the expert returns completed with a verified result. In deep mode, remind the user that this saved file is the manifest for a future reverify run.

# Completion and failure

Handle every delegation state:

- `completed`: use only the real result returned. An empty result or no results means nothing matched: say so plainly, stop the steps that depend on it, and do not switch to similar folders or widen the scope.
- `failed`: name the step and the reason. Stop the steps that depend on it. Keep and show the results of earlier completed steps, mark the report PARTIAL, and set the verdict to UNVERIFIED at best. Example: if Step 5 fails, show the lineage check and state that the archive copy was not checked.
- `cancelled`: stop. Tell the user which steps finished and confirm that no media file was changed.
- `waiting_user`: show the expert's question to the user as it is, wait for the answer, then resume the same step with that answer.
- `waiting_approval`: tell the user that the save is waiting for approval on the NAS. Do not say the report is saved until the step returns completed.

The whole run is complete only when every requested check returned completed and the report was shown. Never describe files as checked if the expert did not return them, and never claim the report was saved without a real saved path.

Installation, permissions, removal and test cases: [references/setup-and-testing.md](references/setup-and-testing.md). Third-party components and AI tool disclosure: [references/disclosures.md](references/disclosures.md).
