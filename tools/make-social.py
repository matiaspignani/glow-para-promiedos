"""Builds the social pieces from the raw captures.
   python make-social.py <rawDir> <outDir>
   - welcome.gif, panel.gif (ffmpeg, palette-optimised)
   - antes-despues-ig-1080x1350.png, antes-despues-x-1600x900.png, antes-despues-story-1080x1920.png
   - antes.png, despues.png (1600 wide, clean)
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

RAW, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

# ---------- GIFs ----------
def make_gif(folder, name, width=860):
    seq = json.load(open(os.path.join(RAW, folder, "list.json")))
    lst = os.path.join(RAW, folder, "ffmpeg.txt")
    with open(lst, "w", encoding="utf-8") as f:
        for frame, hold in seq:
            p = os.path.join(RAW, folder, frame + ".png").replace("\\", "/")
            f.write(f"file '{p}'\nduration {hold}\n")
        f.write(f"file '{os.path.join(RAW, folder, seq[-1][0] + '.png').replace(chr(92), '/')}'\n")
    out = os.path.join(OUT, name)
    vf = (f"fps=12,scale={width}:-1:flags=lanczos,split[s0][s1];"
          f"[s0]palettegen=max_colors=160:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-vf", vf, "-loop", "0", out], check=True)
    print(name, round(os.path.getsize(out) / 1024), "KB")

make_gif("welcome", "bienvenida.gif")
make_gif("panel", "panel.gif")

# ---------- Before / after ----------
BG1, BG2 = (7, 19, 14), (20, 52, 36)
LIME, TEXT, MUTED = (182, 242, 107), (232, 241, 236), (138, 163, 153)

def font(size, bold=True):
    for path in (r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

def gradient(w, h):
    img = Image.new("RGB", (w, h), BG1)
    px = img.load()
    for y in range(h):
        t = y / h
        c = tuple(int(BG1[i] + (BG2[i] - BG1[i]) * (1 - t) * 0.55) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return img

before = Image.open(os.path.join(RAW, "before.png")).convert("RGB")
after = Image.open(os.path.join(RAW, "after.png")).convert("RGB")

def card(img, w, crop_h_ratio):
    """Scale a screenshot to width w, cropping the top region, with rounded corners and a soft shadow."""
    ch = int(img.height * crop_h_ratio)
    c = img.crop((0, 0, img.width, ch)).resize((w, int(ch * w / img.width)), Image.LANCZOS)
    mask = Image.new("L", c.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, c.width, c.height), radius=22, fill=255)
    out = Image.new("RGBA", c.size)
    out.paste(c, (0, 0), mask)
    return out

def paste_card(canvas, c, xy):
    x, y = xy
    shadow = Image.new("RGBA", (c.width + 80, c.height + 80), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((40, 50, 40 + c.width, 50 + c.height), radius=22, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.paste(shadow, (x - 40, y - 40), shadow)
    canvas.paste(c, (x, y), c)

def pill(draw, text, xy, fill, fg, size=30):
    f = font(size)
    x, y = xy
    w = draw.textlength(text, font=f)
    draw.rounded_rectangle((x, y, x + w + 44, y + size + 22), radius=(size + 22) // 2, fill=fill)
    draw.text((x + 22, y + 9), text, font=f, fill=fg)
    return w + 44

def centered(draw, text, y, f, fill, width):
    w = draw.textlength(text, font=f)
    draw.text(((width - w) / 2, y), text, font=f, fill=fill)

def stacked(w, h, name, crop, title_size, card_w, top, gap, foot_y):
    c = gradient(w, h).convert("RGBA")
    d = ImageDraw.Draw(c)
    centered(d, "Promiedos, pero con", 70 if h < 1500 else 150, font(title_size), TEXT, w)
    centered(d, "tu club primero", (70 if h < 1500 else 150) + title_size + 8, font(title_size), LIME, w)
    cb, ca = card(before, card_w, crop), card(after, card_w, crop)
    x = (w - card_w) // 2
    y1 = top
    pill(d, "ANTES", (x, y1 - 62), (60, 70, 66), TEXT)
    paste_card(c, cb, (x, y1))
    y2 = y1 + cb.height + gap
    pill(d, "DESPUÉS", (x, y2 - 62), LIME, BG1)
    paste_card(c, ca, (x, y2))
    d = ImageDraw.Draw(c)
    centered(d, "Glow para Promiedos", foot_y, font(44), TEXT, w)
    centered(d, "Extensión gratis para Chrome · no oficial", foot_y + 62, font(28, False), MUTED, w)
    c.convert("RGB").save(os.path.join(OUT, name), optimize=True)
    print(name)

# Instagram 4:5
stacked(1080, 1350, "antes-despues-ig-1080x1350.png", 0.62, 66, 940, 330, 100, 1190)
# Story 9:16
stacked(1080, 1920, "antes-despues-story-1080x1920.png", 0.70, 76, 960, 520, 120, 1700)

# X / landscape 16:9: side by side
W, H = 1600, 900
c = gradient(W, H).convert("RGBA")
d = ImageDraw.Draw(c)
centered(d, "Promiedos, pero con tu club primero", 44, font(62), TEXT, W)
cw = 740
cb, ca = card(before, cw, 1.0), card(after, cw, 1.0)
y = 235
xb, xa = 50, W - 50 - cw
pill(d, "ANTES", (xb, y - 58), (60, 70, 66), TEXT, 28)
paste_card(c, cb, (xb, y))
pill(d, "DESPUÉS", (xa, y - 58), LIME, BG1, 28)
paste_card(c, ca, (xa, y))
d = ImageDraw.Draw(c)
centered(d, "Glow para Promiedos · extensión gratis para Chrome · no oficial", 790, font(34), MUTED, W)
c.convert("RGB").save(os.path.join(OUT, "antes-despues-x-1600x900.png"), optimize=True)
print("antes-despues-x-1600x900.png")

# Clean singles
for src, dst in ((before, "antes.png"), (after, "despues.png")):
    im = src.resize((1600, int(src.height * 1600 / src.width)), Image.LANCZOS)
    im.save(os.path.join(OUT, dst), optimize=True)
print("antes.png, despues.png")
