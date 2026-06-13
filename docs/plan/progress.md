# Image to Splat 進捗メモ

作成日: 2026-06-10 23:47
更新日: 2026-06-13 11:25

このページは、Image to Splat の目標に対して何が終わっていて、残りに何が必要かをまとめる。
進捗率は厳密な工数ではなく、機能の見通しを共有するための目安とする。

## 全体感

| 領域 | 進捗 | 状態 |
|---|---:|---|
| プロジェクト初期化 | 着手 | docs を TripoSplat 用に作り直し、Electron 雛形をスキャフォールド中 |
| アプリ基盤 | 動作確認 | electron-vite + React + サイドカー配線（Phase 1）、GUI 起動・疎通確認済み |
| ビューア | 動作確認 | Three.js + @mkkellogg で SPZ 表示確認。PLY/SPLAT/KSPLAT/SPZ 対応 |
| 推論内蔵 | 動作確認 | venv(3.13) + torch 2.11+cu128 + TripoSplat 導入。ランナー単体で画像→.ply 生成確認（Phase 2） |
| パラメータ/エクスポート | 進行中 | Phase 3: 生成進捗バー・入力画像プレビュー・D&D を実装＆検証。エクスポート/履歴/表示パラメータ拡充は今後 |

## 環境メモ

- OS: Windows 11 Pro。
- GPU: NVIDIA RTX PRO 5000 Blackwell（driver 582.08, sm_120）。
- システム CUDA: nvcc 13.1。torch は cu128 以降のホイールを使う方針。
- Python: PATH 上は Microsoft Store スタブのみ。実体は python.org の Python 3.13.11（`%LOCALAPPDATA%\Programs\Python\Python313`、`py -3.13` で起動可）。
  - 旧ベースの Miniconda は削除済み。`python/.venv` は 2026-06-13 に `pyvenv.cfg` を python.org 3.13.11 へ付け替えて復旧した（site-packages はそのまま）。
- `uv` は未インストール。

## 最近進んだこと

- メッシュ化機能を追加（2026-06-13）。`python/mesh_runner.py`（密度場 → marching cubes → xatlas UV 展開 → kNN テクスチャ焼き込み → .glb）、サイドカー `POST /mesh` ジョブ、UI の「メッシュ化」セクション、表示モード「メッシュ」とワイヤーフレーム切替。実データで端から端まで検証済み。
- 壊れていた `python/.venv` を復旧（2026-06-13）。ベースの miniconda 消失が原因で、`pyvenv.cfg` を python.org 3.13.11 へ付け替え。torch 2.11.0+cu128 / CUDA 動作を再確認。
- フォルダに残っていた別プロジェクト（Road Editor）由来の docs/.gitignore/changelog を TripoSplat 用に作り直した。AGENTS.md は汎用ルールとして流用。
- electron-vite + React + TypeScript の雛形を作成（`src/main` `src/preload` `src/renderer`）。
- Electron main に Python サイドカーの spawn / 動的ポート確保 / `/health` 待ち / 終了処理 / ログ転送を実装。
- preload で contextBridge による API 公開（ポート取得、状態購読、ログ購読、画像/Splat ダイアログ）。
- Three.js + @mkkellogg/gaussian-splats-3d のビューアコンポーネント（背景色・透明度しきい値・形式自動判定）。
- パラメータパネル（生成: ガウシアン数上限/シード、表示: 背景色/しきい値）とステータスバー（サイドカー状態・GPU 情報）を実装。
- Python サイドカー（FastAPI: `/health` `/gpu` `/file` stub `/generate`）を実装。`/gpu` で Blackwell=cu128 整合の注意喚起。
- `npm install` / `npm run build` / `npm run typecheck` / `py_compile` の検証を通過。

## 完了または概ね完了していること（Phase 1 雛形）

- Electron アプリの基盤（main/preload/renderer）とビルド・型検証の通過。
- サイドカーの起動・監視・終了のライフサイクル管理と動的ポート。
- `.ply` / `.splat` / `.ksplat` の読み込み（ダイアログ）とビューア表示の配線。
- 表示パラメータ（背景色、透明度しきい値）の最小セット。
- README とセットアップ手順（フロント / Phase 2 の venv+torch cu128+TripoSplat）。

## 検証済み（実機）

- `start.bat`（`npm run dev`）で Electron GUI が起動することを確認。
  - 注意: 環境に `ELECTRON_RUN_AS_NODE=1` が設定されており、そのままだと Electron が Node として起動して `require('electron')` がパス文字列を返し `app.isPackaged` で落ちる。`start.bat` でこの変数をクリアして回避済み。
- サイドカー単体（fastapi/uvicorn の軽量 venv）で各エンドポイントを確認:
  - `/health` → `{"status":"ok"}`
  - `/gpu` → torch 未導入を正しく報告（Phase 2 で torch cu128 導入予定）
  - `/generate` → stub の `not_implemented` 応答
  - `/file` → ローカルファイル配信が動作

## 検証済み（ビューア描画）

- 実機で SPZ ファイルを読み込み、3D 表示できることを確認（Phase 1 のビューア動作確認完了）。
- 描画に必要だった修正:
  - CSP に `'wasm-unsafe-eval'`（mkkellogg の WebAssembly 用）。
  - React.StrictMode 除去＋既知の破棄系拒否の握り潰し（`Scene disposed` / `removeChild`）。
  - 「上下反転 (Y)」トグル（`cameraUp` 切替）で Y-down データの上下反転に対応（既定ON）。

## 未検証・要確認

- `.ply` / `.splat` / `.ksplat` の表示は未確認（SPZ で描画パスは確認済みのため動作見込みだが要確認）。
- 現状の `python/.venv` は base(3.13) から作成（サイドカーのみ）。Phase 2 で torch/TripoSplat を入れる際に Python 3.11 環境へ作り直す方針。

## 進行中のこと

- ビューアの実描画確認（実ファイルでのロード）。
- Phase 2: venv(3.11) + torch cu128 + TripoSplat の導入。

## 残りに必要なこと

### 近い優先度（Phase 1 完了まで）

- Electron main の Python サイドカー spawn / `/health` 待ち / 終了処理を仕上げる。
- 動的ポート確保と preload 経由の API 公開。
- `.ply` / `.splat` の読み込み（D&D / ダイアログ）とビューア表示。
- 表示パラメータ（背景、点スケール、ソート品質）の最小セット。
- `npm run build` が通る状態の確認。

### 中期（Phase 2）

- venv(3.11) 構築、torch cu128、TripoSplat 依存の導入手順を確立する。
- モデル重みの初回取得とローカル展開、キャッシュ管理。
- `triposplat_runner.py` で実推論を実装し `/generate` に接続。
- 生成進捗（SSE / ポーリング）と結果の自動ロード。
- `/gpu` で CUDA/Blackwell 整合を確認・表示。

### 後期（Phase 3）

- 生成パラメータ（シード、ガウシアン数上限など）の拡充。
- 表示パラメータ（露出/トーン、クリッピング等）の拡充。
- `.ply` / `.splat` エクスポート。
- メッシュ（`.glb`）のエクスポート（現状は `outputs/` へ自動書き出しのみ。保存先を選ぶ「名前を付けて保存」を追加する）。
- 生成履歴、最近開いたファイル、ログ表示、エラーハンドリング整理。

## 判断したいこと

- 生成進捗は SSE とポーリングのどちらにするか。
- モデル重みの取得元・バージョン固定方針。
- 表示パラメータのうち、どこまでをユーザー公開するか。

## 関連ドキュメント

- `docs/plan/goals.md`
- `docs/plan/plan.md`
- `docs/changelog.md`
