"""生成角色设定卡：单一形象基准 maid.png + 主色板。

用法: python tools/character_sheet.py
输出: docs/character-sheet.png, docs/palette.json
"""
import json
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAR = os.path.join(ROOT, "assets", "char")
DOCS = os.path.join(ROOT, "docs")
FONT = "C:/Windows/Fonts/msyh.ttc"

SRC = "maid.png"


def palette(path, k=8):
    img = np.array(Image.open(path).convert("RGBA"))
    mask = img[:, :, 3] > 180
    rgb = img[mask][:, :3].astype(np.float32)
    if rgb.shape[0] > 40000:
        idx = np.random.default_rng(0).choice(rgb.shape[0], 40000, replace=False)
        rgb = rgb[idx]
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(rgb, k, None, criteria, 4, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.ravel(), minlength=k)
    order = np.argsort(-counts)
    out = []
    for i in order:
        c = centers[i].astype(int).tolist()
        out.append({"hex": "#%02X%02X%02X" % tuple(c), "rgb": c, "share": round(counts[i] / counts.sum(), 4)})
    return out


def main():
    os.makedirs(DOCS, exist_ok=True)
    title = ImageFont.truetype(FONT, 40)
    body = ImageFont.truetype(FONT, 24)
    small = ImageFont.truetype(FONT, 20)
    mono = ImageFont.truetype(FONT, 18)

    img = Image.open(os.path.join(CHAR, SRC)).convert("RGBA")
    h = 900
    img = img.resize((round(img.size[0] * h / img.size[1]), h), Image.LANCZOS)

    W, H = 1500, 1100
    sheet = Image.new("RGB", (W, H), (22, 30, 50))
    draw = ImageDraw.Draw(sheet)

    draw.text((60, 40), "小肥鱼 · 角色设定卡 v0.3", font=title, fill=(232, 240, 255))
    draw.text((62, 98), "全身基准：女仆小肥鱼（唯一形象来源）", font=small, fill=(150, 170, 210))

    sheet.paste(img, (70, 140), img)
    draw.text((70, 140 + h + 6), f"{img.size[0]}×{img.size[1]} · 透明底 PNG", font=small, fill=(140, 158, 195))

    cols = palette(os.path.join(CHAR, SRC))
    px, py = 820, 150
    draw.text((px, py - 44), "主色板", font=body, fill=(210, 224, 250))
    for i, c in enumerate(cols):
        x = px + (i % 2) * 320
        y = py + (i // 2) * 120
        draw.rounded_rectangle([x, y, x + 74, y + 74], radius=10, fill=tuple(c["rgb"]))
        draw.text((x + 88, y + 8), c["hex"], font=mono, fill=(206, 220, 248))
        draw.text((x + 88, y + 38), f"{c['share'] * 100:.1f}%", font=mono, fill=(150, 168, 205))

    notes = [
        "识别点：",
        "· 蓝紫渐变长发 + 白色褶边头饰",
        "· 猫耳（外深内白）+ 分叉鱼尾",
        "· 深藏青女仆裙 / 白色荷叶边",
        "· 围裙右下角蓝色鲸鱼",
        "· 蓝白蝴蝶结高跟鞋",
        "· 星形高光瞳孔",
    ]
    yy = 700
    for line in notes:
        draw.text((px, yy), line, font=small, fill=(186, 202, 236) if line.endswith("：") else (160, 178, 214))
        yy += 40

    sheet.save(os.path.join(DOCS, "character-sheet.png"))
    with open(os.path.join(DOCS, "palette.json"), "w", encoding="utf-8") as f:
        json.dump({"source": SRC, "size": img.size, "colors": cols}, f, ensure_ascii=False, indent=2)
    print("saved docs/character-sheet.png", img.size)


if __name__ == "__main__":
    main()
