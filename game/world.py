"""Restaurant, kitchen props and animated co-op characters."""
from __future__ import annotations
import math
from pathlib import Path
import random
from direct.actor.Actor import Actor
from panda3d.core import AmbientLight, DirectionalLight, Filename, MaterialAttrib, NodePath, TextNode, Texture, TextureAttrib, Vec4
from .geometry import box, cylinder, sphere
from .logic import TOPPING_NAMES
from .stations import GRILL_KEYS, STATIONS, STATION_BY_KEY

CREAM=(.97,.92,.80,1); DEEP=(.09,.24,.22,1); GREEN=(.15,.38,.32,1)
RED=(.80,.25,.16,1); YELLOW=(.98,.67,.23,1); STEEL=(.80,.83,.80,1)
DARK=(.15,.19,.18,1); WHITE=(.96,.95,.89,1); WOOD=(.62,.39,.22,1)


class DinerWorld:
    def __init__(self, base, font):
        self.base=base; self.font=font
        self.root=base.render.attachNewNode('restaurant')
        self.textures={}
        for name in ['floor_terracotta','checker','plaster','wall_tiles','steel','wood','patty','bun','menu','sign','sky','asphalt',
                     'steel_detail','wood_detail','stone_detail','window_view']:
            tex=base.loader.loadTexture('assets/textures/'+name+'.png')
            tex.setWrapU(Texture.WM_repeat); tex.setWrapV(Texture.WM_repeat)
            tex.setMinfilter(Texture.FTLinearMipmapLinear); tex.setMagfilter(Texture.FTLinear)
            tex.setAnisotropicDegree(4)
            self.textures[name]=tex
        self.poster=base.loader.loadTexture('assets/art/diner_poster.png')
        self.uniforms=[base.loader.loadTexture('assets/models/textures/uniform_'+name+'.png')
                       for name in ('orange','teal','red','blue','green','purple','yellow','pink','cream')]
        for tex in self.uniforms:
            tex.setMinfilter(Texture.FTLinearMipmapLinear); tex.setMagfilter(Texture.FTLinear)
        self.obstacles=[]
        self.dynamic=self.root.attachNewNode('dynamic-food')
        self._fingerprint=None
        self.customers=[]; self.customer_actors=[]
        self.player_root=self.root.attachNewNode('co-op-players')
        self.players={}
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
        self.b((0,3.8,.006),(17.8,10.3,.025),WHITE,'wood_detail',(4,3))
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
        # A continuous independently created exterior, visible through the
        # dining windows, replaces the former rows of blocky placeholder trees.
        back=self.b((0,17,2.7),(34,.12,14.4),WHITE,'window_view')
        back.setLightOff(1)
        side=self.b((16,4,2.7),(.12,34,14.4),WHITE,'window_view')
        side.setLightOff(1)
        self.b((0,13,-.21),(42,12,.12),(.69,.75,.67,1),'asphalt',(5,2))
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
        self.b((.1,-.80,.99),(13.0,1.35,.12),WHITE,'stone_detail',(5,1))
        self.b((.1,-1.44,.54),(12.7,.045,.58),(.91,.81,.64,1))
        for x in [-5.5,-4.1,-2.7,-1.3,.1,1.5,2.9,4.3,5.7]:
            self.b((x,-1.475,.54),(1.15,.025,.40),(.70,.71,.66,1),'steel')
        self.obstacle(-6.5,6.7,-1.48,-.15)
        # Rear cooking line and extraction hood.
        self.b((0,-8.22,.49),(12.5,1.4,.98),STEEL,'steel_detail',(4,1))
        self.b((0,-8.22,1.04),(12.6,1.5,.12),WHITE,'steel_detail',(5,1))
        self.obstacle(-6.3,6.3,-8.95,-7.45)
        self.b((-.2,-8.55,3.18),(11.8,1.1,.55),(.65,.69,.67,1),'steel',(4,1))
        self.b((-.2,-7.95,3.05),(11.7,.15,.12),(.43,.48,.47,1))
        # Cabinet seams, pulls, rivets and ventilation make the line read as
        # actual kitchen equipment rather than a single metal box.
        for x in (-5.4,-4.0,-2.6,-1.2,.2,1.6,3.0,4.4,5.8):
            self.b((x,-7.505,.48),(1.22,.026,.66),(.58,.63,.61,1),'steel_detail')
            self.b((x,-7.478,.64),(.54,.035,.035),(.25,.29,.28,1))
            for dx in (-.50,.50):
                self.c((x+dx,-7.475,.22),(.035,.035,.015),(.22,.25,.24,1)).setP(90)
        for x in (-4.8,-3.0,-1.2,.6,2.4,4.2):
            self.b((x,-7.975,3.20),(1.45,.025,.32),(.42,.46,.44,1))
            for i in range(6):
                self.b((x-.58+i*.23,-7.955,3.20),(.07,.018,.26),(.64,.68,.65,1))
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
        for index,x in enumerate((-4.05,-3.25,-2.45),1):
            self._station_label('ГРИЛЬ '+str(index),x,-7.35,.78,180)
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
        # Dedicated espresso machine and mugs on the front counter.
        self.b((6.20,-.83,1.45),(.85,.75,.82),(.27,.30,.28,1),'steel_detail')
        self.b((6.20,-1.22,1.53),(.70,.035,.53),(.14,.18,.17,1))
        self.b((6.20,-1.245,1.73),(.40,.025,.16),(.78,.72,.55,1))
        for x in (6.07,6.20,6.33):
            self.c((x,-1.265,1.73),(.05,.05,.03),(.89,.32,.16,1)).setP(90)
        self.c((6.20,-1.0,1.29),(.26,.26,.25),CREAM)
        self._station_label('КОФЕ',6.20,-1.505,.78)
        # Outside trash container and a janitor's cleaning cabinet.
        self.b((8.40,-3.60,.58),(.82,1.15,1.16),(.20,.33,.27,1))
        self.b((8.40,-3.60,1.20),(.90,1.24,.14),(.13,.24,.19,1))
        self.b((7.97,-3.60,.71),(.035,.70,.29),CREAM)
        self.obstacle(7.96,8.85,-4.23,-2.97)
        self.b((-7.75,1.82,.70),(1.15,.74,1.40),(.44,.48,.42,1),'steel')
        self.b((-7.75,2.20,.95),(.70,.025,.31),DEEP)
        self.text('УБОРКА',(-7.75,2.225,.90),.12,CREAM,heading=180)
        self.obstacle(-8.35,-7.15,1.40,2.20)
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
                self.b((x,y,.66),(2.15,1.20,.12),WHITE,'stone_detail')
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

    def _make_person(self, parent, slot, worker=False):
        # The CC0 MakeHuman mesh uses two levels of detail.  Its separately
        # licensed CC0 motion clips are baked into the portable Panda3D BAM.
        path='assets/models/crew_player.bam' if worker else 'assets/models/crew_lod2.bam'
        body=Actor(Filename.fromOsSpecific(str(Path(path).resolve()))); body.reparentTo(parent)
        geom=body.find('**/+GeomNode').node()
        for i in range(geom.getNumGeoms()):
            state=geom.getGeomState(i)
            material=state.getAttrib(MaterialAttrib)
            texture=state.getAttrib(TextureAttrib)
            if material and texture and material.getMaterial().getName()=='outfit':
                stage=texture.getOnStage(0)
                geom.setGeomState(i,state.setAttrib(texture.addOnStage(stage,self.uniforms[slot % len(self.uniforms)])))
        body.loop('unarmed_idle')
        return body

    def _make_customers(self):
        for i in range(6):
            root=self.root.attachNewNode('guest-'+str(i))
            x=-4.75+(i%3)*.82; y=.55+(i//3)*1.05
            root.setPos(x,y,0)
            body=self._make_person(root,(i+3)%len(self.uniforms))
            body.setScale(.96+(i%3)*.025)
            body.setPlayRate(.88+i*.05,'unarmed_idle')
            # Keep the Python Actor alive; otherwise its destructor drops the
            # animation controls while the visible mesh remains in a T-pose.
            self.customer_actors.append(body)
            root.hide()
            self.customers.append(root)

    def update_customers(self, shift, clock):
        for i,c in enumerate(self.customers):
            if i < len(shift.orders):
                c.show(); c.setZ(.008*math.sin(clock*2+i)); c.setH(2*math.sin(clock*.75+i))
            else: c.hide()

    def _make_player(self, name, slot):
        root=self.player_root.attachNewNode('teammate')
        body=self._make_person(root,slot,worker=True)
        # This model faces -Y at heading zero; players face +Y at heading zero.
        body.setH(180)
        hand=body.attachNewNode('carried-item'); hand.setPos(-.35,-.08,.79)
        label=TextNode('player-name'); label.setFont(self.font); label.setText(name)
        label.setAlign(TextNode.ACenter); label.setTextColor(1,.96,.83,1)
        label.setShadow(.03,.03); label.setShadowColor(0,0,0,.8)
        name_node=root.attachNewNode(label); name_node.setPos(0,0,2.03); name_node.setScale(.12)
        name_node.setBillboardPointEye()
        return {'root':root,'body':body,'hand':hand,'held':None,'target':None,
                'moving_until':0.0,'animation':'unarmed_idle'}

    def clear_players(self):
        for actor in self.players.values():
            actor['body'].cleanup(); actor['root'].removeNode()
        self.players.clear()

    def update_players(self, players, local_id, clock, dt):
        remote={p['id']:p for p in players if p.get('id') != local_id}
        for pid in set(self.players)-set(remote):
            actor=self.players.pop(pid)
            actor['body'].cleanup(); actor['root'].removeNode()
        for pid, data in remote.items():
            actor=self.players.get(pid)
            if not actor:
                actor=self._make_player(data.get('name','Игрок'), int(data.get('slot',0)))
                actor['root'].setPos(float(data['x']),float(data['y']),0)
                self.players[pid]=actor
            target=(float(data['x']),float(data['y']))
            if actor['target'] and math.hypot(target[0]-actor['target'][0],target[1]-actor['target'][1])>.025:
                actor['moving_until']=clock+.35
            actor['target']=target
            root=actor['root']; alpha=min(1.0,max(0.0,dt)*10)
            root.setX(root.getX()+(target[0]-root.getX())*alpha)
            root.setY(root.getY()+(target[1]-root.getY())*alpha)
            heading=float(data.get('heading',0))
            turn=(heading-root.getH()+180)%360-180
            root.setH(root.getH()+turn*alpha)
            animation='unarmed_walk' if clock<actor['moving_until'] else 'unarmed_idle'
            if animation!=actor['animation']:
                actor['body'].loop(animation); actor['animation']=animation
            held=data.get('held'); fingerprint=(held.get('kind'),tuple(held.get('toppings',[]))) if held else None
            if fingerprint != actor['held']:
                actor['held']=fingerprint
                actor['hand'].node().removeAllChildren()
                if held:
                    self._food(actor['hand'],held['kind'],(0,0,0),.55,frozenset(held.get('toppings',[])))

    def _food(self,parent,kind,pos=(0,0,0),scale=1,toppings=frozenset()):
        root=parent.attachNewNode('food-'+kind); root.setPos(*pos); root.setScale(scale)
        if kind in ('raw_patty','cooked_patty','burnt_patty'):
            color={'raw_patty':(.78,.36,.30,1),'cooked_patty':(.63,.38,.20,1),'burnt_patty':(.20,.16,.13,1)}[kind]
            self.c((0,0,.06),(.54,.54,.12),color,'patty',parent=root)
            if kind == 'cooked_patty':
                for x in (-.16, -.08, 0, .08, .16):
                    stripe=self.b((x,0,.123),(.018,.36,.004),(.22,.13,.08,1),parent=root)
                    stripe.setH(-20)
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
        elif kind=='coffee':
            self.c((0,0,.20),(.35,.35,.40),(.93,.88,.75,1),parent=root)
            self.c((0,0,.405),(.37,.37,.035),(.28,.20,.15,1),parent=root)
            self.b((.20,0,.22),(.12,.10,.19),(.87,.82,.70,1),parent=root)
        elif kind=='trash_bag':
            sphere(root,(0,0,.25),(.50,.46,.58),(.12,.14,.13,1))
            self.c((0,0,.56),(.13,.13,.12),(.16,.18,.16,1),parent=root)
        return root

    def update_food(self, shift):
        patties = tuple((key, p.status(), int(p.sides[p.face_down] // 20))
                        for key, p in shift.patties.items() if p)
        fp=(tuple(shift.board), patties, shift.fryer.status(shift.fryer_seconds),
            shift.coffee.status(shift.coffee_seconds), shift.trash_count, shift.dirty_tables)
        if fp == self._fingerprint: return
        self._fingerprint=fp
        self.dynamic.node().removeAllChildren()
        for key, patty in shift.patties.items():
            if patty:
                kind='burnt_patty' if patty.burnt else ('cooked_patty' if patty.ready else 'raw_patty')
                self._food(self.dynamic,kind,(STATION_BY_KEY[key].x,-8,1.29),1.1)
        if shift.fryer.active:
            kind='burnt_fries' if shift.fryer.status(shift.fryer_seconds)=='СГОРЕЛА' else 'fries'
            f=self._food(self.dynamic,kind,(3.35,-8.02,1.32),.65); f.setZ(1.22)
        if shift.coffee.active:
            self._food(self.dynamic,'coffee',(6.20,-.91,1.15),.7)
        if shift.board:
            self._food(self.dynamic,'bun',(-2.8,-.84,1.16),1.1)
            z=1.31
            for ingredient in shift.board[1:]:
                kind='cooked_patty' if ingredient=='patty' else ingredient
                self._food(self.dynamic,kind,(-2.8,-.84,z),1.05)
                z+=.09
        # Used trays show that tables need cleaning, rather than only a number in the HUD.
        for i in range(shift.dirty_tables):
            x=(-5.8,2.5,-5.8,2.5)[i]; y=(3.4,3.4,6.9,6.9)[i]
            self.b((x,y,.75),(.76,.48,.04),(.23,.20,.17,1),parent=self.dynamic)
            self.c((x,y,.79),(.30,.30,.035),(.73,.72,.65,1),parent=self.dynamic)

    def make_held(self, parent, item):
        root=parent.attachNewNode('held-item')
        # A small sleeve and hand keep food from floating in mid-air.
        root.setPos(.48,1.25,-.52); root.setHpr(-15,0,0)
        self.b((.09,-.02,-.16),(.23,.32,.18),(.20,.26,.24,1),parent=root)
        sphere(root,(0,.02,-.075),(.27,.22,.12),(.78,.57,.43,1))
        if item: self._food(root,item.kind,(0,0,0),.68,item.toppings)
        return root

    def can_walk(self,x,y,radius=.30):
        if x < -8.65 or x > 8.65 or y < -8.65 or y > 8.65: return False
        for x1,x2,y1,y2 in self.obstacles:
            if x1-radius < x < x2+radius and y1-radius < y < y2+radius:
                return False
        return True
