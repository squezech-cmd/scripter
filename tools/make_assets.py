"""Generate the original tile/prop textures and synthesized audio used by the game.

Run from the repository root with Pillow installed. The burger poster was made
separately and is intentionally not overwritten here.
"""
from __future__ import annotations
import math, random, struct, wave
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
TEX = ROOT / 'assets' / 'textures'
SND = ROOT / 'assets' / 'sounds'
TEX.mkdir(parents=True, exist_ok=True); SND.mkdir(parents=True, exist_ok=True)
rng = random.Random(7824)


def noise_image(name, base, amount=8, size=512):
    im = Image.new('RGB', (size, size))
    pixels = []
    for y in range(size):
        for x in range(size):
            v = rng.gauss(0, amount)
            pixels.append(tuple(max(0, min(255, int(c + v))) for c in base))
    im.putdata(pixels)
    return im


def save(im, name): im.save(TEX / name, optimize=True)

# The grout and wear are part of the texture rather than an opaque flat color.
floor = noise_image('floor', (182, 94, 60), 5)
d = ImageDraw.Draw(floor)
for x in range(0, 513, 128):
    d.line((x, 0, x, 512), fill=(91, 66, 57), width=5)
    d.line((x + 4, 0, x + 4, 512), fill=(212, 130, 89), width=2)
for y in range(0, 513, 128):
    d.line((0, y, 512, y), fill=(91, 66, 57), width=5)
    d.line((0, y + 4, 512, y + 4), fill=(212, 130, 89), width=2)
for _ in range(350):
    x,y=rng.randrange(512),rng.randrange(512); d.point((x,y), fill=(147,82,61))
save(floor, 'floor_terracotta.png')

checker = Image.new('RGB', (512, 512)); d = ImageDraw.Draw(checker)
for y in range(8):
    for x in range(8):
        col=(224,215,191) if (x+y)%2==0 else (76, 100, 94)
        d.rectangle((x*64,y*64,x*64+63,y*64+63), fill=col)
        d.rectangle((x*64+1,y*64+1,x*64+62,y*64+62),outline=(155,151,135),width=1)
for _ in range(6000):
    x,y=rng.randrange(512),rng.randrange(512); c=checker.getpixel((x,y)); v=rng.randint(-8,8)
    d.point((x,y),fill=tuple(max(0,min(255,t+v)) for t in c))
save(checker, 'checker.png')

wall = noise_image('wall', (237,224,190), 2)
save(wall, 'plaster.png')
tiles = noise_image('tiles', (231,226,209), 2)
d=ImageDraw.Draw(tiles)
for x in range(0,513,128): d.line((x,0,x,512),fill=(168,165,151),width=4)
for y in range(0,513,128): d.line((0,y,512,y),fill=(168,165,151),width=4)
save(tiles, 'wall_tiles.png')

metal=noise_image('metal',(154,165,163),2); d=ImageDraw.Draw(metal)
for y in range(512):
    if rng.random()<.68:
        val=rng.randint(120,196); d.line((0,y,512,y), fill=(val,val+min(5,255-val),val+min(4,255-val)),width=1)
for _ in range(110):
    x,y=rng.randrange(512),rng.randrange(512)
    d.line((x,y,min(511,x+rng.randint(8,120)),y),fill=(192,199,193),width=1)
save(metal,'steel.png')

wood=noise_image('wood',(154,97,54),4); d=ImageDraw.Draw(wood)
for y in range(0,512,128):
    d.line((0,y,512,y),fill=(91,54,34),width=3)
    for _ in range(35):
        yy=y+rng.randrange(3,125); val=rng.randint(80,155)
        d.line((0,yy,512,yy+rng.randint(-3,3)),fill=(val,int(val*.65),int(val*.38)),width=rng.choice([1,1,2]))
save(wood,'wood.png')

patty=noise_image('patty',(115,67,42),17); d=ImageDraw.Draw(patty)
for y in range(-100,650,55): d.line((-20,y,540,y+140),fill=(73,38,24),width=8)
save(patty,'patty.png')

bun=noise_image('bun',(208,143,68),8); d=ImageDraw.Draw(bun)
for _ in range(160):
    x,y=rng.randrange(512),rng.randrange(512)
    d.ellipse((x-3,y-1,x+3,y+2),fill=(250,222,162))
save(bun,'bun.png')

asphalt=noise_image('asphalt',(72,83,81),9); d=ImageDraw.Draw(asphalt)
for _ in range(1500):
    x,y=rng.randrange(512),rng.randrange(512)
    d.point((x,y),fill=(116,123,119))
save(asphalt,'asphalt.png')

# Menu boards are deliberately brand-new artwork, not extracted from the reference game.
font_regular=str(ROOT/'assets/fonts/DejaVuSans.ttf')
font_bold=str(ROOT/'assets/fonts/DejaVuSans-Bold.ttf')
def font(size,bold=False): return ImageFont.truetype(font_bold if bold else font_regular,size)
menu=Image.new('RGB',(1200,460),(23,63,58)); d=ImageDraw.Draw(menu)
d.rounded_rectangle((8,8,1192,452),radius=18,outline=(237,196,102),width=5)
d.rectangle((32,28,1168,78), fill=(236,184,79))
d.text((52,31),'THE SHIFT  /  ALL DAY MENU',font=font(32,True),fill=(21,58,53))
sections=[('01','CHEESE','beef, cheddar','18'),('02','FRESH','cheese, lettuce','22'),('03','TOMATO','cheese, tomato','23'),('04','HOUSE','the works','27')]
for i,(n,title,desc,price) in enumerate(sections):
    x=54+i*285
    d.text((x,112),n,font=font(27,True),fill=(242,185,77))
    d.text((x,160),title,font=font(33,True),fill=(255,245,218))
    d.text((x,211),desc,font=font(21),fill=(198,220,204))
    d.line((x,260,x+228,260),fill=(85,123,111),width=2)
    d.text((x,280),'$'+price,font=font(40,True),fill=(241,185,78))
d.text((55,391),'GOOD FOOD.  GOOD COMPANY.  GOOD SHIFT.',font=font(22,True),fill=(210,226,204))
save(menu,'menu.png')

sign=Image.new('RGB',(1024,256),(229,83,51)); d=ImageDraw.Draw(sign)
d.rounded_rectangle((10,10,1013,245),radius=24,outline=(255,229,176),width=8)
d.text((54,33),'SHIFT',font=font(128,True),fill=(255,241,207))
d.text((501,44),'DINER',font=font(98,True),fill=(255,207,103))
d.text((60,188),'BURGERS  /  FRIES  /  GOOD TIMES',font=font(25,True),fill=(255,235,205))
save(sign,'sign.png')

sky=Image.new('RGB',(512,512)); pix=sky.load()
for y in range(512):
    t=y/511
    for x in range(512):
        pix[x,y]=(int(125+70*t),int(185+30*t),int(210+10*t))
save(sky,'sky.png')

# All effects and the loop below are synthesized from scratch, so no assets
# or copyrighted recordings from the commercial game are shipped.
SR=22050
def write_wav(name, samples):
    with wave.open(str(SND/name),'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b''.join(struct.pack('<h', max(-32767,min(32767,int(s*32767)))) for s in samples))
def tone(name, notes, duration=.20, volume=.35):
    samples=[]
    for i in range(int(SR*duration)):
        t=i/SR; env=math.exp(-t*12) * min(1,t*90)
        samples.append(volume*env*sum(math.sin(2*math.pi*f*t) for f in notes)/len(notes))
    write_wav(name,samples)
tone('click.wav',[520],.12,.24)
tone('pickup.wav',[610,920],.16,.23)
tone('flip.wav',[330,460],.22,.22)
tone('ding.wav',[660,990,1320],.65,.32)
tone('success.wav',[523.25,659.25,783.99],.9,.34)
tone('bad.wav',[165,175],.35,.25)
tone('trash.wav',[190,220],.18,.16)
tone('sizzle.wav',[110,145],.35,.17)
tone('finish.wav',[440,554.37,659.25,880],1.1,.32)

# 16-bar, unobtrusive original lo-fi diner loop.
# Keep it small and loop seamlessly with a fade at the boundary.
bpm=106; beat=60/bpm; duration=beat*32
chords=[(130.81,164.81,196.0),(146.83,174.61,220.0),(110.0,138.59,164.81),(123.47,155.56,185.0)]
melody=[261.63,329.63,392.0,329.63,293.66,349.23,440.0,349.23,220.0,277.18,329.63,277.18,246.94,311.13,369.99,311.13]
samples=[]
for i in range(int(SR*duration)):
    t=i/SR; measure=int(t/(beat*4)); chord=chords[measure%len(chords)]
    sub=(t/beat)%1; eighth=int(t/(beat*.5)); et=(t%(beat*.5))
    pad=sum(math.sin(2*math.pi*f*t)+.25*math.sin(2*math.pi*2*f*t) for f in chord)/3
    pluck=math.sin(2*math.pi*melody[eighth%len(melody)]*t)*math.exp(-et*8)
    bass=math.sin(2*math.pi*chord[0]*.5*t)*math.exp(-sub*3)
    # Soft noise tick rather than a harsh synthesized drum.
    tick=(rng.random()*2-1)*math.exp(-sub*45)
    fade=min(1,t*4,(duration-t)*4)
    samples.append((.07*pad+.055*pluck+.08*bass+.025*tick)*max(0,fade))
write_wav('diner_loop.wav',samples)
print('Generated textures and synthesized sounds.')
