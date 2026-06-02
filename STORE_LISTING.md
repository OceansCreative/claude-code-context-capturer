# Chrome Web Store Listing Materials

This file contains the text and asset specs you'll need when submitting the extension to the Chrome Web Store. Copy and paste as needed.

---

## Store listing — short description (132 chars max)

```
Capture web pages and claude.ai chats as Markdown. Append to CLAUDE.md, route by URL, or expose to Claude Code via MCP. Local.
```

## Store listing — detailed description (English)

```
Claude Code Context Capturer turns any web page into clean Markdown and writes it directly to your project's CLAUDE.md — closing the "I researched something for an hour, now my AI agent has none of that context" loop.

Why use it?
• URLs alone don't always work — many LLMs can't fetch external content reliably
• Copy-pasting brings noise (ads, menus, footers)
• Manual paste-into-CLAUDE.md doesn't survive busy days
• Different projects need different context files

What it does:
• Direct write to CLAUDE.md — pick the file once with the File System Access API; subsequent captures append to it automatically
• Multi-project routing — link multiple CLAUDE.md files and route by URL glob (e.g. github.com/anthropic/* → one file, zenn.dev/* → another)
• claude.ai conversation capture — capture your brainstorm conversations with Claude (thinking blocks, tool_use, branches preserved) straight into your project context
• Artifacts-only capture & range selection (v0.5.0+) — for long claude.ai planning chats, capture just the code/documents Claude wrote or only the last N messages, toggleable from the popup
• Re-capture updates in place (v0.5.0+) — re-capturing the same claude.ai conversation overwrites the existing capture instead of creating duplicate snapshots
• MCP server for on-demand context (v0.5.0+) — save captures to a directory and the bundled MCP server hands them to Claude Code only when it asks for them, keeping CLAUDE.md small. Tools: get_context / list_contexts / search_contexts / stats_contexts, with tag and date filtering
• Site-specific parsers for GitHub, Stack Overflow, Zenn, Qiita, MDN
• Generic parser (Mozilla Readability) for everything else
• Selection mode: capture just what you've highlighted
• Buffer mode: stack captures in extension storage for later export
• YAML frontmatter with URL, title, captured_at, tags
• One-click from toolbar / keyboard shortcut / right-click menu
• English and Japanese UI

Keyboard shortcuts:
• Ctrl+Shift+L (Cmd+Shift+L on macOS) — capture page
• Ctrl+Shift+K (Cmd+Shift+K on macOS) — capture selection

Privacy first:
• 100% local processing — nothing leaves your device
• No telemetry, no analytics, no external servers
• File handles stored locally in IndexedDB
• Open source under the MIT license

Source code: https://github.com/OceansCreative/claude-code-context-capturer
```

## Store listing — detailed description (Japanese)

```
Claude Code Context Capturer は、開いている Web ページを Markdown に変換して、プロジェクトの CLAUDE.md に直接書き込む Chrome 拡張機能です。「1 時間調べ物した内容が AI エージェントに伝わらない」という日常を解消します。

こんなときに便利:
• URL だけだと LLM が読み込めないことがある
• ページ全体をコピーすると広告・メニュー・フッターが混入する
• 手動コピペで CLAUDE.md を更新する習慣が続かない
• 複数プロジェクトで context file を使い分けたい

機能:
• CLAUDE.md への直接書き込み — File System Access API で一度ファイルを指定すれば、以降のキャプチャは自動で append
• マルチプロジェクト振り分け — URL パターン(glob)で複数の CLAUDE.md を使い分け(例: github.com/anthropic/* → 仕事用、zenn.dev/* → 個人メモ)
• claude.ai 会話のキャプチャ — claude.ai でブレストした会話を、thinking blocks / tool_use / branch 構造を保ったままプロジェクトの context file に流し込み
• アーティファクト抽出 & 範囲選択 (v0.5.0+) — 長い claude.ai 設計会話から、Claude が書いたコード／ドキュメントだけ、または直近 N 件のメッセージだけを選んでキャプチャ。popup からトグル可能
• 再キャプチャは上書き更新 (v0.5.0+) — 同じ claude.ai 会話を再キャプチャすると新しいスナップショットを増やさず既存ファイルを上書きします
• MCP サーバーによるオンデマンド供給 (v0.5.0+) — キャプチャを専用ディレクトリへ 1 件 1 ファイルで保存し、付属の MCP サーバーが Claude Code から要求された時だけ渡します。CLAUDE.md を肥大化させずに参照可能。tools: get_context / list_contexts / search_contexts / stats_contexts、タグ・日付フィルタ対応
• GitHub・Stack Overflow・Zenn・Qiita・MDN のサイト別パーサー
• その他のサイトは Mozilla Readability で本文抽出
• 選択範囲モード(テキスト選択時はその部分のみ)
• バッファモード(複数キャプチャを溜めて一括エクスポート)
• YAML frontmatter で URL・タイトル・取得日時・タグを自動付与
• ツールバー / ショートカット / 右クリックメニュー対応
• 英語・日本語 UI

キーボードショートカット:
• Ctrl+Shift+L(macOS: Cmd+Shift+L) — ページ全体
• Ctrl+Shift+K(macOS: Cmd+Shift+K) — 選択範囲

プライバシー:
• 100% ローカル処理 — データは端末から外に出ません
• テレメトリ・アナリティクス・外部サーバーへの通信は一切なし
• ファイルハンドルは IndexedDB にローカル保存
• MIT ライセンスのオープンソース

ソースコード: https://github.com/OceansCreative/claude-code-context-capturer
```

## Category

Productivity

## Language

English (primary), Japanese (secondary)

---

## Required visual assets

### Icon (already in repo)
- `public/icons/icon-128.png` — 128×128 PNG ✓ included

### Screenshots (need to be created)

The Chrome Web Store requires at least 1 and up to 5 screenshots, **1280×800 or 640×400 px**.

Suggested screenshots:
1. The options page showing the routes table (key differentiator vs other clippers)
2. The popup with "Capture page" and "Capture selection" buttons
3. A captured GitHub Issue rendered as Markdown inside CLAUDE.md (the killer feature)
4. The settings page with options visible
5. The buffer view showing multiple captures stacked

### Promotional tile (optional but recommended)
- **Small promo tile**: 440×280 PNG
- **Large promo tile**: 920×680 PNG
- **Marquee promo tile**: 1400×560 PNG

---

## Permissions justification (for the review form)

When submitting, the Chrome Web Store will ask you to justify each permission. Use these answers:

| Permission | Justification |
|---|---|
| `activeTab` | Required to read the content of the tab the user is actively viewing, only when they invoke a capture. |
| `clipboardWrite` | Required to copy the Markdown output to the user's clipboard, which is one of the available output modes. |
| `storage` | Required to save user preferences and the optional capture buffer locally. |
| `scripting` | Required to execute the clipboard write call inside the active tab's context. |
| `contextMenus` | Required to add "Capture page" and "Capture selection" entries to the right-click menu. |
| `offscreen` | Required to host a hidden document where File System Access API writes can run (MV3 service workers cannot access FSA directly). |
| `<all_urls>` host permission | Required so users can capture from any site they visit. The extension does not run automatically — capture only happens when the user explicitly triggers it. |

## Single purpose statement

```
The single purpose of this extension is to convert the web page the user is currently viewing into Markdown text and append it to the user's chosen CLAUDE.md file (or copy it to the clipboard) for use with AI coding assistants such as Claude Code.
```

## Privacy practices declaration

When asked "Does your extension handle any of the following user data?", the honest answer is:

- **Personally identifiable information** — No
- **Health information** — No
- **Financial and payment information** — No
- **Authentication information** — No
- **Personal communications** — No
- **Location** — No
- **Web history** — No
- **User activity** — No
- **Website content** — Yes, but only the page the user explicitly chooses to capture, and processed locally only

For "How is the user data used?":
- Only to provide the core extension functionality (Markdown conversion)
- Data is not sold, transferred, or used for advertising

For "Is the data encrypted in transit?":
- Not applicable — no data is transmitted off-device

## Privacy policy URL

Once published to a public URL, link to:
```
https://github.com/OceansCreative/claude-code-context-capturer/blob/main/PRIVACY.md
```

---

## Submission checklist

Before clicking "Submit for review":

- [ ] Built the extension (`npm run build`)
- [ ] Zipped the `dist/` directory contents (NOT the `dist` folder itself)
- [ ] Created a Chrome Web Store developer account ($5 one-time fee)
- [ ] Prepared at least 1 screenshot (1280×800)
- [ ] Filled in short description (≤132 chars)
- [ ] Filled in detailed description
- [ ] Selected category: Productivity
- [ ] Set primary language
- [ ] Added privacy policy URL
- [ ] Justified each permission
- [ ] Confirmed single purpose statement
- [ ] Tested the production build by loading `dist/` as an unpacked extension first
