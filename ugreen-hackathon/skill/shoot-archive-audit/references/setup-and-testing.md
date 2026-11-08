# Setup, permissions, removal and testing

## Install

1. Upload the `shoot-archive-audit` package to SkillHub, or add the folder to the Uliya skills directory on the NAS.
2. No settings are needed. The Skill has no configuration file, no API key and no external service.

## Permissions

| Access | Folder | Why |
|---|---|---|
| Read | The working project folder | Inventory, EXIF and hashes |
| Read | The archive copy folder | Copy check and reverify |
| Write (new file only) | The report folder chosen at the save step | The saved report |

The Skill never needs write access to the project or archive folders. If the user account cannot read a folder, the step returns failed and the report says which folder.

## Data handling

- All processing stays on the NAS through the registered experts. Nothing is sent to an external service.
- The report holds file names, sizes, capture times and hashes. It does not hold image content.
- The report is saved only after the user confirms the folder and the file name, and an existing file is never overwritten.

## Remove

Remove the Skill from SkillHub or delete the folder from the skills directory. Saved reports are ordinary Markdown files and stay where the user saved them. Delete them by hand if they are no longer needed.

## Versioning

- 1.0.0: first release. Audit mode (lineage check and copy check) and reverify mode.

The version is printed in every report, so a reverify run can tell which version wrote the manifest.

## Test plan for the target NAS

Prepare a test project folder, for example `Shoots/2026-10-Test-Wedding`, with these subfolders: `RAW` (20 RAW files from one camera), `Edited` (8 TIFF files named after their RAW files), `Delivered` (6 JPG exports of six of the edited images, renamed to `Client_001.jpg` to `Client_006.jpg` with EXIF kept), and one Lightroom catalog. Copy the whole folder to an archive folder, for example `Archive/2026/2026-10-Test-Wedding`.

### Main test 1: complete project, deep mode

- Input: audit, working copy and archive copy above, depth deep.
- Expected: 20 RAW originals, 8 linked by name, 6 linked by EXIF, 0 ORIGINAL MISSING, 2 edited-not-delivered warnings, every copy-check row is match, verdict SAFE TO CLEAR WORKING COPY.
- Then save the report and run reverify with it. Expected verdict: INTACT.

### Main test 2: damaged archive and missing original

- Change the test data: delete from the working copy one RAW file whose edited TIFF still exists and has no delivered export; delete one delivered JPG from the archive copy; replace one RAW file in the archive copy with a file of the same name and size but different content.
- Expected in deep mode: one ORIGINAL MISSING, one missing-in-archive, one hash-mismatch, verdict NOT YET. In quick mode the replaced RAW file is reported as match, which shows why deep mode exists.
- Run reverify with the manifest from test 1. Expected verdict: DAMAGED, with the replaced RAW as CHANGED and the deleted JPG as MISSING.

### Edge case: wrong or empty folder

- Input: audit with a folder path that does not exist, then with an empty folder.
- Expected: for the missing folder, Step 1 returns failed and the Skill stops with the reason. For the empty folder, the Skill says no files were found and stops. No other folder is searched and no report is saved.

## Static check

Run the uliya-skill-kit checker on the package folder before every release. Version 1.0.0 passes with 0 errors and 0 warnings on checker format 2.0.0 and capability catalog 2.0.0. A static pass does not prove that the Skill runs on a device.
