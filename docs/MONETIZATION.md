# マネタイズロードマップ（2026-07-03 策定）

> 結論：**少額なら可能。ただし現在の 32 ユーザーでは直接課金の期待値はほぼゼロ**（フリーミアムの相場転換率 2–5% → 有料化しても 1 人前後）。
> したがって「今すぐ直接課金」ではなく、**①今すぐ仕込める間接マネタイズ → ②100〜300 ユーザーで検証 → ③300+ で Pro 課金**の三段構えにする。

## 前提（調査サマリ）

- Chrome Web Store の決済機能は 2021 年に廃止済み。課金は外部決済（ExtensionPay / Lemon Squeezy License API / Stripe 直）で行うのが現在の標準。
- フリーミアム転換率の相場は **2–5%**。開発者向けツールの相場価格は **買い切り $19.99–49.99 / サブスク $15–49/月**。
- 寄付（GitHub Sponsors / Buy Me a Coffee）は「ユーザー数が多くないと意味のある額にならない」が、**設置コストがゼロ**なので置かない理由はない。
- 本拡張は MIT・完全ローカル・サーバレス。ライセンスゲートを入れてもフォークで外せるが、実務上この規模ではフォーク対策より「払いやすさ」の方が重要。
- **既に Lemon Squeezy ストアがあり、README 冒頭で Power Pack（$29）を販売中** — 決済インフラは実質構築済み。この拡張の最大の資産は「Claude Code ユーザーという極めて絞られたオーディエンスへの導線」。

## 収益モデルの比較

| モデル | 32 ユーザー時点の期待値 | 備考 |
|---|---|---|
| 寄付（Sponsors / BMC） | ¥0〜数百円/月 | コストゼロ。ブランディング効果はある |
| **Power Pack へのクロスセル** | **$29 × 月 0〜2 件** | 既存導線の強化のみ。今いちばん現実的 |
| Pro 版（買い切り $19〜29） | 転換 3% → 1 人 | 300+ ユーザーから意味を持つ |
| サブスク | ほぼゼロ | サーバレス構成と相性が悪い。当面見送り |
| 受託・コンサルの営業導線 | 案件 1 件で拡張収益を超える | OceansBase 本業とのシナジー。金額換算はしにくいが実質最大 |

## ロードマップ

### Phase 0 — 今すぐ（コストゼロ・1〜2 時間）

1. ~~GitHub Sponsors + Buy Me a Coffee を開設~~ → **やらないと決定** *(2026-07-03)*：開設・出金設定の手間に対して期待値がほぼゼロのため。`.github/FUNDING.yml` は Lemon Squeezy の custom リンクのみ設置済み（Sponsor ボタン → Power Pack 導線として機能、メンテ不要）
2. **Power Pack クロスセルの動線強化**：
   - [x] options 画面フッターに 1 行の静かなリンクを追加 *(2026-07-03)*
   - [x] README の Power Pack バナーに「この拡張と組み合わせる使い方」を追記（日英）*(2026-07-03)*
3. **計測**：Lemon Squeezy の UTM 付きリンク（`?utm_source=cccc-ext` など）で、拡張経由の売上を分離できるようにする
   - [x] README（`utm_medium=readme`）/ options（`utm_medium=options`）/ FUNDING.yml（`utm_medium=github-funding`）に UTM 付与 *(2026-07-03)*

**目標：拡張経由の Power Pack 売上が月 1 件でも立つか観測する。**

### Phase 1 — 100 ユーザー到達まで（〜2026 Q3、成長優先）

- 直接課金は**入れない**。今フリクションを足すと 100 ユーザー到達が遠のく
- 既存の成長施策（パーサー追加・HN / Reddit / X 投稿）を継続
- 並行して「**Pro に切り出せる機能**」の芽をリストアップしておく：
  - 候補 A：クラウド同期（ルート設定・キャプチャバッファをデバイス間同期）— サーバが要るのでサブスク向き
  - 候補 B：チーム共有ルート / エクスポートテンプレート集
  - 候補 C：MCP サーバの高度機能（要約・自動タグ付け・埋め込み検索）
  - **原則：コア（キャプチャ→CLAUDE.md 書き込み）は永久無料・OSS のまま。** 既存機能を後から有料化しない（既存ユーザーは grandfather する、が調査でも定石）

### Phase 2 — 100〜300 ユーザー（検証フェーズ）

1. **意思確認を先に取る**：options 画面に「Pro 版（$19 買い切り）があったら欲しい機能アンケート」または waitlist リンクを設置。**20 人以上が waitlist に入ったら Phase 3 へ**、集まらなければ Power Pack 導線と寄付のまま維持
2. 価格仮説：**買い切り $19**（開発者ツール相場の下限。サブスクはローカル完結の思想と矛盾するので買い切り）
3. 決済は **Lemon Squeezy License API**（既存ストアで完結、ライセンスキー発行・アクティベーション上限管理が標準機能）。ExtensionPay は新規アカウントが増えるだけなので不採用

### Phase 3 — 300+ ユーザー（Pro リリース）

1. Phase 1 でリストした候補から**新規機能のみ**を Pro 化して実装
2. ライセンスキー入力欄を options に追加。検証は緩く（インストール時 + 7 日ごとのチェック程度。オフライン時は通す）
3. 期待値の目安：300 ユーザー × 3% × $19 ≈ **$170（初回バースト）**、以降は新規ユーザー流入に比例
4. 1,000 ユーザー到達時に価格・機能を見直し（$29 への引き上げ、チーム向けの検討）

## KPI

| 時期 | 指標 | 目標 |
|---|---|---|
| Phase 0 直後〜 | 拡張経由 Power Pack 売上（UTM 計測） | 月 1 件 |
| Phase 1 | WAU / ストアユーザー数 | 100 人 |
| Phase 2 | Pro waitlist 登録数 | 20 人（Go/No-Go ライン） |
| Phase 3 | Pro 転換率 | 3% |

## やらないこと

- 広告・アフィリエイトの埋め込み（信頼を毀損、開発者向けツールでは致命的）
- テレメトリ / データ販売（PRIVACY.md の「100% ローカル」訴求と矛盾）
- 既存無料機能の有料化への切り下げ
- 現時点でのサブスク導入
- 寄付（GitHub Sponsors / Buy Me a Coffee）— 開設・出金の手間に対し期待値ゼロのため見送り *(2026-07-03 決定)*

## 参考

- [ExtensionPay](https://extensionpay.com/) / [Add Paid Licenses to Chrome Extensions](https://extensionpay.com/articles/add-paid-licenses-to-chrome-extensions)
- [How to Monetize a Chrome Extension in 2026 (Dodo Payments)](https://dodopayments.com/blogs/monetize-chrome-extension)
- [Browser Extension Monetization Statistics 2026 (Konabayev)](https://konabayev.com/blog/extension-monetization-statistics-2026/)
- [Temptations of an open-source browser extension developer (hoverzoom discussion)](https://github.com/extesy/hoverzoom/discussions/670)
- [Monetize Open Source: 5 Ways to Earn $1K/Month (Markaicode)](https://markaicode.com/monetize-open-source-github-income/)
