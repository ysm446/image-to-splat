# Changelog

Image to Splat の変更履歴。日時は `YYYY-MM-DD HH:MM` 形式で書く。

## 未リリース

### 不具合修正: メッシュのテクスチャが表示されない（2026-06-13 11:20）

- メッシュ化した .glb を「メッシュ」表示すると真っ白（テクスチャ無し）になる不具合を修正しました。CSP の `connect-src` に `blob:` が無く、three.js GLTFLoader（ImageBitmapLoader）が埋め込みテクスチャを `fetch(blob:…)` で取得する際にブロックされ、テクスチャが `material.map` に載らずビューアの無灯火フォールバック色（灰色）で描画されていたためです。`connect-src` に `blob:` を追加して解消。GLB 自体（UV・テクスチャ・glTF 構造）は正常でした。

### メッシュ化（2026-06-13 04:12）

- Gaussian Splatting (.ply) のメッシュ化機能を追加しました。サイドカーに `POST /mesh`（非同期ジョブ、`/progress/{jobId}` でポーリング、`stage` に工程名）を追加し、`python/mesh_runner.py` が「密度場の構築 → marching cubes → 最大連結成分 + Taubin 平滑化 → xatlas による UV 自動展開 → ガウシアン色の kNN テクスチャ焼き込み → テクスチャ付き .glb 書き出し（outputs/）」を行います。
- 依存に scipy / scikit-image / xatlas / trimesh / plyfile を追加しました（requirements.txt 更新、venv に導入済み）。
- パラメータパネルに「メッシュ化」セクション（ボクセル解像度・表面しきい値・不透明度の下限・テクスチャサイズ・進捗バー）を追加。メッシュ化は `.ply` 表示中のみ実行できます。
- ビューポートの表示モードに「メッシュ」を追加し、メッシュ表示中はワイヤーフレーム切替チェックボックスを表示します。メッシュは焼き込みテクスチャをそのまま見せる無灯火（MeshBasicMaterial）表示で、上下反転にも追従します。
- 実データ（65,536 ガウシアン）で検証: 解像度 160 / テクスチャ 1024 で約 44 秒、177,546 面のテクスチャ付き GLB を生成。

### 環境修復（2026-06-13 04:12）

- `python/.venv` のベース Python だった miniconda が存在しなくなり venv が起動不能だったため、`pyvenv.cfg` を python.org の Python 3.13.11（`%LOCALAPPDATA%\Programs\Python\Python313`）へ付け替えて復旧しました（同一バージョンのため site-packages はそのまま、torch 2.11.0+cu128 / CUDA 利用可を確認）。

- アプリ名を「TripoSplat Studio」から「Image to Splat」へ変更しました（パッケージ名 `image-to-splat`）。モデル非依存で用途が明確な名前にし、公式 Tripo ブランドとの混同を避けるため。フォルダ名 `tripo-splat` は維持。なおモデル本体の「TripoSplat」表記（`external/TripoSplat`、`TripoSplatPipeline` 等）はそのまま。

### Phase 3: 生成進捗・入力画像プレビュー・D&D

- 生成をジョブ化しました。`/generate` は `jobId` を返し（非同期）、`/progress/{jobId}` でポーリングできます。TripoSplat の `callback(step,total)` で進捗を更新。
- 生成UIに進捗バーを追加（準備中＝モデル読込 → 生成中 step/total → 完了/エラー）。
- 入力画像のプレビュー表示を追加（サイドカー `/file` 経由、CSP の img-src に 127.0.0.1 を許可）。
- 画像・Gaussian ファイルのドラッグ&ドロップ読み込みに対応（Electron `webUtils.getPathForFile`。画像→入力、`.ply/.splat/.ksplat/.spz`→ビューア表示）。
- 背景除去 (BiRefNet) のオン/オフを切り替えるチェックボックスを追加（既定ON）。TripoSplat はアルファ無し画像へ自動で背景除去を適用するため、OFF 時は一様アルファを付与して除去をスキップさせる（本体無改変）。
- 前処理後画像（モデルが実際に見た画像＝背景除去・クロップ・1024リサイズ・黒背景合成後）を保存し、生成完了時にプレビュー表示するようにしました（`run()` の `prepared` を `outputs/*_prepared.png` に保存、`/progress` の `preparedPath` で返却）。

### Phase 2: TripoSplat 推論の内蔵

- 既存 venv(3.13) に torch 2.11.0+cu128 と TripoSplat 軽量依存（numpy/safetensors/pillow/tqdm/huggingface_hub）を導入しました。CUDA 12.8 / RTX PRO 5000 Blackwell(sm_120) で `cuda.is_available()=True` を確認。
- TripoSplat 本体を `external/TripoSplat` にクローンし、モデル重み（約3.5GB、5ファイル）を `models/ckpts` に取得しました。
- `triposplat_runner.run_inference` を実装し、`TripoSplatPipeline` を遅延シングルトンで構築、画像→Gaussian を生成して `outputs/` に `.ply` 保存します。
- サイドカーに `/weights`（重み有無）を追加し、`/generate` を実推論へ接続（steps/guidance/shift 対応）。stub を廃止。
- 生成 UI にステップ数・ガイダンス強度スライダーを追加。重み未取得時は「生成する」を無効化。
- ランナー単体検証: サンプル画像から 32768 ガウシアンの `.ply` を約12.9秒（初回・重みロード込み）で生成し、標準 3DGS PLY であることを確認。

### Phase 1

- プロジェクトを Image to Splat として再定義し、別プロジェクト（Road Editor）由来の docs / .gitignore を作り直しました。
- electron-vite + React + TypeScript の雛形を追加しました。
- Three.js + @mkkellogg/gaussian-splats-3d による Gaussian ビューア（`.ply` / `.splat` 読み込み、オービットカメラ、背景・点スケール調整）を追加しました。
- Python サイドカー（FastAPI: `/health`, `/gpu`, stub `/generate`）と、Electron main 側の spawn / `/health` 待ち / 終了処理を追加しました。
- 起動スクリプト `start.bat` を追加しました（引数なしで開発起動、`build` で本番ビルド起動。初回は npm install を自動実行）。`ELECTRON_RUN_AS_NODE` をクリアし、環境変数が設定済みでも GUI として起動するようにしました。
- 実機で GUI 起動とサイドカー（`/health` `/gpu` `/file` stub `/generate`）の動作を確認しました。サイドカー用の軽量 venv（fastapi/uvicorn、torch なし）で検証。
- ビューアの対応形式に `.spz`（Niantic の圧縮 Gaussian 形式）を追加しました（ファイルダイアログ、拡張子判定、形式マッピング）。
- 単一インスタンスロック（`app.requestSingleInstanceLock()`）を追加しました。多重起動による userData キャッシュの競合（`Unable to move/create the cache`, アクセス拒否 0x5）を防ぎます。
- `second-instance` ハンドラで破棄済みウィンドウを参照して `TypeError: Object has been destroyed` で落ちる不具合を修正しました（`isDestroyed()` チェックと、ウィンドウ `closed` 時の `mainWindow = null` 化）。
- サイドカー（FastAPI）に CORS ミドルウェアを追加しました。レンダラ（dev: localhost:5173 / 本番: file://）からの `/gpu` `/generate` `/file` 取得が CORS でブロックされる問題を解消します。
- CSP に `'wasm-unsafe-eval'` を追加し、mkkellogg の WebAssembly（ソート/SPZ デコード）が `script-src 'self'` でブロックされて描画できない問題を解消しました。
- React.StrictMode を外し、dev の二重マウントによるビューア破棄レース（`Scene disposed` / `removeChild`）を回避しました。残る既知の無害な破棄系拒否はグローバルの `unhandledrejection` で握り潰します。
- 表示に「上下反転 (Y)」トグルを追加しました（`cameraUp` の +Y/-Y 切替）。3DGS/SPZ など Y-down データの上下反転に対応。既定はON。
- 実機で SPZ ファイルの読み込み・3D 表示を確認しました（ビューア描画の動作確認完了）。
