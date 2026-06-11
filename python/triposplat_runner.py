"""TripoSplat 推論のラッパ。

- 入力: 画像パス、ガウシアン数上限、シード
- 出力: 生成した .ply の絶対パス（outputs/ 配下）

TripoSplat 本体は pip パッケージではなくスクリプト構成のため、
`external/TripoSplat` を sys.path に追加して import する。
モデル重みは `models/ckpts/`（`hf download VAST-AI/TripoSplat`）に置く。
パイプラインは初回呼び出し時に一度だけ構築し、以後は使い回す。
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Callable, Optional

_THIS = Path(__file__).resolve().parent  # python/
_PROJECT = _THIS.parent  # tripo-splat/
_REPO = _PROJECT / "external" / "TripoSplat"
_CKPTS = _PROJECT / "models" / "ckpts"
_OUTPUTS = _PROJECT / "outputs"

# run_example.py と同じ重みレイアウト
_CKPT_FILES = {
    "ckpt_path": _CKPTS / "diffusion_models" / "triposplat_fp16.safetensors",
    "decoder_path": _CKPTS / "vae" / "triposplat_vae_decoder_fp16.safetensors",
    "dinov3_path": _CKPTS / "clip_vision" / "dino_v3_vit_h.safetensors",
    "flux2_vae_encoder_path": _CKPTS / "vae" / "flux2-vae.safetensors",
    "rmbg_path": _CKPTS / "background_removal" / "birefnet.safetensors",
}

_pipe = None  # シングルトン


def weights_ready() -> bool:
    """必要な重みファイルがすべて存在するか。"""
    return all(p.is_file() for p in _CKPT_FILES.values())


def missing_weights() -> list[str]:
    return [str(p) for p in _CKPT_FILES.values() if not p.is_file()]


def _get_pipe():
    global _pipe
    if _pipe is not None:
        return _pipe

    if not _REPO.is_dir():
        raise RuntimeError(
            f"TripoSplat リポジトリが見つかりません: {_REPO}. "
            "`git clone https://github.com/VAST-AI-Research/TripoSplat.git external/TripoSplat` を実行してください。"
        )
    if not weights_ready():
        raise RuntimeError(
            "モデル重みが不足しています。`hf download VAST-AI/TripoSplat --local-dir models/ckpts` で取得してください。"
            f" 不足: {missing_weights()}"
        )

    if str(_REPO) not in sys.path:
        sys.path.insert(0, str(_REPO))

    from triposplat import TripoSplatPipeline  # noqa: WPS433

    _pipe = TripoSplatPipeline(
        ckpt_path=str(_CKPT_FILES["ckpt_path"]),
        decoder_path=str(_CKPT_FILES["decoder_path"]),
        dinov3_path=str(_CKPT_FILES["dinov3_path"]),
        flux2_vae_encoder_path=str(_CKPT_FILES["flux2_vae_encoder_path"]),
        rmbg_path=str(_CKPT_FILES["rmbg_path"]),
        device="cuda",
    )
    return _pipe


def run_inference(
    image_path: str,
    max_gaussians: int,
    seed: int,
    steps: int = 20,
    guidance_scale: float = 3.0,
    shift: float = 3.0,
    remove_bg: bool = True,
    progress_cb: Optional[Callable[[int, int], None]] = None,
) -> dict:
    """画像から Gaussian を生成する。

    戻り値: {"plyPath": <生成した .ply>, "preparedPath": <前処理後画像 .png>}
    preparedPath はモデルが実際に見た画像（背景除去・クロップ・1024リサイズ・黒背景合成後）。

    remove_bg: 背景除去(BiRefNet)を行うか。TripoSplat は入力にアルファが無い画像へ
        自動的に背景除去を適用するため、OFF にしたい場合は一様アルファ(254)を付与して
        「アルファ有り」と認識させ、背景除去をスキップさせる（本体は無改変）。
    """
    pipe = _get_pipe()
    _OUTPUTS.mkdir(parents=True, exist_ok=True)

    # チェックボックスを“絶対的”にする（入力のアルファ有無に左右されない）。
    from PIL import Image  # noqa: WPS433

    rgb = Image.open(image_path).convert("RGB")
    if remove_bg:
        # アルファを落として has_real_alpha=False -> 必ず rmbg(BiRefNet) を適用
        image_arg: object = rgb
    else:
        # 一様アルファ(<255) -> has_real_alpha=True -> rmbg をスキップ
        rgb.putalpha(254)
        image_arg = rgb

    gaussian, prepared = pipe.run(
        image_arg,
        seed=seed,
        steps=steps,
        guidance_scale=guidance_scale,
        shift=shift,
        num_gaussians=int(max_gaussians),
        show_progress=False,
        callback=progress_cb,
    )

    stem = Path(image_path).stem
    base = f"{stem}_{int(max_gaussians)}_seed{seed}_{int(time.time())}"
    ply_path = _OUTPUTS / f"{base}.ply"
    gaussian.save_ply(str(ply_path))

    prepared_path = _OUTPUTS / f"{base}_prepared.png"
    try:
        prepared.save(str(prepared_path))
    except Exception:  # noqa: BLE001
        prepared_path = None

    return {
        "plyPath": str(ply_path),
        "preparedPath": str(prepared_path) if prepared_path else None,
    }
