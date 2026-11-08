# shoot-archive-audit

**Track:** Unleash Your Creativity

## 1. What the Skill does

It tells a photographer or video editor whether a shoot is completely and safely archived on the NAS, and whether that archive is still intact years later.

## 2. Target users and problem

Photographers, videographers and small studios with tens of terabytes of shoots. After delivery they must archive RAW originals, edits, project files and deliverables, then clear working storage. Today they check this by eye. Missing originals, incomplete copies and silent corruption surface only when a client asks for a re-edit.

## 3. Solution

Three read-only checks, one report, one verdict:

- **Lineage:** links every edit and deliverable to its RAW original, by name or, for renamed exports, by EXIF capture time and camera.
- **Copy check:** compares working and archive copies by size and SHA-256.
- **Reverify:** later, recomputes hashes against the manifest saved in the report.

## 4. Main user flow

"Is the Tanaka wedding safely archived?" → user confirms folders, depth and file classification → lineage and copy results → SAFE TO CLEAR, NOT YET or UNVERIFIED → user approves saving the report. A year later: "Re-check the Tanaka archive" → INTACT or DAMAGED.

## 5. Difference from existing tools

Backup and sync tools check copies, not lineage, so they miss a delivered JPG whose RAW is gone. Cloud asset managers need the whole library uploaded. This Skill works where the files already live, understands creative file types, and never changes media.

## 6. UGREEN AI NAS features used

- Files `find`, `stat`: inventory (Steps 1, 5)
- Files `sha256sum`: copy check, reverify (Steps 5, R2)
- Files `cat`: reading the saved manifest (Step R1)
- Albums `ug-photo meta`: EXIF linking (Step 4)
- Knowledge `save-text`: saving the report after approval (Step 7)

## 7. Technical approach

The parent Skill only delegates: `file-agent` (inventory), `photo-agent` (unlinked images only), `file-agent` (archive), `knowledge-agent` (save). Each instruction is self-contained and uses only real upstream results. Inputs: project folder, optional archive folder, quick or deep. Permissions: read on project and archive, new-file write for the report. It uses whichever model Uliya is configured with and adds no external AI or network call. All five delegation states are handled; partial results are labelled.

## 8. Built / not built / needs NAS testing

Built: SKILL.md and four references; the kit checker reports 0 errors and 0 warnings. Not built: video lineage. Needs NAS testing: SHA-256 speed on multi-terabyte folders, `meta` output per RAW format, and `cat` on large reports.

## 9. Test plan

- **Main 1:** complete test project, deep mode → SAFE TO CLEAR; reverify → INTACT.
- **Main 2:** delete one RAW, delete one archived JPG, swap one archived RAW for same-size different content → NOT YET listing each; reverify → DAMAGED.
- **Edge:** missing folder and empty folder → clear stop, no other folder searched, nothing saved.

## 10. Constraints and risks

Deep hashing can take hours, so quick mode is the default and deep mode carries a warning. Renamed exports without EXIF cannot be linked and are reported as missing originals. No external dependencies.
