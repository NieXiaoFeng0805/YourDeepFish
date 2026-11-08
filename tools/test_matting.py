"""试验：给夜色坐卧图做抠图，看看能到什么程度。

只用于评估可行性，结果写到 build/matting_test.png。
"""
import os
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "raw", "night.png")
OUT = os.path.join(ROOT, "build", "matting_test.png")


def imread_u(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def largest_components(mask, keep_ratio=0.05):
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if n <= 1:
        return mask
    areas = stats[1:, cv2.CC_STAT_AREA]
    thr = max(areas.max() * keep_ratio, 800)
    keep = np.zeros(n, dtype=bool)
    for i, a in enumerate(areas, start=1):
        keep[i] = a >= thr
    return keep[labels]


def main():
    img = imread_u(SRC)
    h, w = img.shape[:2]

    mask = np.zeros((h, w), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    rect = (6, 6, w - 12, h - 12)
    cv2.grabCut(img, mask, rect, bgd, fgd, 6, cv2.GC_INIT_WITH_RECT)
    fg = (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)
    fg = largest_components(fg)

    alpha = (fg * 255).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha

    im = Image.fromarray(cv2.cvtColor(rgba, cv2.COLOR_BGRA2RGBA), "RGBA")
    im.save(os.path.join(ROOT, "build", "night_cut.png"))
    checker = Image.new("RGB", (w, h), (235, 238, 245))
    for y in range(0, h, 24):
        for x in range(0, w, 24):
            if (x // 24 + y // 24) % 2 == 0:
                checker.paste((252, 252, 254), (x, y, min(x + 24, w), min(y + 24, h)))
    checker.paste(im, (0, 0), im)
    checker.save(OUT)
    print("coverage", round(float(fg.mean()), 3), "->", OUT)


if __name__ == "__main__":
    main()
