# Matching and classification rules

Read this file in Step 2 (classify), Step 3 (link by name) and Step 4 (link by EXIF) of the audit mode.

All comparisons of names and extensions are case-insensitive. Apply the rules only to files returned by the inventory step.

## 1. Tiers

Apply the first rule that matches. When the user gave `{RAW_FOLDER}`, `{EDIT_FOLDER}` or `{DELIVERY_FOLDER}`, the folder decides the tier for files inside it, and only the extension rules below decide for files elsewhere.

| Tier | Rule |
|---|---|
| Sidecar | Extension is XMP, PP3, DOP, COS, ACR or THM. Sidecars are reported, but they are not linked. |
| Project file | Extension is LRCAT, COCATALOG, PRPROJ, DRP, AEP, FCPXML or a folder ending in LRDATA or FCPBUNDLE. Project files hold edit decisions and must be archived. |
| RAW original | Extension is CR2, CR3, CRW, NEF, NRW, ARW, SR2, SRF, RAF, ORF, RW2, PEF, DNG, IIQ, 3FR, FFF, X3F, RWL, SRW, GPR, ERF, MEF, MOS, KDC or DCR. Camera video originals (BRAW, R3D, MXF, and MOV or MP4 inside a folder whose name contains "raw", "card", "original" or "footage") are also originals, but only for the copy check. |
| Delivered | Image or video file (JPG, JPEG, PNG, HEIC, TIF, TIFF, MP4, MOV, PDF, ZIP) inside a folder whose name contains "deliver", "export", "final", "client", "gallery" or "納品". |
| Edited | TIF, TIFF, PSD, PSB, or JPG, JPEG, PNG, HEIC, DNG inside a folder whose name contains "edit", "retouch", "select", "working" or "process". A DNG in such a folder is an edited file, not an original. |
| Other | Anything else. Listed by count only. |

A DNG outside edit folders is treated as a RAW original. If the user says their camera writes JPG only, treat JPG files outside edit and delivery folders as originals.

## 2. Link by name (Step 3)

1. Take the file name without extension (the stem).
2. If the stem equals a RAW stem, link it ("linked by name").
3. Otherwise remove these suffix tokens from the end, one at a time, and compare again after each removal: `-edit`, `_edit`, `-edited`, `-final`, `_final`, `-enhanced-nr`, `-enhanced`, `-denoise`, `-hdr`, `-pano`, `-retouch`, `-web`, `-print`, ` copy`, and a trailing `-N`, `_N` or ` (N)` where N is one or two digits.
4. A stem that still contains `hdr` or `pano` after a match is a merged image: mark it "linked (merge)". The other source frames are not required.
5. If nothing matches, the derivative goes to Step 4.

Never link by partial substring outside these rules. For example, `DSC_1234` must not link to `DSC_12345`.

## 3. Link by EXIF (Step 4)

- Required match: DateTimeOriginal to the second, and the same camera model.
- When both files have sub-second values, they must match too.
- When both files have a body serial number, it must match too.
- More than one RAW candidate means the link is ambiguous: list all candidates and do not pick one.
- No EXIF in the derivative means the link is not possible. Report it as ORIGINAL MISSING with the note "no EXIF in export".

## 4. Finding levels

| Level | Finding | Meaning |
|---|---|---|
| CRITICAL | ORIGINAL MISSING | An edited or delivered image has no RAW original in the project. |
| CRITICAL | missing-in-archive | A working file has no counterpart in the archive copy. |
| CRITICAL | size-mismatch, hash-mismatch | The archive copy differs from the working copy. |
| CRITICAL | unreadable | A file could not be read on either side. |
| CRITICAL | CHANGED, MISSING (reverify) | The archive no longer matches its saved manifest. |
| WARNING | edited, not delivered | An edited image has no delivered file linked to the same RAW original. It may have been forgotten. |
| WARNING | linked (ambiguous) | More than one RAW original could be the source. |
| WARNING | no project file | The project has edited files but no project file was found. Edit decisions may be lost. |
| INFO | RAW only | A RAW original with no edit. This is normal for frames that were not selected, so the report shows the count only. |
| INFO | delivered direct | A delivered file linked straight to a RAW original with no edited file. |
| INFO | archive-only, new | A file exists in the archive but not in the working copy or the manifest. |
