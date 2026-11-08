"""生成三选一对比图：白昼站姿 / 夜调站姿 / 夜色躺姿（已抠图）。"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAR = os.path.join(ROOT, "assets", "char")
BUILD = os.path.join(ROOT, "build")
FONT = "C:/Windows/Fonts/msyh.ttc"


def night_grade(img, gain=(0.60, 0.69, 0.92), lift=(6, 10, 22)):
    arr = np.array(img).astype(np.float32)
    rgb = arr[:, :, :3] * np.array(gain, np.float32) + np.array(lift, np.float32)
    # 轻微提亮暗部、压一点对比，模拟夜间环境光
    rgb = 255.0 * (rgb / 255.0) ** 0.92
    arr[:, :, :3] = rgb.clip(0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def main():
    stand = Image.open(os.path.join(CHAR, "maid.png")).convert("RGBA")
    lying = Image.open(os.path.join(BUILD, "night_cut.png")).convert("RGBA")

    h = 420
    stand_n = stand.resize((round(stand.size[0] * h / stand.size[1]), h), Image.LANCZOS)
    stand_d = night_grade(stand_n)
    lie = lying.resize((round(lying.size[0] * h / lying.size[1]), h), Image.LANCZOS)

    bg = (18, 26, 44)
    W, H = 1180, 620
    canvas = Image.new("RGB", (W, H), bg)
    draw = ImageDraw.Draw(canvas)
    title = ImageFont.truetype(FONT, 28)
    label = ImageFont.truetype(FONT, 20)

    panels = [
        ("A · 白昼站姿（当前）", stand_n),
        ("B · 夜调站姿", stand_d),
        ("C · 夜色躺姿", lie),
    ]
    x = 40
    for name, im in panels:
        canvas.paste(im, (x, 90), im)
        draw.text((x, 540), name, font=label, fill=(190, 205, 235))
        x += 380

    draw.text((40, 26), "小肥鱼 · 形象三选一", font=title, fill=(232, 240, 255))
    out = os.path.join(BUILD, "night_options.png")
    canvas.save(out)
    print("saved", out)


if __name__ == "__main__":
    main()
