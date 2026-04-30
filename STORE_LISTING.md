# Chrome Web Store Listing Materials

This file contains the text and asset specs you'll need when submitting the extension to the Chrome Web Store. Copy and paste as needed.

---

## Store listing — short description (132 chars max)

```
Convert any web page into clean Markdown for Claude Code, ChatGPT, and other LLMs. One click, with site-specific parsers.
```

## Store listing — detailed description (English)

```
Claude Code Context Capturer turns any web page into Markdown that's ready to paste into Claude Code, ChatGPT, or any LLM chat — without ads, navigation, or sidebars.

Why use it?
• URLs alone don't always work — many LLMs can't fetch external content reliably
• Copy-pasting the whole page brings noise (ads, menus, footers)
• You want to preserve the structure of GitHub Issues, Stack Overflow answers, technical articles

What it does:
• One-click capture from the toolbar or keyboard shortcut
• Site-specific parsers for GitHub, Stack Overflow, Zenn, Qiita, MDN
• Generic parser (powered by Mozilla Readability) for everything else
• Selection mode: capture just what you've highlighted
• Buffer mode: stack multiple captures and export them all at once
• YAML frontmatter with URL, title, captured_at, tags
• Localized: English and Japanese

Keyboard shortcuts:
• Ctrl+Shift+L (Cmd+Shift+L on macOS) — capture page
• Ctrl+Shift+K (Cmd+Shift+K on macOS) — capture selection

Privacy first:
• 100% local processing — nothing leaves your device
• No telemetry, no analytics, no external servers
• Open source under the MIT license

Source code: https://github.com/OceansCreative/claude-code-context-capturer
```

## Store listing — detailed description (Japanese)

```
Claude Code Context Capturer は、開いている Web ページを Claude Code・ChatGPT などに貼りやすい Markdown に変換する Chrome 拡張機能です。広告・ナビ・サイドバーを除いて本文だけを抽出します。

こんなときに便利:
• URL だけだと LLM が読み込めないことがある
• ページ全体をコピーすると広告・メニュー・フッターが混入する
• GitHub Issue / Stack Overflow / 技術記事の構造を保ったまま渡したい

機能:
• ツールバー or キーボードショートカットでワンクリック抽出
• GitHub・Stack Overflow・Zenn・Qiita・MDN の専用パーサー
• その他のサイトは Mozilla Readability で本文抽出
• 選択範囲モード(テキスト選択時はその部分のみ)
• バッファモード(複数キャプチャを溜めて一括エクスポート)
• YAML frontmatter で URL・タイトル・取得日時・タグを自動付与
• 英語・日本語ロケール

キーボードショートカット:
• Ctrl+Shift+L(macOS: Cmd+Shift+L) — ページ全体
• Ctrl+Shift+K(macOS: Cmd+Shift+K) — 選択範囲

プライバシー:
• 100% ローカル処理 — データは端末から外に出ません
• テレメトリ・アナリティクス・外部サーバーへの通信は一切なし
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
1. The popup with "Capture page" and "Capture selection" buttons
2. A captured GitHub Issue rendered as Markdown next to the source
3. The settings page with options visible
4. A Zenn or Qiita article being captured (for Japanese audience appeal)
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
| `clipboardWrite` | Required to copy the Markdown output to the user's clipboard, which is the primary purpose of the extension. |
| `storage` | Required to save user preferences and the optional capture buffer locally. |
| `scripting` | Required to execute the clipboard write call inside the active tab's context. |
| `contextMenus` | Required to add "Capture page" and "Capture selection" entries to the right-click menu. |
| `<all_urls>` host permission | Required so users can capture from any site they visit. The extension does not run automatically — capture only happens when the user explicitly triggers it. |

## Single purpose statement

```
The single purpose of this extension is to convert the web page the user is currently viewing into Markdown text for use with AI coding assistants (such as Claude Code) and other LLMs.
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
