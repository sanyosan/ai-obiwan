# あふれ出す力 — マンスリーAIオビワン

2026/7/27 ＠中百舌鳥 の登壇資料。主題は「集めるだけでいい」。

**スライド: https://sanyosan.github.io/ai-obiwan/**

## 中身

- `index.html` … スライド本体。単一ファイル完結（外部はGoogle Fontsのみ）
- `case-ryo.html` / `case-gordon.html` / `case-yuta.html` … 三人の使者の要件定義の全文
- `fig-evernote.svg` / `fig-obsidian.svg` / `fig-compare.svg` … 図版

## 操作

- `F` 全画面
- `→` `Space` クリックで次へ ／ `←` 画面左端クリックで戻る
- `[` `]` 背景画像の濃さを3%ずつ調整

Chrome / Edge 前提（ワイプ演出で `@property` を使用）。

## 画像について

背景画像・章扉の立ち絵はこの公開リポジトリには含めていない。
存在しないファイルは黙って無視されるので、画像なしでもスライドは成立する。

## 勤怠アプリ

同じリポジトリに、出退勤の予定登録と打刻を行う自作アプリを置いている。

- `kintai/` … スマホのホーム画面に置けるアプリ本体（PWA。iPhone / Android / PC）
- `attendance-app/` … Google Apps Script とスプレッドシートのバックエンド

セットアップ手順は [`attendance-app/README.md`](attendance-app/README.md) を参照。
