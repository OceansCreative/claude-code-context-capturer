# Chrome Web Store update — step-by-step

毎回忘れがちな update 提出フロー。新しい `vX.Y.Z` をリリースしたあと、店頭バージョンを差し替えるための手順。

> **対応ストア URL（既存リスティング）：** https://chromewebstore.google.com/detail/claude-code-context-captu/bnhoinbchkcamklfcpnjplljjodiikfo

---

## 前提（このドキュメントを読み始める時点で揃ってるもの）

- Desktop に `claude-code-context-capturer-vX.Y.Z.zip` がある（release-engineer が置く）
- `package.json` と `src/manifest.config.ts` の version が一致して `X.Y.Z`
- GitHub Release `vX.Y.Z` が公開済み（CI green）
- permissions に変更がない（あった場合は最後の「permissions が変わってる場合」を参照）

---

## 手順

### 1. Developer Dashboard を開く

https://chrome.google.com/webstore/devconsole/

`oceanscreative0311` の Google アカウントでログイン済みであることを確認。

### 2. アイテムを選ぶ

ダッシュボードのアイテム一覧から **「Claude Code Context Capturer」** カードをクリック。

### 3. 左サイドバーの「パッケージ」をクリック

階層は：
```
ビルド
├ ステータス
├ パッケージ    ← ここ
├ ストアの掲載情報
├ プライバシー
└ 販売地域
```

### 4. 新しいパッケージをアップロード

ページ上部の **「新しいパッケージをアップロード」** ボタンをクリック。

ファイル選択ダイアログが開いたら：
**`~/Desktop/claude-code-context-capturer-vX.Y.Z.zip`** を選ぶ。

アップロード完了後、「現在のバージョン: `X.Y.Z`」の表示に変わってることを確認。

### 5. 各タブの状態を確認

通常は何も触らなくて良いが、Google が変更を促すフィールドがあれば赤いマークが付く。以下を順にチェック：

- **「ストアの掲載情報」** タブ：説明文や screenshot が古いままなら更新（`STORE_LISTING.md` の最新を参照）
- **「プライバシー」** タブ：permissions justification 不変なら触らない。「データの使用」宣言も再確認不要
- **「ステータス」** タブ：審査状態が「下書き」になっていれば次のステップへ

### 6. 「審査用に送信」をクリック

「ステータス」タブの右上または「パッケージ」タブの下部にある **「審査用に送信」** ボタンをクリック。

確認ダイアログが出るので **「送信」** で確定。

### 7. 待つ

- **通常 1〜3 日**（最速数時間、最長 2 週間）
- 進捗通知は `info@oceans-base.com`（Settings で設定したアドレス）に届く
- 通過後、既存ユーザーには **数時間以内に自動アップデート**が配信される

---

## permissions が変わってる場合（特殊ケース）

`v0.X.0` で manifest の `permissions` 配列を変更した場合、Google は **追加された permission ごとに justification 文の入力を要求**します。

- 「プライバシー」タブに赤い「アクション必要」マークが出る
- 該当 permission の理由欄に英語で 1〜3 文の正当化を貼る（`STORE_LISTING.md` の Permissions justification 表をコピペ）
- 「単一目的の説明」が古い場合も差し替え

permissions justification の文面は `STORE_LISTING.md` を常に同期しておくこと（`doc-syncer` agent の責務）。

---

## トラブルシュート

| 症状 | 対応 |
|---|---|
| アップロード時「同じバージョン番号が既にあります」 | `package.json` と `src/manifest.config.ts` の両方を bump し、`npm run build` 後に zip を作り直す |
| 「Manifest V2 はサポート対象外」 | 出るはずがない（このリポジトリは MV3）。出たら zip の中身が壊れてる |
| 「permissions が増えた／減った」警告 | `manifest.config.ts` を意図したものか確認、意図的なら「プライバシー」タブで justification 更新 |
| 提出後「審査ステータス: 拒否」メール | メール本文に rejection reason が書かれている。screenshot を投げてくれれば即対応する |
| 通常より長く（>1 週間）審査が動かない | reviewer が手動レビューに回した可能性。permission スコープが広いと起きやすい。問い合わせは `oceanscreative0311@gmail.com` に届く Google からのメール経由 |

---

## 確認の仕方（提出後）

- ステータスタブで「審査中 → 公開中」の遷移を確認
- 店頭の「最終更新日」が新しい日付に変わってるか
- `chrome://extensions/` で自分の拡張のバージョンが上がってるか
- ダッシュボード左サイドバー「アナリティクス → インストール数」で `vX.Y.Z` のユーザーが増え始めているか（数日かかる）
