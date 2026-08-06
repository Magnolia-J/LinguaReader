# 生成 LinguaReader 桌面图标：浅灰圆角方块 + 📖 翻开的书（带红色书签）
from PIL import Image, ImageDraw, ImageFilter

S = 512

def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

# 1) 浅灰圆角方块
BG = (236, 238, 242)
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S, S], radius=110, fill=255)
icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
icon.paste(Image.new("RGBA", (S, S), BG + (255,)), (0, 0), mask)

# 内描边
edge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ed = ImageDraw.Draw(edge)
ed.rounded_rectangle([1, 1, S - 1, S - 1], radius=109, outline=(214, 218, 224, 255), width=2)
icon.alpha_composite(edge)

# 2) 📖 翻开的书
book = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(book)

cx, cy = S / 2, S / 2
page_w = 168
page_h = 150
spine = 18
top_y = cy - page_h / 2 - 6
bot_y = cy + page_h / 2 - 6

COVER = (176, 58, 58)        # 书封（红褐，呼应 emoji）
COVER_D = (140, 40, 40)
PAGE = (253, 246, 230)       # 米白书页
PAGE_EDGE = (220, 210, 190)
RIBBON = (231, 76, 60)       # 红色书签

# 书影
sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(sh)
sd.polygon([
    (cx - page_w - spine / 2 + 6, top_y + 12),
    (cx + page_w + spine / 2 + 6, top_y + 12),
    (cx + page_w + spine / 2 + 6, bot_y + 16),
    (cx - page_w - spine / 2 + 6, bot_y + 16),
], fill=(40, 30, 30, 50))
book.alpha_composite(sh.filter(ImageFilter.GaussianBlur(9)))

# 封面（底层，比页面略大）
bd.polygon([
    (cx - spine / 2, top_y - 4),
    (cx - page_w - 6, top_y + 10),
    (cx - page_w - 6, bot_y + 4),
    (cx - spine / 2, bot_y),
], fill=COVER)
bd.polygon([
    (cx + spine / 2, top_y - 4),
    (cx + page_w + 6, top_y + 10),
    (cx + page_w + 6, bot_y + 4),
    (cx + spine / 2, bot_y),
], fill=COVER)

# 左页 / 右页
bd.polygon([
    (cx - spine / 2, top_y),
    (cx - page_w, top_y + 12),
    (cx - page_w, bot_y),
    (cx - spine / 2, bot_y),
], fill=PAGE, outline=PAGE_EDGE)
bd.polygon([
    (cx + spine / 2, top_y),
    (cx + page_w, top_y + 12),
    (cx + page_w, bot_y),
    (cx + spine / 2, bot_y),
], fill=PAGE, outline=PAGE_EDGE)

# 书脊
bd.rectangle([cx - spine / 2, top_y - 4, cx + spine / 2, bot_y], fill=COVER_D)

# 页面纹理
for i in range(1, 6):
    yy = top_y + 12 + (bot_y - top_y - 12) * i / 6
    off = (yy - top_y) * 0.10
    bd.line([(cx - page_w + 12 + off, yy), (cx - spine / 2 - 8, yy)], fill=(210, 200, 175), width=3)
    bd.line([(cx + spine / 2 + 8, yy), (cx + page_w - 12 + off, yy)], fill=(210, 200, 175), width=3)

# 顶部高光
bd.line([(cx - page_w, top_y + 12), (cx - spine / 2, top_y)], fill=(255, 255, 255), width=4)
bd.line([(cx + spine / 2, top_y), (cx + page_w, top_y + 12)], fill=(255, 255, 255), width=4)

# 红色书签（从书脊顶部垂下，超出底边）
bd.rectangle([cx - 12, top_y - 2, cx + 12, bot_y + 26], fill=RIBBON)
bd.polygon([
    (cx - 12, bot_y + 26), (cx - 12, bot_y + 44), (cx, bot_y + 32), (cx + 12, bot_y + 44), (cx + 12, bot_y + 26)
], fill=RIBBON)

icon.alpha_composite(book)

# 3) 导出多尺寸 ico + png
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
frames = [icon.resize(s, Image.LANCZOS) for s in sizes]
icon.save("app-icon.ico", sizes=[(s[0], s[1]) for s in sizes])
icon.resize((256, 256)).save("app-icon.png")
print("saved app-icon.ico / app-icon.png")
