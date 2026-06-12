# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

1 枚の画像から 3D Gaussian Splatting を生成・閲覧・調整する研究用デスクトップアプリ。生成は [TripoSplat](https://github.com/VAST-AI-Research/TripoSplat) の推論をアプリ内蔵の Python サイドカーで実行し、表示は Three.js + @mkkellogg/gaussian-splats-3d で行う。配布は想定せず、単一マシン（Windows 11 / NVIDIA Blackwell GPU）での研究利用が前提。

このプロジェクト固有の説明・判断基準・運用ルールは日本語で書く。コード・コマンド・API 名・ファイルパスは既存の表記を優先する。詳細な作業ルールは `AGENTS.md` を参照。

## 作業開始時の確認

作業前に以下を読み、今回の依頼が計画・進捗のどこに関係するかを把握する。方針と矛盾しそうな場合は実装前に確認する。

1. `docs/plan/goals.md` — 目的・完成形・重視する価値
2. `docs/plan/plan.md` — 実装方針・優先順位・今後の予定
3. `docs/plan/progress.md` — 現在の進捗・完了/未完了作業・注意点

## コマンド

```powershell
npm run dev        # 開発起動（HMR）
npm run build      # 本番ビルド（out/ に出力）
npm run preview    # ビルド済みを起動
npm run typecheck  # tsc --noEmit による型検証
```

- `start.bat` でも起動できる（引数 `build` で本番ビルド+preview、無指定で dev）。環境変数 `ELECTRON_RUN_AS_NODE=1` が設定されていると Electron が GUI として起動しないため、`start.bat` はこれをクリアしている。
- テストフレームワークは未導入。検証は `npm run build` / `npm run typecheck`、Python は `python -m py_compile python/server.py python/triposplat_runner.py` で行う。
- フロントエンドや型に関わる変更後は可能な限り `npm run build` を実行する。検証できなかった場合は理由を報告に書く。

## アーキテクチャ

4 つの層からなる Electron アプリ。main ↔ renderer は IPC、main/renderer ↔ サイドカーは localhost HTTP で通信する。

- **Electron main** (`src/main/index.ts`): ウィンドウ管理と Python サイドカーのライフサイクル。起動時に空きポートを動的確保してサイドカーを spawn し、`/health` をポーリングして準備完了を renderer に通知（`sidecar:status` / `sidecar:log` イベント）。終了時に kill する。
- **preload** (`src/preload/index.ts`): contextBridge で `window.api` を公開（サイドカーポート取得、状態/ログ購読、画像/Splat ファイルダイアログ）。
- **Renderer** (`src/renderer/src/`): React + Three.js。`App.tsx` が状態の中心。`api.ts` にサイドカーへの HTTP 呼び出しを集約（生成は `POST /generate` で jobId を受け取り進捗をポーリングする非同期方式）。`Viewer.tsx` が @mkkellogg/gaussian-splats-3d によるビューア（PLY/SPLAT/KSPLAT/SPZ 対応）。ローカルファイルはサイドカーの `/file?path=...` 経由で URL 化してロードする。
- **Python サイドカー** (`python/server.py`): FastAPI。`/health` `/gpu` `/weights` `/file` `/generate`。推論本体は `python/triposplat_runner.py`（`external/TripoSplat` を `sys.path` に追加して `TripoSplatPipeline` を構築、`models/ckpts` の重みを使用）。

### 実行環境の前提

- Python は `python/.venv` があればそれを優先、無ければシステム Python にフォールバック（`resolvePythonExe`）。
- GPU は Blackwell (sm_120)。**torch は cu128 以降が必須**（cu121 等では動かない）。`/gpu` エンドポイントが整合チェックと注意喚起を行う。
- TripoSplat 本体は pip パッケージではなく `external/TripoSplat` に clone して置く。モデル重みは `models/ckpts` に Hugging Face から取得する（セットアップ手順は README.md 参照）。
- UI のデザインは `docs/electron-design-rules.md` の基準（情報密度・状態設計・フォント/色のルール）に従う。

## ドキュメント・バージョン管理

- `docs/**/*.md` を新規作成・更新するときは、本文の先頭付近に `作成日時: YYYY-MM-DD HH:MM` / `更新日時: YYYY-MM-DD HH:MM` を書き、更新時は更新日時を現在に直す。
- ユーザー向けの明確な変更を行ったら `docs/changelog.md`（日本語）に記録し、必要に応じて `package.json` の `version` を更新する。未確定の変更は「未リリース」セクションに記録する。
- `docs/reference/` は設計資料・仕様メモ・調査資料の置き場。

## 作業ルール

- 既存の実装方針を確認してから変更する。変更は必要な範囲に留め、無関係な整形やリファクタリングを混ぜない。
- ユーザーの未コミット変更を勝手に戻さない。
- ファイルは UTF-8 (BOM なし) で書く。
