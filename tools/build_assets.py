"""把立绘处理成透明背景的角色资源（当前以 maid.png 为唯一形象基准）。

用法: python tools/build_assets.py
输出: assets/char/maid.png, assets/icon/*.png, build/preview_checker.png
"""
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "assets", "raw")
CHAR = os.path.join(ROOT, "assets", "char")
ICON = os.path.join(ROOT, "assets", "icon")
BUILD = os.path.join(ROOT, "build")

SRC = "maid.png"
OUT = "maid.png"
TARGET_H = 900
SOFT = 0.6
TOL = 26
KEEP_RATIO = 0.04


def keep_large(fg, ratio=KEEP_RATIO, floor=2000):
    lbl, n = ndimage.label(fg)
    if n <= 1:
        return fg
    sizes = np.bincount(lbl.ravel())
    sizes[0] = 0
    thr = max(sizes.max() * ratio, floor)
    keep = sizes >= thr
    keep[0] = False
    return keep[lbl]


def cut_white(path, tol=TOL):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    near_white = a.min(axis=2) >= 255 - tol
    lbl, _ = ndimage.label(near_white)
    border = np.concatenate([lbl[0, :], lbl[-1, :], lbl[:, 0], lbl[:, -1]])
    bg_ids = np.unique(border)
    bg_ids = bg_ids[bg_ids != 0]
    bg = np.isin(lbl, bg_ids) if bg_ids.size else np.zeros_like(near_white)
    return im, ~bg


def remove_shadow(rgba, y_start=0.90):
    """去掉立绘自带的脚下投影：按「与投影参考色混合程度」反解透明度。"""
    arr = np.array(rgba).astype(np.float32)
    h, w = arr.shape[:2]
    y0 = int(h * y_start)
    region = arr[y0:, :, :3]
    alpha = arr[y0:, :, 3]

    opaque = alpha > 200
    if not opaque.any():
        return rgba
    rgb = region[opaque]
    lum = rgb.mean(axis=1)
    mid = rgb[(lum > 170) & (lum < 240)]
    if len(mid) < 50:
        return rgba
    ref = np.median(mid, axis=0)

    p = 255.0 - region            # 偏离白色的量
    k = 255.0 - ref               # 投影色偏离白色的量
    denom = float((k * k).sum()) or 1.0
    t = np.clip((p * k).sum(axis=2) / denom, 0.0, 1.0)
    residual = np.linalg.norm(p - t[..., None] * k, axis=2)
    shadowish = residual < 25.0
    fade = np.clip((t - 0.30) / 0.35, 0.0, 1.0) * shadowish
    arr[y0:, :, 3] = alpha * (1.0 - fade)
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGBA")


def finalize(im, fg, soft=SOFT):
    fg = keep_large(fg)
    alpha = Image.fromarray((fg * 255).astype(np.uint8), "L")
    if soft > 0:
        alpha = alpha.filter(ImageFilter.GaussianBlur(soft))
    rgba = Image.merge("RGBA", (*im.split(), alpha))
    return rgba.crop(rgba.getbbox())


def fit_height(img, h):
    w = round(img.size[0] * h / img.size[1])
    return img.resize((max(1, w), h), Image.LANCZOS)


def checker(w, h, cell=24):
    yy, xx = np.mgrid[0:h, 0:w]
    grid = (((xx // cell) + (yy // cell)) % 2).astype(np.uint8)
    arr = np.where(grid[..., None] == 0, np.array([248, 248, 250], np.uint8), np.array([226, 228, 234], np.uint8))
    return Image.fromarray(arr, "RGB")


def main():
    for d in (CHAR, ICON, BUILD):
        os.makedirs(d, exist_ok=True)

    im, fg = cut_white(os.path.join(RAW, SRC))
    img = finalize(im, fg)
    img = remove_shadow(img)
    img = img.crop(img.getbbox())
    img = fit_height(img, TARGET_H)
    img.save(os.path.join(CHAR, OUT))
    print(OUT, img.size)

    canvas = checker(img.size[0] + 80, img.size[1] + 40)
    canvas.paste(img, (40, 20), img)
    canvas.save(os.path.join(BUILD, "preview_checker.png"))

    w, h = img.size
    head = img.crop((0, 0, w, int(h * 0.36)))
    head = fit_height(head, 60)
    icon = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    icon.paste(head, ((64 - head.size[0]) // 2, (64 - head.size[1]) // 2), head)
    icon.save(os.path.join(ICON, "tray.png"))
    icon.resize((32, 32), Image.LANCZOS).save(os.path.join(ICON, "tray32.png"))
    icon.resize((256, 256), Image.LANCZOS).save(os.path.join(ICON, "app.png"))
    print("icons written")


if __name__ == "__main__":
    main()
