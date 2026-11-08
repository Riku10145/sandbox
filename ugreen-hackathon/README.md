# UGREEN Hackathon 2026 Round 1 提出物

Track は Unleash Your Creativity、Skill 名は `shoot-archive-audit` です。締切は 2026-11-15 23:45 PT（日本時間 11/16 月 16:45）です。

## 提出するファイル

| ファイル | 中身 |
|---|---|
| `proposal/shoot-archive-audit-proposal.pdf` | 提案書。英語485語（見出しを含む）、A4で1ページ、47KB |
| `skill/shoot-archive-audit.zip` | Skill パッケージ。5ファイル、展開後24KB |

`skill/shoot-archive-audit/` は ZIP の中身、`proposal/proposal.md` は PDF の原稿です。

## スターターキットで確かめたこと

uliya-skill-kit 0.7.3（capability catalog 2.0.0）を読み、引き継ぎメモで未確定だった Files の照合機能を確かめました。

- `ug-filesystem` に `find`、`stat`、`sha256sum`、`cat` があり、どれも読み取りだけで承認は要りません。ファイル名と日時に加えて、SHA-256 での照合もできます。
- `ug-photo meta` は EXIF を返します。書き出しで名前を変えた納品 JPEG も、撮影日時と機種で RAW にひも付けられます。
- `ug-knowledge save-text` は書き込みで、承認が要ります。レポートの保存に使います。

チェッカーには、メモと食い違う制約がありました。

- Skill のルートに置けるのは `SKILL.md` と `references/` だけです。メモで推奨とされていた README.md をルートに置くと、エラーになります。導入・削除・テストの手順は `references/setup-and-testing.md` に入れました。
- delegate の instruction は単一引用符で囲みます。`<...>` 形式のプレースホルダは警告になるので、`{PROJECT_PATH}` の形にしました。
- `/volume1/` や `/nas/` で始まるパスと、bash などのコードブロックはエラーになります。

静的チェックの結果は static-pass で、エラーも警告も0件です。

## Skill の設計

1つの案件について「完全に、安全にアーカイブされたか」を答えます。メディアファイルには読み取りしかしません。

1. 系譜の確認: 編集済みファイルと納品物を RAW 原本にひも付けます。ファイル名で照合し、残ったものは EXIF の撮影日時と機種で照合します。
2. 複製の確認（任意）: 作業用コピーとアーカイブを、存在とサイズで比べます。deep モードでは SHA-256 も比べます。
3. 再検証（別モード）: 以前に保存したレポートのハッシュ一覧と、今のアーカイブを比べ、気づかないうちに起きた破損を見つけます。

判定は「SAFE TO CLEAR WORKING COPY」「NOT YET」「UNVERIFIED」の3つです。保存はユーザーの確認後だけ行い、移動や削除はしません。

メモの分岐の雛形からは、次の点を変えました。

- 「RAW のみ」は警告から情報に下げました。選別で外した写真は編集しないのが普通で、RAW の大半がここに入るためです。
- 再検証モードを足しました。課題③の「壊れたアーカイブは必要時まで気づけない」に答えるためです。
- 動画は系譜の確認の対象外で、複製の確認と再検証だけを行います。提案書の8項目めに書いています。

## 提出前に人が決めること

- Skill 名を変えるか。変えるなら、フォルダ名、SKILL.md の `name`、ZIP、提案書をそろえて直します。
- 個人で出すか、チームで出すか。
- 社外活動に関する社内規程の確認（会社員の場合）。
- Devpost からの提出。

## 作り直すとき

Skill を直したら、キットのチェッカーにかけてから ZIP を作り直します。

```
node <キットの場所>/scripts/check-skill.mjs ugreen-hackathon/skill/shoot-archive-audit
cd ugreen-hackathon/skill && rm -f shoot-archive-audit.zip && zip -X -r shoot-archive-audit.zip shoot-archive-audit
```

提案書を直したら、PDF を作り直します（Playwright と Chromium が要ります）。

```
node ugreen-hackathon/proposal/build-pdf.js ugreen-hackathon/proposal/proposal.md /tmp/proposal.html ugreen-hackathon/proposal/shoot-archive-audit-proposal.pdf
```
