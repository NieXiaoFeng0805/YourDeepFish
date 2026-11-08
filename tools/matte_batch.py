"""批量给参考图抠图，挑出能用的姿态。

用法: python tools/matte_batch.py
输出: assets/char/pose_<id>.png 与 build/matte_sheet.png（棋盘底检查图）
"""
import os
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "dataset", "raw")
OUT_DIR = os.path.join(ROOT, "assets", "char")
BUILD = os.path.join(ROOT, "build")

CANDIDATES = ["ref_03"]


def imread_u(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def keep_large(mask, ratio=0.08, floor=1500):
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if n <= 1:
        return mask
    areas = stats[1:, cv2.CC_STAT_AREA]
    main = 1 + int(np.argmax(areas))
    mx, my, mw, mh = stats[main, cv2.CC_STAT_LEFT], stats[main, cv2.CC_STAT_TOP], stats[main, cv2.CC_STAT_WIDTH], stats[main, cv2.CC_STAT_HEIGHT]
    thr = max(areas.max() * ratio, floor)
    keep = np.zeros(n, dtype=bool)
    keep[main] = True
    for i, a in enumerate(areas, start=1):
        if i == main or a < thr:
            continue
        # 只保留落在主体包围盒内的碎片，剔除窗框、地毯这类背景
        cx = stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] / 2
        cy = stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT] / 2
        if mx - mw * 0.05 <= cx <= mx + mw * 1.05 and my - mh * 0.05 <= cy <= my + mh * 1.05:
            keep[i] = True
    return keep[labels]


def matte(path, pad=8, iters=6):
    img = imread_u(path)
    h, w = img.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    rect = (pad, pad, w - pad * 2, h - pad * 2)
    cv2.grabCut(img, mask, rect, bgd, fgd, iters, cv2.GC_INIT_WITH_RECT)
    fg = (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)
    fg = keep_large(fg)
    alpha = (fg * 255).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha
    out = Image.fromarray(cv2.cvtColor(rgba, cv2.COLOR_BGRA2RGBA), "RGBA")
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def checker(w, h, cell=22):
    yy, xx = np.mgrid[0:h, 0:w]
    grid = (((xx // cell) + (yy // cell)) % 2).astype(np.uint8)
    arr = np.where(grid[..., None] == 0, np.array([250, 250, 252], np.uint8), np.array([228, 230, 238], np.uint8))
    return Image.fromarray(arr, "RGB")


def main():
    os.makedirs(BUILD, exist_ok=True)
    poses = []
    for name in CANDIDATES:
        path = os.path.join(SRC_DIR, name + ".png")
        if not os.path.exists(path):
            print("missing", path)
            continue
        cut = matte(path)
        cut = cut.resize((round(cut.size[0] * 640 / cut.size[1]), 640), Image.LANCZOS)
        out_name = f"pose_{name}.png"
        cut.save(os.path.join(OUT_DIR, out_name))
        poses.append((out_name, cut))
        print(out_name, cut.size)

    if poses:
        total_w = sum(p[1].size[0] for p in poses) + 40 * (len(poses) + 1)
        sheet = checker(total_w, 700)
        x = 40
        for _, im in poses:
            sheet.paste(im, (x, 30), im)
            x += im.size[0] + 40
        sheet.save(os.path.join(BUILD, "matte_sheet.png"))
        print("saved build/matte_sheet.png")


if __name__ == "__main__":
    main()
