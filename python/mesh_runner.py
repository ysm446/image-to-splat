"""Gaussian Splatting (.ply) のメッシュ化。

パイプライン:
1. 3DGS 形式の .ply からガウシアン（中心・色・不透明度・スケール）を読む
2. 不透明度を体素グリッドに散布し、ガウシアン平滑化で密度場を作る
3. marching cubes で等値面を抽出し、最大連結成分を残して平滑化する
4. xatlas で UV を自動展開する
5. UV 空間でラスタライズし、ガウシアンの色を kNN でテクスチャに焼き込む
6. テクスチャ付き .glb として outputs/ に書き出す

ガウシアンは面に正確に張り付いていない（浮いた半透明の粒で見た目を作る）ため、
メッシュ品質は近似的なものになる。しきい値・解像度はパラメータで調整する。
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Callable, Optional

import numpy as np

_THIS = Path(__file__).resolve().parent  # python/
_PROJECT = _THIS.parent
_OUTPUTS = _PROJECT / "outputs"

# 球面調和 0 次係数（3DGS の f_dc -> RGB 変換に使う）
_SH_C0 = 0.28209479177387814

ProgressCb = Optional[Callable[[int, str], None]]


def _report(cb: ProgressCb, percent: int, stage: str) -> None:
    if cb:
        cb(int(percent), stage)


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def load_gaussians(ply_path: str) -> dict:
    """3DGS 形式 .ply から中心・色・不透明度・代表スケールを読み出す。"""
    from plyfile import PlyData

    ply = PlyData.read(ply_path)
    v = ply["vertex"].data
    names = v.dtype.names or ()

    centers = np.stack([v["x"], v["y"], v["z"]], axis=1).astype(np.float32)

    if {"f_dc_0", "f_dc_1", "f_dc_2"} <= set(names):
        sh = np.stack([v["f_dc_0"], v["f_dc_1"], v["f_dc_2"]], axis=1).astype(np.float32)
        colors = np.clip(0.5 + _SH_C0 * sh, 0.0, 1.0)
    elif {"red", "green", "blue"} <= set(names):
        colors = np.stack([v["red"], v["green"], v["blue"]], axis=1).astype(np.float32) / 255.0
    else:
        colors = np.full((len(centers), 3), 0.7, dtype=np.float32)

    if "opacity" in names:
        opacities = _sigmoid(np.asarray(v["opacity"], dtype=np.float32))
    else:
        opacities = np.ones(len(centers), dtype=np.float32)

    if {"scale_0", "scale_1", "scale_2"} <= set(names):
        scales = np.exp(
            np.stack([v["scale_0"], v["scale_1"], v["scale_2"]], axis=1).astype(np.float32)
        )
        mean_scale = float(np.median(scales.mean(axis=1)))
    else:
        mean_scale = 0.0

    return {
        "centers": centers,
        "colors": colors,
        "opacities": opacities,
        "mean_scale": mean_scale,
    }


def _density_grid(
    centers: np.ndarray,
    opacities: np.ndarray,
    resolution: int,
    mean_scale: float,
) -> tuple[np.ndarray, np.ndarray, float]:
    """不透明度を体素に散布して平滑化した密度場を作る。

    戻り値: (grid, 原点ワールド座標, ボクセルサイズ)
    """
    from scipy.ndimage import gaussian_filter

    lo = centers.min(axis=0)
    hi = centers.max(axis=0)
    extent = float((hi - lo).max())
    if extent <= 0:
        raise ValueError("ガウシアンの広がりがありません（点が一致しています）")

    # 立方体ボクセルでグリッドを張る（端は 3% パディング）
    pad = extent * 0.03
    lo = lo - pad
    voxel = (extent + pad * 2) / resolution
    dims = np.maximum(((hi + pad - lo) / voxel).astype(int) + 1, 1)
    dims = np.minimum(dims, resolution + 2)

    idx = ((centers - lo) / voxel).astype(int)
    idx = np.clip(idx, 0, dims - 1)

    grid = np.zeros(tuple(dims), dtype=np.float32)
    np.add.at(grid, (idx[:, 0], idx[:, 1], idx[:, 2]), opacities)

    # 代表スケール（ガウシアンの実サイズ）をボクセル単位の平滑化幅に変換
    sigma = mean_scale / voxel if mean_scale > 0 else 1.2
    sigma = float(np.clip(sigma, 0.8, 3.0))
    grid = gaussian_filter(grid, sigma=sigma)
    return grid, lo, voxel


def _extract_mesh(
    grid: np.ndarray,
    origin: np.ndarray,
    voxel: float,
    iso: float,
    smooth_iters: int,
):
    """marching cubes -> 最大連結成分 -> Taubin 平滑化。"""
    import trimesh
    from skimage import measure

    positive = grid[grid > 0]
    if positive.size == 0:
        raise ValueError("密度場が空です（不透明度しきい値を下げてください）")
    # 等値面レベルは密度の 99 パーセンタイル基準の相対値にする（外れ値に強い）
    level = float(iso) * float(np.percentile(positive, 99))
    if level >= grid.max():
        raise ValueError("しきい値が高すぎて面を抽出できません")

    verts, faces, _normals, _vals = measure.marching_cubes(grid, level=level)
    verts = verts * voxel + origin

    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    parts = mesh.split(only_watertight=False)
    if len(parts) > 1:
        mesh = max(parts, key=lambda m: len(m.faces))
    if smooth_iters > 0:
        trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=smooth_iters)
    return mesh


def _unwrap_uv(mesh) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """xatlas で UV を自動展開する。戻り値: (vertices, faces, uvs)。"""
    import xatlas

    vmapping, indices, uvs = xatlas.parametrize(
        np.asarray(mesh.vertices, dtype=np.float32),
        np.asarray(mesh.faces, dtype=np.uint32),
    )
    return np.asarray(mesh.vertices, dtype=np.float32)[vmapping], indices, uvs


def _bake_texture(
    verts: np.ndarray,
    faces: np.ndarray,
    uvs: np.ndarray,
    tex_size: int,
    centers: np.ndarray,
    colors: np.ndarray,
    opacities: np.ndarray,
    progress_cb: ProgressCb,
    p_from: int,
    p_to: int,
):
    """UV 空間で各面をラスタライズし、texel の 3D 位置に最も近い
    ガウシアン k 個の重み付き平均色をテクスチャに焼き込む。"""
    from PIL import Image
    from scipy.ndimage import distance_transform_edt
    from scipy.spatial import cKDTree

    # trimesh の UV 規約（原点左下）。画像行は v を反転して求める。
    uv_px = np.clip(uvs, 0.0, 1.0) * (tex_size - 1)

    rows_all: list[np.ndarray] = []
    cols_all: list[np.ndarray] = []
    pos_all: list[np.ndarray] = []

    n_faces = len(faces)
    step = max(1, n_faces // 20)
    for fi in range(n_faces):
        if progress_cb and fi % step == 0:
            _report(
                progress_cb,
                p_from + (p_to - p_from) * 0.6 * fi / n_faces,
                "テクスチャ焼き込み（ラスタライズ）",
            )
        tri = faces[fi]
        t_uv = uv_px[tri]  # (3,2)
        p3 = verts[tri]  # (3,3)

        u0, v0 = np.floor(t_uv.min(axis=0)).astype(int)
        u1, v1 = np.ceil(t_uv.max(axis=0)).astype(int)
        if u1 < u0 or v1 < v0:
            continue

        # 重心座標の係数（2x2 逆行列）。退化三角形はスキップ。
        d = (t_uv[1] - t_uv[0], t_uv[2] - t_uv[0])
        det = d[0][0] * d[1][1] - d[1][0] * d[0][1]
        if abs(det) < 1e-12:
            continue

        us, vs = np.meshgrid(
            np.arange(u0, u1 + 1), np.arange(v0, v1 + 1), indexing="ij"
        )
        pu = us.ravel() - t_uv[0][0]
        pv = vs.ravel() - t_uv[0][1]
        b1 = (pu * d[1][1] - pv * d[1][0]) / det
        b2 = (pv * d[0][0] - pu * d[0][1]) / det
        b0 = 1.0 - b1 - b2
        eps = -1e-4
        mask = (b0 >= eps) & (b1 >= eps) & (b2 >= eps)
        if not mask.any():
            continue

        bary = np.stack([b0[mask], b1[mask], b2[mask]], axis=1)
        pos = bary @ p3
        rows_all.append((tex_size - 1) - vs.ravel()[mask])
        cols_all.append(us.ravel()[mask])
        pos_all.append(pos.astype(np.float32))

    if not pos_all:
        raise ValueError("テクスチャのラスタライズ結果が空です")

    rows = np.clip(np.concatenate(rows_all), 0, tex_size - 1)
    cols = np.clip(np.concatenate(cols_all), 0, tex_size - 1)
    pos = np.concatenate(pos_all)

    # 全 texel をまとめて kNN（近いガウシアンほど・濃いガウシアンほど効く）
    _report(progress_cb, p_from + (p_to - p_from) * 0.65, "テクスチャ焼き込み（色サンプル）")
    tree = cKDTree(centers)
    k = min(8, len(centers))
    dist, idx = tree.query(pos, k=k, workers=-1)
    if k == 1:
        dist, idx = dist[:, None], idx[:, None]
    w = opacities[idx] / (dist.astype(np.float32) ** 2 + 1e-8)
    texel_rgb = (w[..., None] * colors[idx]).sum(axis=1) / w.sum(axis=1)[..., None]

    tex = np.zeros((tex_size, tex_size, 3), dtype=np.float32)
    filled = np.zeros((tex_size, tex_size), dtype=bool)
    tex[rows, cols] = texel_rgb
    filled[rows, cols] = True

    # 未使用 texel を最近傍色で埋める（UV 境界の黒い継ぎ目を防ぐ）
    _report(progress_cb, p_from + (p_to - p_from) * 0.9, "テクスチャ焼き込み（継ぎ目処理）")
    if not filled.all():
        nearest = distance_transform_edt(~filled, return_indices=True)[1]
        tex = tex[nearest[0], nearest[1]]

    img = Image.fromarray((np.clip(tex, 0, 1) * 255).astype(np.uint8), mode="RGB")
    return img


def run_meshify(
    ply_path: str,
    resolution: int = 160,
    iso: float = 0.25,
    opacity_min: float = 0.15,
    texture_size: int = 1024,
    smooth_iters: int = 10,
    progress_cb: ProgressCb = None,
) -> dict:
    """Gaussian .ply をテクスチャ付き .glb にメッシュ化する。

    戻り値: {"glbPath": str, "vertices": int, "faces": int}
    """
    import trimesh

    _report(progress_cb, 2, "ガウシアン読み込み")
    g = load_gaussians(ply_path)
    keep = g["opacities"] >= float(opacity_min)
    if keep.sum() < 16:
        raise ValueError("不透明度しきい値で点がほぼ残りません（しきい値を下げてください）")
    centers = g["centers"][keep]
    colors = g["colors"][keep]
    opacities = g["opacities"][keep]

    _report(progress_cb, 10, "密度場の構築")
    grid, origin, voxel = _density_grid(centers, opacities, int(resolution), g["mean_scale"])

    _report(progress_cb, 25, "面の抽出 (marching cubes)")
    mesh = _extract_mesh(grid, origin, voxel, float(iso), int(smooth_iters))

    _report(progress_cb, 35, "UV 自動展開 (xatlas)")
    verts, faces, uvs = _unwrap_uv(mesh)

    img = _bake_texture(
        verts, faces, uvs, int(texture_size),
        centers, colors, opacities,
        progress_cb, 45, 90,
    )

    _report(progress_cb, 92, "GLB 書き出し")
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=img,
        metallicFactor=0.0,
        roughnessFactor=1.0,
        doubleSided=True,
    )
    out = trimesh.Trimesh(
        vertices=verts,
        faces=faces,
        visual=trimesh.visual.texture.TextureVisuals(uv=uvs, material=material),
        process=False,
    )

    _OUTPUTS.mkdir(parents=True, exist_ok=True)
    glb_path = _OUTPUTS / f"{Path(ply_path).stem}_mesh_{int(time.time())}.glb"
    out.export(str(glb_path))

    _report(progress_cb, 100, "完了")
    return {"glbPath": str(glb_path), "vertices": int(len(verts)), "faces": int(len(faces))}


if __name__ == "__main__":
    # 単体テスト用: python mesh_runner.py <input.ply>
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("ply")
    parser.add_argument("--resolution", type=int, default=160)
    parser.add_argument("--iso", type=float, default=0.25)
    parser.add_argument("--opacity-min", type=float, default=0.15)
    parser.add_argument("--texture-size", type=int, default=1024)
    args = parser.parse_args()

    t0 = time.time()
    result = run_meshify(
        args.ply,
        resolution=args.resolution,
        iso=args.iso,
        opacity_min=args.opacity_min,
        texture_size=args.texture_size,
        progress_cb=lambda p, s: print(f"  {p:3d}% {s}"),
    )
    print(f"done in {time.time() - t0:.1f}s: {result}")
