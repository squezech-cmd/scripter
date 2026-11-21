"""Restaurant, kitchen props and original low-poly characters."""
from __future__ import annotations
from dataclasses import dataclass
import math
import random
from panda3d.core import AmbientLight, DirectionalLight, NodePath, TextNode, Texture, Vec4
from .geometry import box, cylinder, sphere
from .logic import TOPPING_NAMES

CREAM=(.97,.92,.80,1); DEEP=(.09,.24,.22,1); GREEN=(.15,.38,.32,1)
RED=(.80,.25,.16,1); YELLOW=(.98,.67,.23,1); STEEL=(.80,.83,.80,1)
DARK=(.15,.19,.18,1); WHITE=(.96,.95,.89,1); WOOD=(.62,.39,.22,1)


@dataclass(frozen=True)
class Station:
    key: str
    label: str
    x: float
    y: float
    z: float = 1.1


STATIONS = [
    Station('service','ВЫДАЧА',-4.75,-1.48),
    Station('board','СБОРКА',-2.80,-1.48),
    Station('cheese','СЫР',-.94,-1.48),
    Station('lettuce','САЛАТ',.20,-1.48),
    Station('tomato','ТОМАТ',1.34,-1.48),
    Station('pickle','ОГУРЕЦ',2.48,-1.48),
    Station('soda','НАПИТКИ',4.85,-1.48),
    # Aim at the door, not the edge of the walkable area.  The latter could
    # end up behind the camera when the player is pressed against the fridge.
    Station('fridge','ХОЛОДИЛЬНИК',-7.40,-5.28),
    Station('grill','ГРИЛЬ',-3.25,-7.35),
    Station('fryer','ФРИТЮР',3.35,-7.35),
    Station('bin','КОРЗИНА',7.40,-6.95),
]


class DinerWorld:
    def __init__(self, base, font):
        self.base=base; self.font=font
        self.root=base.render.attachNewNode('restaurant')
        self.textures={}
        for name in ['floor_terracotta','checker','plaster','wall_tiles','steel','wood','patty','bun','menu','sign','sky','asphalt']:
            tex=base.loader.loadTexture('assets/textures/'+name+'.png')
            tex.setWrapU(Texture.WM_repeat); tex.setWrapV(Texture.WM_repeat)
            tex.setMinfilter(Texture.FTLinearMipmapLinear); tex.setMagfilter(Texture.FTLinear)
            tex.setAnisotropicDegree(4)
            self.textures[name]=tex
        self.poster=base.loader.loadTexture('assets/art/diner_poster.png')
        self.obstacles=[]
        self.dynamic=self.root.attachNewNode('dynamic-food')
        self._fingerprint=None
        self.customers=[]
        self._make_lighting()
        self._make_room()
        self._make_kitchen()
        self._make_dining()
        self._make_customers()

    def _make_lighting(self):
        ambient=AmbientLight('warm ambient'); ambient.setColor(Vec4(.66,.65,.57,1))
        self.root.setLight(self.root.attachNewNode(ambient))
        sun=DirectionalLight('sun'); sun.setColor(Vec4(.68,.68,.58,1))
        n=self.root.attachNewNode(sun); n.setHpr(-35,-55,0); self.root.setLight(n)
        self.base.setBackgroundColor(.64,.77,.80,1)

    def b(self,pos,size,color=WHITE,tex=None,uv=(1,1),parent=None):
        return box(parent or self.root,pos,size,color,self.textures.get(tex) if tex else None,uv)

    def c(self,pos,size,color=WHITE,tex=None,parent=None):
        return cylinder(parent or self.root,pos,size,color,self.textures.get(tex) if tex else None)

    def text(self,text,pos,scale=.16,color=CREAM,parent=None,heading=0):
        t=TextNode('label'); t.setFont(self.font); t.setText(text); t.setAlign(TextNode.ACenter)
        t.setTextColor(*color); n=(parent or self.root).attachNewNode(t)
        n.setPos(*pos); n.setScale(scale); n.setH(heading)
        return n

    def obstacle(self,x1,x2,y1,y2):
        self.obstacles.append((min(x1,x2),max(x1,x2),min(y1,y2),max(y1,y2)))

    def _make_room(self):
        # Floors: 3D texture coordinates are repeated rather than stretched.
        self.b((0,0,-.12),(18,18,.22),WHITE,'floor_terracotta',(5,5))
        self.b((0,3.8,.006),(17.8,10.3,.025),WHITE,'checker',(4,2))
        self.b((0,0,4.35),(18.2,18.2,.22),(.94,.91,.82,1),'plaster',(4,4))
        # Rear and side walls, with a tiled waist-high band.
        self.b((0,-9,2.15),(18.2,.22,4.3),WHITE,'plaster',(5,1.5))
        self.b((0,-8.86,1.1),(18,.06,2.15),WHITE,'wall_tiles',(6,1.1))
        self.b((-9,0,2.15),(.22,18,4.3),WHITE,'plaster',(5,1.5))
        self.b((-8.86,0,1.02),(.06,18,2.05),WHITE,'wall_tiles',(5,1))
        self.b((9,-4.5,2.15),(.22,9,4.3),WHITE,'plaster',(3,1))
        self.b((8.86,-4.5,1.05),(.06,9,2.1),WHITE,'wall_tiles',(3,1))
        # Picture windows on the dining side: wall piers + transparent glazing.
        self.b((9,4.5,.44),(.23,9,.88),RED)
        self.b((9,4.5,3.90),(.23,9,.8),CREAM)
        for y in (.15,3.05,6.0,8.9):
            self.b((9,y,2.25),(.22,.14,3.0),DEEP)
        self.b((9,4.5,2.32),(.06,8.9,2.95),(.58,.78,.77,.18))
        self.b((0,9,.45),(18,.25,.9),RED)
        self.b((0,9,3.93),(18,.25,.75),CREAM)
        for x in (-9,-6,-3,0,3,6,9):
            self.b((x,9,2.30),(.14,.24,3),DEEP)
        self.b((0,9,2.35),(17.8,.06,2.9),(.63,.81,.80,.13))
        # Sunny outdoor backdrop, road, trees and broad pavement.
        self.b((0,17,4),(37,.12,11),WHITE,'sky',(1,1))
        self.b((0,13,-.21),(42,12,.12),(.69,.75,.67,1),'asphalt',(5,2))
        for x in range(-18,19,7):
            self.c((x,13.6,1.25),(.32,.32,2.5),(.43,.32,.22,1))
            for dx,dz in [(-.6,2.6),(.55,2.65),(0,3.3)]:
                sphere(self.root,(x+dx,13.6,dz),(2.3,1.9,2.2),(.30,.52,.31,1))
        for x in range(-8,9,3):
            self.b((x,7.9,.015),(1.4,.4,.025),(1,.78,.30,1))
        # Ceiling ribs and industrial hanging lights.
        for x in range(-8,9,4):
            self.b((x,0,4.19),(.07,18,.06),(.80,.78,.70,1))
        for y in range(-8,9,4):
            self.b((0,y,4.19),(18,.07,.06),(.80,.78,.70,1))
        for x in (-5,0,5):
            for y in (-5,4):
                self.c((x,y,3.87),(.035,.035,.55),DARK)
                self.c((x,y,3.57),(.65,.65,.15),DEEP)
                self.c((x,y,3.48),(.49,.49,.035),(1,.87,.58,1))
        # Menu and house branding: a designed 2D texture on actual 3D panels.
        self.b((.1,-1.00,3.36),(8.8,.18,1.28),DEEP)
        panel=self.b((.1,-1.105,3.36),(8.4,.025,1.08),WHITE,'menu')
        panel.setLightOff(1)
        self.b((-6.75,-8.84,3.36),(3.5,.08,1.03),WHITE,'sign')
        self.b((6.3,-8.83,3.02),(2.1,.07,2.6),WHITE,parent=self.root).setTexture(self.poster,1)
        # Accents along the kitchen and dining zones.
        self.b((0,-8.73,2.23),(18,.03,.13),RED)
        self.b((-8.73,0,2.15),(.03,18,.13),RED)

    def _station_label(self,label,x,y,z=.78,heading=0):
        # Inset the label into the counter front, not in front of the food.
        # Back-counter labels face toward +Y; front-counter labels face -Y.
        self.b((x,y,z),(.78,.035,.22),DEEP)
        offset=.024 if heading == 180 else -.024
        self.text(label,(x,y+offset,z-.047),.085,CREAM,heading=heading)

    def _make_kitchen(self):
        # Main counter, stainless tabletop, framed inset panels.
        self.b((.1,-.80,.47),(12.8,1.25,.94),RED)
        self.b((.1,-.80,.99),(13.0,1.35,.12),WHITE,'steel',(4,1))
        self.b((.1,-1.44,.54),(12.7,.045,.58),(.91,.81,.64,1))
        for x in [-5.5,-4.1,-2.7,-1.3,.1,1.5,2.9,4.3,5.7]:
            self.b((x,-1.475,.54),(1.15,.025,.40),(.70,.71,.66,1),'steel')
        self.obstacle(-6.5,6.7,-1.48,-.15)
        # Rear cooking line and extraction hood.
        self.b((0,-8.22,.49),(12.5,1.4,.98),STEEL,'steel',(4,1))
        self.b((0,-8.22,1.04),(12.6,1.5,.12),WHITE,'steel',(5,1))
        self.obstacle(-6.3,6.3,-8.95,-7.45)
        self.b((-.2,-8.55,3.18),(11.8,1.1,.55),(.65,.69,.67,1),'steel',(4,1))
        self.b((-.2,-7.95,3.05),(11.7,.15,.12),(.43,.48,.47,1))
        # Fridge with handle, hinges, a little note and a blue cold indicator.
        self.b((-8.05,-5.25,1.32),(1.35,1.8,2.64),(.70,.76,.73,1),'steel')
        self.b((-7.34,-5.25,1.4),(.09,1.68,2.48),(.86,.89,.83,1),'steel')
        self.b((-7.26,-4.62,1.45),(.08,.08,.8),(.24,.28,.26,1))
        self.b((-7.27,-5.28,2.1),(.05,.45,.36),(.19,.47,.46,1))
        self.obstacle(-8.8,-7.12,-6.3,-4.2)
        # Grill: hot plate, back strip, glowing front controls and spatula.
        self.b((-3.25,-8.05,1.15),(2.55,1.10,.17),DARK)
        self.b((-3.25,-7.96,1.245),(2.35,.82,.035),(.19,.20,.19,1))
        for i in range(10):
            self.b((-4.33+i*.24,-7.96,1.27),(.025,.78,.015),(.31,.29,.26,1))
        for x in (-4.0,-3.25,-2.5):
            self.c((x,-7.45,1.12),(.12,.12,.05),(.89,.31,.13,1)).setP(90)
        self.b((-2.07,-7.75,1.29),(.13,.52,.035),(.78,.79,.74,1)).setH(-24)
        self.b((-1.96,-7.51,1.31),(.10,.25,.06),(.25,.20,.15,1)).setH(-24)
        self._station_label('ГРИЛЬ',-3.25,-7.35,.78,180)
        # Fryer and separate stainless splashback.
        self.b((3.35,-8.05,1.18),(2,1.05,.22),(.34,.38,.37,1),'steel')
        self.b((3.35,-8.02,1.305),(1.52,.74,.07),(.25,.23,.16,1))
        self.b((3.35,-8.02,1.33),(1.24,.56,.04),(.47,.34,.10,1))
        self.b((4.05,-7.8,1.35),(.10,.70,.05),(.74,.75,.69,1))
        self._station_label('ФРИТЮР',3.35,-7.35,.78,180)
        # Simple rubbish bin on the right wall.
        self.b((7.65,-7.55,.46),(.82,.80,.92),(.22,.30,.28,1))
        self.b((7.65,-7.55,.96),(.90,.88,.12),(.16,.23,.22,1))
        self._station_label('КОРЗИНА',7.65,-7.03,.77,180)
        self.obstacle(7.1,8.1,-8,-7.1)
        # Service tray and order bell.
        self.b((-4.75,-.92,1.08),(1.55,.75,.07),(.30,.31,.28,1))
        self.b((-4.75,-.92,1.125),(1.35,.57,.035),CREAM)
        self.c((-5.49,-1.0,1.19),(.22,.22,.13),(.82,.68,.40,1))
        self.c((-5.49,-1.0,1.27),(.08,.08,.05),(.31,.28,.22,1))
        self._station_label('ВЫДАЧА',-4.75,-1.505,.78)
        # Wooden assembly board with a knife.
        self.b((-2.8,-.84,1.10),(1.50,.80,.08),WHITE,'wood')
        self.b((-2.1,-.88,1.17),(.09,.56,.035),(.78,.79,.75,1)).setH(-35)
        self._station_label('СБОРКА',-2.8,-1.505,.78)
        # Ingredient pans; every station is physically distinct.
        toppings=[(-.94,'СЫР',(1,.72,.20,1)),(.2,'САЛАТ',(.37,.66,.25,1)),
                  (1.34,'ТОМАТ',(.86,.22,.16,1)),(2.48,'ОГУРЕЦ',(.34,.53,.21,1))]
        for x,name,col in toppings:
            self.b((x,-.84,1.10),(.91,.70,.12),(.41,.46,.43,1),'steel')
            self.b((x,-.84,1.17),(.74,.53,.07),col)
            if name=='СЫР':
                for i in range(3): self.b((x,-.88+i*.11,1.23),(.50,.21,.018),(1,.78,.24,1))
            elif name=='САЛАТ':
                for i in range(5): sphere(self.root,(x+(i%3-1)*.18,-.84+(i//3)*.17,1.22),(.29,.27,.09),(.39+.05*(i%2),.70,.24,1))
            else:
                for i in range(4): self.c((x+(i%2-.5)*.22,-.88+(i//2)*.18,1.24),(.24,.24,.035),col)
            self._station_label(name,x,-1.505,.78)
        # Soda fountain, visible colored buttons and cup stack.
        self.b((4.85,-.81,1.48),(1.46,.84,.90),(.17,.29,.27,1))
        self.b((4.85,-1.25,1.53),(1.28,.04,.70),(.25,.31,.30,1),'steel')
        for i,x in enumerate((4.40,4.85,5.3)):
            self.b((x,-1.28,1.77),(.28,.025,.19),[(.83,.30,.19,1),(.85,.66,.25,1),(.23,.44,.38,1)][i])
            self.b((x,-1.29,1.34),(.10,.04,.23),(.16,.18,.16,1))
        self.c((5.8,-.82,1.26),(.27,.27,.38),CREAM)
        self._station_label('НАПИТКИ',4.85,-1.505,.78)
        # Back shelf: boxes, condiment bottles and a tiny wall clock.
        self.b((-6.7,-8.66,2.65),(2.8,.55,.10),(.43,.31,.22,1),'wood')
        for i in range(4):
            self.b((-7.65+i*.62,-8.58,2.96),(.47,.46,.53),[(.80,.55,.31,1),(.88,.76,.51,1)][i%2])
        self.c((6.9,-8.64,2.82),(.88,.88,.09),CREAM).setP(90)
        self.c((6.9,-8.58,2.82),(.73,.73,.04),(.96,.96,.87,1)).setP(90)
        self.b((6.9,-8.54,2.91),(.025,.02,.21),DARK)
        self.b((7.0,-8.54,2.82),(.21,.02,.025),DARK)

    def _make_dining(self):
        # Booths and dining tables, all with real 3D volume.
        for x in (-5.8,2.5):
            for y in (3.4,6.9):
                self.b((x,y,.66),(2.15,1.20,.12),WHITE,'wood')
                self.c((x,y,.34),(.16,.16,.64),(.37,.40,.37,1))
                self.c((x,y,.06),(.78,.78,.08),(.28,.31,.29,1))
                self.obstacle(x-1.10,x+1.10,y-.62,y+.62)
                self.b((x,y,.75),(.27,.22,.14),CREAM)
                self.c((x+.45,y+.14,.84),(.14,.14,.32),RED)
                self.c((x+.67,y+.14,.84),(.14,.14,.32),YELLOW)
                for side in (-1,1):
                    bx=x+side*1.56
                    self.b((bx,y,.45),(.66,1.25,.25),RED)
                    self.b((bx+side*.27,y,.95),(.13,1.30,1.12),RED)
                    self.b((bx,y,.18),(.55,1.10,.24),DEEP)
                    self.obstacle(bx-.35,bx+.35,y-.65,y+.65)
        # Wall poster: textured object with a contrasting wood border.
        self.b((-8.80,3.0,2.5),(.10,2.05,2.8),DEEP)
        p=self.b((-8.72,3.0,2.5),(.05,1.88,2.6),WHITE)
        p.setTexture(self.poster,1)
        # Hanging directional sign for the service side of the counter.
        self.b((0,-.35,2.72),(4.0,.16,.48),DEEP)
        self.text('ORDER  •  PICK UP',(0,-.24,2.62),.23,CREAM,heading=180)

    def _make_customers(self):
        skins=[(.80,.57,.42,1),(.53,.34,.24,1),(.91,.70,.54,1)]
        shirts=[(.28,.48,.57,1),(.82,.47,.31,1),(.46,.58,.39,1)]
        for i in range(3):
            root=self.root.attachNewNode('guest-'+str(i))
            x=-4.75+i*.82; y=.55+i*.70
            root.setPos(x,y,0)
            self.c((0,0,.83),(.62,.43,.95),shirts[i],parent=root)
            self.c((-.16,0,.23),(.20,.22,.47),(.19,.24,.27,1),parent=root)
            self.c((.16,0,.23),(.20,.22,.47),(.19,.24,.27,1),parent=root)
            sphere(root,(0,0,1.55),(.52,.48,.60),skins[i])
            sphere(root,(0,.02,1.79),(.55,.50,.21),(.25,.19,.16,1))
            # faces look toward the kitchen, i.e. negative Y.
            for dx in (-.11,.11):
                sphere(root,(dx,-.242,1.59),(.055,.03,.065),(.09,.11,.10,1))
            for dx in (-.38,.38):
                self.c((dx,0,.83),(.17,.19,.73),shirts[i],parent=root)
                sphere(root,(dx,0,.45),(.19,.19,.20),skins[i])
            root.hide()
            self.customers.append(root)

    def update_customers(self, shift, clock):
        for i,c in enumerate(self.customers):
            if i < len(shift.orders):
                c.show(); c.setZ(.018*math.sin(clock*2+i)); c.setH(3*math.sin(clock*.75+i))
            else: c.hide()

    def _food(self,parent,kind,pos=(0,0,0),scale=1,toppings=frozenset()):
        root=parent.attachNewNode('food-'+kind); root.setPos(*pos); root.setScale(scale)
        if kind in ('raw_patty','cooked_patty','burnt_patty'):
            color={'raw_patty':(.78,.36,.30,1),'cooked_patty':(.63,.38,.20,1),'burnt_patty':(.20,.16,.13,1)}[kind]
            self.c((0,0,.06),(.54,.54,.12),color,'patty',parent=root)
        elif kind in TOPPING_NAMES:
            if kind=='cheese': self.b((0,0,.03),(.53,.53,.055),YELLOW,parent=root)
            elif kind=='lettuce':
                for i in range(7):
                    a=i*math.tau/7; sphere(root,(math.cos(a)*.18,math.sin(a)*.18,.04),(.30,.25,.07),(.36,.70,.23,1))
            else:
                col=(.86,.22,.16,1) if kind=='tomato' else (.34,.58,.24,1)
                self.c((0,0,.035),(.5,.5,.07),col,parent=root)
        elif kind=='bun':
            self.c((0,0,.08),(.60,.60,.16),(.94,.68,.34,1),'bun',parent=root)
        elif kind=='burger':
            self.c((0,0,.08),(.63,.63,.16),(.88,.61,.31,1),'bun',parent=root)
            self.c((0,0,.19),(.60,.60,.12),(.59,.35,.19,1),'patty',parent=root)
            z=.27
            for topping in ('cheese','lettuce','tomato','pickle'):
                if topping in toppings:
                    self._food(root,topping,(0,0,z),1); z+=.065
            sphere(root,(0,0,z+.08),(.66,.66,.31),(.91,.63,.27,1),self.textures['bun'])
            for i in range(9):
                a=i*2.4; r=.09+(i%3)*.07
                seed=sphere(root,(math.cos(a)*r,math.sin(a)*r,z+.205),(.055,.025,.015),(1,.91,.68,1))
                seed.setH(i*30)
        elif kind in ('fries','burnt_fries'):
            self.b((0,0,.16),(.42,.34,.32),RED,parent=root)
            self.b((0,-.178,.18),(.25,.015,.11),CREAM,parent=root)
            for i in range(12):
                x=(i%4-1.5)*.085; y=(i//4-1)*.075
                col=YELLOW if kind=='fries' else (.38,.27,.12,1)
                fry=self.b((x,y,.42+(i%3)*.015),(.06,.06,.32),col,parent=root); fry.setP((i%3-1)*9)
        elif kind=='soda':
            self.c((0,0,.22),(.37,.37,.44),RED,parent=root)
            self.c((0,0,.45),(.39,.39,.04),CREAM,parent=root)
            straw=self.c((.08,0,.59),(.038,.038,.30),CREAM,parent=root); straw.setP(-12)
        return root

    def update_food(self, shift):
        patty_fingerprint=None
        if shift.patty:
            patty_fingerprint=(shift.patty.status(),int(shift.patty.sides[shift.patty.face_down]//20))
        fp=(tuple(shift.board), patty_fingerprint, shift.fryer.status(shift.fryer_seconds))
        if fp == self._fingerprint: return
        self._fingerprint=fp
        self.dynamic.node().removeAllChildren()
        if shift.patty:
            kind='burnt_patty' if shift.patty.burnt else ('cooked_patty' if shift.patty.ready else 'raw_patty')
            self._food(self.dynamic,kind,(-3.25,-8,1.29),1.3)
        if shift.fryer.active:
            kind='burnt_fries' if shift.fryer.status(shift.fryer_seconds)=='СГОРЕЛА' else 'fries'
            f=self._food(self.dynamic,kind,(3.35,-8.02,1.32),.65); f.setZ(1.22)
        if shift.board:
            self._food(self.dynamic,'bun',(-2.8,-.84,1.16),1.1)
            z=1.31
            for ingredient in shift.board[1:]:
                kind='cooked_patty' if ingredient=='patty' else ingredient
                self._food(self.dynamic,kind,(-2.8,-.84,z),1.05)
                z+=.09

    def make_held(self, parent, item):
        root=parent.attachNewNode('held-item')
        # Parent is the camera, whose local +Y is forward, +Z is up.
        root.setPos(.42,1.15,-.45); root.setHpr(-15,0,0)
        if item: self._food(root,item.kind,(0,0,0),.85,item.toppings)
        return root

    def can_walk(self,x,y,radius=.30):
        if x < -8.65 or x > 8.65 or y < -8.65 or y > 8.65: return False
        for x1,x2,y1,y2 in self.obstacles:
            if x1-radius < x < x2+radius and y1-radius < y < y2+radius:
                return False
        return True
