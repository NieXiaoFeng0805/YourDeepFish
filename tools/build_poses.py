"""把抠好的姿态统一到同一头部尺度，输出桌宠用的三种姿态。

用法: python tools/build_poses.py
输出: assets/char/pose_idle.png / pose_happy.png / pose_sleep.png（2 倍尺寸）
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAR = os.path.join(ROOT, "assets", "char")

TARGET_HEAD = 192  # 2x 下的头部宽度，显示时为 96px

POSES = [
    ("pose_ref_03.png", "pose_idle.png", "坐姿茶杯"),
    ("pose_ref_05.png", "pose_happy.png", "坐姿眨眼"),
    ("pose_ref_06.png", "pose_sleep.png", "躺姿"),
]


def head_width(img):
    """取上半身区域里最宽的一行，近似头部（含发）宽度。"""
    a = np.array(img.convert("RGBA"))[:, :, 3]
    h = a.shape[0]
    band = a[: int(h * 0.45), :]
    widths = []
    for row in band:
        cols = np.where(row > 40)[0]
        if cols.size:
            widths.append(cols.max() - cols.min() + 1)
    return int(max(widths)) if widths else 0


def main():
    for src, dst, label in POSES:
        path = os.path.join(CHAR, src)
        if not os.path.exists(path):
            print("missing", src)
            continue
        img = Image.open(path).convert("RGBA")
        hw = head_width(img)
        scale = TARGET_HEAD / hw
        new = (max(1, round(img.size[0] * scale)), max(1, round(img.size[1] * scale)))
        out = img.resize(new, Image.LANCZOS)
        out.save(os.path.join(CHAR, dst))
        print(f"{dst:16s} {label}  headW {hw} -> {TARGET_HEAD}  size {new}")


if __name__ == "__main__":
    main()
