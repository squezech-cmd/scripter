"""Burger Shift: an original, offline, native desktop cooking game."""
from __future__ import annotations
import argparse
import math
import os
from pathlib import Path
import sys

# A packaged Panda3D application places assets alongside the frozen executable.
# The SFX launcher extracts both together to a temporary directory before launch.
if getattr(sys, 'frozen', False) or (sys.executable.lower().endswith('.exe') and (Path(sys.executable).parent / 'assets').is_dir()):
    os.chdir(Path(sys.executable).resolve().parent)
else:
    os.chdir(Path(__file__).resolve().parent)

from panda3d.core import loadPrcFileData

parser=argparse.ArgumentParser(add_help=True)
parser.add_argument('--offscreen',action='store_true',help='render with the CPU for automated checks')
parser.add_argument('--screenshot',default='',help='save a title screen and exit (for tests)')
parser.add_argument('--screenshot-game',default='',help='save a gameplay frame and exit (for tests)')
args,_=parser.parse_known_args()

config='''
window-title Burger Shift - Diner Edition
win-size 1280 720
win-origin -2 -2
fullscreen false
sync-video true
show-frame-rate-meter false
default-antialias-enable true
framebuffer-multisample 1
multisamples 4
notify-level warning
notify-level-device fatal
aux-display p3tinydisplay
'''
if args.offscreen or args.screenshot or args.screenshot_game:
    config += '\nload-display p3tinydisplay\nwindow-type offscreen\naudio-library-name null\n'
else:
    config += '\naudio-library-name p3openal_audio\n'
loadPrcFileData('game-settings',config)

from direct.showbase.ShowBase import ShowBase
from panda3d.core import Vec3, WindowProperties, ClockObject
from game.logic import Profile, Shift
from game.world import DinerWorld, STATIONS
from game.ui import Interface


def save_path():
    if os.name=='nt':
        base=Path(os.environ.get('APPDATA') or Path.home()/'AppData'/'Roaming')
    else:
        base=Path(os.environ.get('XDG_DATA_HOME') or Path.home()/'.local'/'share')
    return base/'BurgerShiftDiner'/'profile.json'


class BurgerGame(ShowBase):
    def __init__(self, offscreen=False):
        super().__init__()
        self.offscreen=offscreen
        self.disableMouse()
        self.camLens.setFov(80)
        self.camLens.setNearFar(.05,120)
        self.font=self.loader.loadFont('assets/fonts/DejaVuSans.ttf')
        self.font_bold=self.loader.loadFont('assets/fonts/DejaVuSans-Bold.ttf')
        self.font.setPixelsPerUnit(80); self.font_bold.setPixelsPerUnit(80)
        self.profile=Profile.load(save_path())
        self.world=DinerWorld(self,self.font_bold)
        self.shift=None; self.mode='menu'; self.target=None; self.heading=0; self.pitch=0
        self.keys={k:False for k in ('w','a','s','d','shift')}
        self.walk_time=0.; self.elapsed=0.; self.held_visual=None; self.held_fingerprint=None
        self._skip_mouse=True
        self.camera.setPos(0,-5.0,1.68); self.camera.setHpr(0,0,0)
        self.ui=Interface(self)
        self.sounds={name:self.loader.loadSfx('assets/sounds/'+name+'.wav') for name in ('click','pickup','flip','ding','success','bad','trash','sizzle','finish')}
        self.music=self.loader.loadMusic('assets/sounds/diner_loop.wav')
        if self.music:
            self.music.setLoop(True); self.music.setVolume(.20); self.music.play()
        for key in ('w','a','s','d'):
            self.accept(key,self._set_key,[key,True]); self.accept(key+'-up',self._set_key,[key,False])
        self.accept('shift',self._set_key,['shift',True]); self.accept('shift-up',self._set_key,['shift',False])
        self.accept('e',self.interact); self.accept('mouse1',self.interact)
        self.accept('f',self.flip); self.accept('r',self.wrap); self.accept('q',self.drop)
        self.accept('escape',self.escape)
        self.taskMgr.add(self.update,'update-game')
        self.ui.menu(); self._capture_mouse(False)

    def _set_key(self,key,value): self.keys[key]=value

    def _capture_mouse(self,enable):
        if self.offscreen or not self.win: return
        props=WindowProperties(); props.setCursorHidden(enable)
        self.win.requestProperties(props)
        self._skip_mouse=True
        if enable:
            self.win.movePointer(0,self.win.getXSize()//2,self.win.getYSize()//2)

    def _save(self):
        try: self.profile.save(save_path())
        except OSError as exc: print('Could not save profile:',exc,file=sys.stderr)

    def play_sound(self,name):
        sound=self.sounds.get(name)
        if sound: sound.setVolume(.55); sound.play()

    def start_shift(self):
        self.shift=Shift(self.profile)
        self.mode='playing'; self.target=None; self.heading=0; self.pitch=-3
        for k in self.keys: self.keys[k]=False
        self.camera.setPos(0,-5.0,1.68); self.camera.setHpr(self.heading,self.pitch,0)
        self.ui.clear_overlay(); self.ui.show_hud(True)
        self.ui.notify('Добро пожаловать на смену! Первый заказ уже ждёт.',True)
        self.world.update_food(self.shift); self._refresh_held(force=True)
        self._capture_mouse(True); self.play_sound('ding')

    def resume(self):
        if self.mode!='pause': return
        self.mode='playing'; self.ui.clear_overlay(); self.ui.show_hud(True); self._capture_mouse(True)

    def return_menu(self):
        self.mode='menu'; self.target=None; self.shift=None
        for k in self.keys: self.keys[k]=False
        if self.held_visual: self.held_visual.removeNode(); self.held_visual=None
        self.held_fingerprint=None
        self.camera.setPos(0,-5.0,1.68); self.camera.setHpr(0,0,0)
        for c in self.world.customers: c.hide()
        self.world.dynamic.node().removeAllChildren(); self.world._fingerprint=None
        self.ui.menu(); self._capture_mouse(False); self._save()

    def escape(self):
        if self.mode=='playing':
            self.mode='pause'; self._capture_mouse(False); self.ui.show_hud(False); self.ui.pause()
        elif self.mode=='pause': self.resume()
        elif self.mode=='summary': self.return_menu()
        else: self.ui.menu()

    def buy_upgrade(self,key):
        if self.mode!='summary': return
        self.play_sound('success' if self.profile.buy(key) else 'bad')
        self._save(); self.ui.summary()

    def _result(self,result):
        self.ui.notify(result.message,result.ok); self.play_sound(result.sound)
        self.world.update_food(self.shift); self._refresh_held()

    def interact(self):
        if self.mode=='playing' and self.target:
            self._result(self.shift.interact(self.target.key))

    def flip(self):
        if self.mode=='playing' and self.target and self.target.key=='grill': self._result(self.shift.flip())

    def wrap(self):
        if self.mode=='playing' and self.target and self.target.key=='board': self._result(self.shift.wrap())

    def drop(self):
        if self.mode=='playing': self._result(self.shift.discard_held())

    def _refresh_held(self,force=False):
        item=self.shift.held if self.shift else None
        fp=(item.kind,tuple(sorted(item.toppings))) if item else None
        if not force and fp==self.held_fingerprint: return
        self.held_fingerprint=fp
        if self.held_visual: self.held_visual.removeNode(); self.held_visual=None
        if item: self.held_visual=self.world.make_held(self.camera,item)

    def _update_mouse(self):
        if self.offscreen or not self.mouseWatcherNode.hasMouse() or not self.win: return
        p=self.win.getPointer(0); cx=self.win.getXSize()//2; cy=self.win.getYSize()//2
        dx=p.getX()-cx; dy=p.getY()-cy
        if not self._skip_mouse:
            self.heading-=dx*.13; self.pitch=max(-72,min(65,self.pitch-dy*.13))
        self._skip_mouse=False
        self.win.movePointer(0,cx,cy)

    def _move(self,dt):
        self._update_mouse()
        self.camera.setHpr(self.heading,self.pitch,0)
        forward=self.camera.getQuat(self.render).getForward(); forward.z=0
        right=self.camera.getQuat(self.render).getRight(); right.z=0
        forward.normalize(); right.normalize()
        movement=forward*(int(self.keys['w'])-int(self.keys['s'])) + right*(int(self.keys['d'])-int(self.keys['a']))
        moving=movement.lengthSquared()>0
        if moving:
            movement.normalize(); movement*= (5.2 if self.keys['shift'] else 3.35)*dt
            p=self.camera.getPos()
            if self.world.can_walk(p.x+movement.x,p.y): self.camera.setX(p.x+movement.x)
            p=self.camera.getPos()
            if self.world.can_walk(p.x,p.y+movement.y): self.camera.setY(p.y+movement.y)
            self.walk_time+=dt*(10 if self.keys['shift'] else 7)
            self.camera.setZ(1.68+math.sin(self.walk_time)*.018)
        else:
            self.camera.setZ(1.68)

    def find_target(self):
        camera_pos=self.camera.getPos(self.render)
        forward=self.camera.getQuat(self.render).getForward(); forward.z=0
        if forward.lengthSquared()<.001: return None
        forward.normalize(); best=None; best_score=-100
        for station in STATIONS:
            d=Vec3(station.x-camera_pos.x,station.y-camera_pos.y,0)
            distance=d.length()
            if distance>2.35 or distance<.05: continue
            d.normalize(); dot=forward.dot(d)
            if dot<.40: continue
            score=dot-distance*.075
            if score>best_score: best_score=score; best=station
        return best

    def update(self,task):
        dt=min(globalClock.getDt(),.12)
        self.elapsed+=dt
        if self.mode=='playing':
            self._move(dt); self.target=self.find_target()
            events=self.shift.tick(dt)
            for event in events:
                self.ui.notify(event.message,event.ok); self.play_sound(event.sound)
            self.world.update_food(self.shift); self.world.update_customers(self.shift,self.elapsed)
            self.ui.update(self.shift,self.target,dt)
            if self.shift.finished:
                self.mode='summary'; self._capture_mouse(False); self._save(); self.ui.summary()
        return task.cont


if __name__=='__main__':
    offscreen=args.offscreen or bool(args.screenshot or args.screenshot_game)
    game=BurgerGame(offscreen=offscreen)
    if args.screenshot_game:
        game.start_shift()
        game.target=game.find_target()
        game.ui.update(game.shift,game.target,0)
    target=args.screenshot or args.screenshot_game
    if target:
        for _ in range(4): game.graphicsEngine.renderFrame()
        if not game.win.saveScreenshot(target): raise RuntimeError('Could not save screenshot')
        print('Screenshot:',target)
        game.destroy()
    else:
        game.run()
