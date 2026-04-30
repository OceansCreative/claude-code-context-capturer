# Claude Code Context Capturer

> 開いている Web ページを「Claude Code 用の構造化された Markdown コンテキスト」に変換してクリップボードにコピーする Chrome 拡張機能。

[English version below](#english)

---

## 🎯 これは何か

Claude Code に Web ページを渡したいとき、こんな悩みはありませんか：

- URL だけだと Claude が読み込めないことがある
- ページ全体をコピーすると広告・ナビゲーション・サイドバーまで混入する
- GitHub Issue / Stack Overflow / 技術ブログの構造を保ったまま渡したい

この拡張機能は、開いているページから**ノイズを除いた本文だけ**を取り出し、Claude Code が消化しやすい Markdown に変換してクリップボードにコピーします。

```yaml
---
url: https://github.com/owner/repo/issues/42
title: "[Issue] Bug: something is broken"
captured_at: 2026-04-30T12:00:00.000Z
parser: github
author: alice
tags: ["bug", "priority:high"]
---

# Bug: something is broken

The thing crashes when I do `foo()`.

## Comments

### bob

I see the same.

---

*Source: [...](https://github.com/owner/repo/issues/42)*
```

そのままチャットに貼るだけで、Claude にコンテキスト付きで質問できます。

## ✨ 機能

- **ワンクリック抽出**：ツールバーアイコンまたはキーボードショートカットで開いているページを Markdown 化
- **選択範囲モード**：テキスト選択時はその部分だけを抽出
- **サイト別最適化**：以下のサイトで専用パーサーが動作
  - GitHub（Issue / Pull Request / Discussion / README）
  - Stack Overflow / Stack Exchange
  - Zenn
  - Qiita
  - MDN Web Docs
  - その他のサイトは Mozilla Readability で本文抽出
- **メタ情報の埋め込み**：URL・タイトル・取得日時を YAML frontmatter で付与
- **CLAUDE.md への直書き** *(v0.2.0+)*：プロジェクトの `CLAUDE.md` を一度ピックすれば、以降のキャプチャは File System Access API 経由で自動 append。コピペ不要
- **キャプチャバッファ**：複数ページをまとめて溜めて、後から一括エクスポート
- **キーボードショートカット**：
  - `Ctrl+Shift+L`（macOS: `Cmd+Shift+L`）：ページ全体
  - `Ctrl+Shift+K`（macOS: `Cmd+Shift+K`）：選択範囲
- **コンテキストメニュー**：右クリックから直接キャプチャ
- **設定可能**：frontmatter の有無、フッター、文字数上限、ロケール（en / ja）など

## 🚀 インストール

### Chrome ウェブストア（推奨）

[Coming soon - 審査中]

### 開発版を直接インストール

```bash
git clone https://github.com/OceansCreative/claude-code-context-capturer.git
cd claude-code-context-capturer
npm install
npm run build
```

その後 Chrome で：

1. `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このリポジトリの `dist/` ディレクトリを選択

## 💡 使い方

### ページ全体をキャプチャ

ツールバーの拡張機能アイコンをクリック → 「Capture page」ボタン。
または `Ctrl+Shift+L`（macOS: `Cmd+Shift+L`）。

### 選択範囲だけをキャプチャ

ページ上でテキストを選択 → 拡張機能アイコン → 「Capture selection」。
または `Ctrl+Shift+K`（macOS: `Cmd+Shift+K`）。

### バッファに溜めてあとで一括エクスポート

設定画面（拡張機能アイコン右上の ⚙）で「Default action」を **Append to buffer** または **Both** に変更すると、キャプチャがバッファに蓄積されます。設定画面の「Copy all as Markdown」で全件まとめてエクスポートできます。

### 設定をカスタマイズ

設定画面で以下を変更できます：

| 設定 | 説明 |
|---|---|
| Default action | キャプチャ時の動作（クリップボード / バッファ / 両方） |
| Include YAML frontmatter | メタ情報の付与 |
| Include source footer | フッターに出典 URL を付ける |
| Wrap output in fenced code block | コードブロックで囲む（チャット直貼り用） |
| Maximum body length | 本文の最大文字数（0 = 無制限） |
| Locale | en / ja |

## 🛠️ 開発

### 必要環境

- Node.js 20+
- npm

### コマンド

```bash
npm install        # 依存関係のインストール
npm run dev        # 開発モード（HMR 付き）
npm run build      # 本番ビルド
npm test           # テスト実行
npm run lint       # Lint
npm run format     # Prettier でフォーマット
```

### プロジェクト構成

```
src/
├── background/        # Service worker（コマンド受信・配送）
├── content/
│   ├── index.ts       # コンテントスクリプトエントリ
│   └── parsers/       # サイト別パーサー
├── popup/             # ポップアップ UI（React）
├── options/           # 設定画面（React）
├── shared/            # 共通ロジック（Markdown 変換、ストレージなど）
└── manifest.config.ts # Manifest V3 定義
```

### サイト別パーサーの追加

新しいサイトに対応したい場合、以下の手順で追加できます：

1. `src/content/parsers/yoursite.ts` を作成
2. `canHandleYourSite()` と `parseYourSite()` をエクスポート
3. `src/content/parsers/dispatcher.ts` で先頭に追加
4. `src/shared/types.ts` の `ParserName` に追加
5. `tests/parsers/yoursite.test.ts` でテストを追加

Pull Request 歓迎です。

## 📜 ライセンス

MIT License - [LICENSE](./LICENSE) を参照。

自由に fork ・改変・商用利用してください。

## 🙋 つくったひと

開発・メンテナンス：**池田和司（[OceansBase](https://oceans-base.com)）**

[OceansBase](https://oceans-base.com) は島根県を拠点とする個人事業屋号で、受託開発・IT コンサル・コンテンツ制作を行っています。

## 🔗 関連プロジェクト

Claude Code エージェント集シリーズ：
- [claude-code-c-suite-agents](https://github.com/OceansCreative/claude-code-c-suite-agents) - 汎用 13 エージェント
- [claude-code-agents-meo-shop](https://github.com/OceansCreative/claude-code-agents-meo-shop) - 店舗ビジネス向け
- [claude-code-agents-jisaa](https://github.com/OceansCreative/claude-code-agents-jisaa) - 士業向け
- [claude-code-agents-saas-founder](https://github.com/OceansCreative/claude-code-agents-saas-founder) - SaaS 創業者向け

---

<a id="english"></a>

# Claude Code Context Capturer (English)

> A Chrome extension that converts any web page into Claude Code-friendly Markdown context with one click.

## What it does

When you want to share a web page with Claude Code, you face three problems:

- URLs alone don't always work — Claude may not be able to fetch the content
- Copy-pasting the whole page brings ads, navigation, and sidebars
- You want to preserve the structure of GitHub Issues, Stack Overflow answers, technical blogs

This extension extracts **only the main content**, converts it to clean Markdown, and copies it to your clipboard. Drop it into your Claude Code conversation and you have full context.

## Features

- **One-click capture** — Toolbar icon or keyboard shortcut
- **Selection mode** — Capture only what you've selected
- **Site-specific parsers** for GitHub, Stack Overflow, Zenn, Qiita, MDN
- **YAML frontmatter** with URL, title, captured_at, author, tags
- **Direct CLAUDE.md write** *(v0.2.0+)* — Link a `CLAUDE.md` once via the File System Access API; subsequent captures append directly, no copy/paste
- **Buffer mode** — Stack multiple captures and export all at once
- **Keyboard shortcuts**:
  - `Ctrl+Shift+L` (Cmd+Shift+L on macOS) — capture page
  - `Ctrl+Shift+K` (Cmd+Shift+K on macOS) — capture selection
- **Context menu** — Right-click to capture

## Installation

### Chrome Web Store (recommended)

[Coming soon - in review]

### Manual install

```bash
git clone https://github.com/OceansCreative/claude-code-context-capturer.git
cd claude-code-context-capturer
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist/` directory of this repository

## Adding a new site parser

Pull requests are welcome! To add support for a new site:

1. Create `src/content/parsers/yoursite.ts`
2. Export `canHandleYourSite()` and `parseYourSite()`
3. Register it at the top of `src/content/parsers/dispatcher.ts`
4. Add the name to `ParserName` in `src/shared/types.ts`
5. Add tests in `tests/parsers/yoursite.test.ts`

## License

MIT — free to fork, modify, and use commercially.

## Author

Maintained by **Kazushi Ikeda** ([OceansBase](https://oceans-base.com)) — solo IT consulting practice in Shimane, Japan.
