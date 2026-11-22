"""Burger Shift: an independent native cooking game with optional LAN co-op."""
from __future__ import annotations
import argparse
import math
import os
from pathlib import Path
import socket
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
from game.net import CoopClient, CoopServer, DEFAULT_PORT, item_data, item_from_data, shift_from_data
from game.stations import GRILL_KEYS, STATIONS
from game.world import DinerWorld
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
        self.coop_name='Повар'; self.coop_address=''; self.coop_port=DEFAULT_PORT; self.coop_code=''
        self.net_client=None; self.net_server=None; self.net_id=None; self.net_is_host=False
        self.net_phase=''; self.net_epoch=-1; self.net_players=[]; self.net_chat=[]
        self.net_move_timer=0.; self.net_summary_signature=None; self.chat_open=False
        self.finalExitCallbacks.append(self._stop_network)
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
        self.accept('t',self.open_chat); self.accept('escape',self.escape)
        self.taskMgr.add(self.update,'update-game')
        self.ui.menu(); self._capture_mouse(False)

    def _set_key(self,key,value):
        # Text entry must never move the character or operate kitchen stations.
        self.keys[key]=bool(value) and self.mode=='playing' and not self.chat_open

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

    def host_address_hint(self):
        """List likely LAN addresses; the player can still use a VPN/public IP."""
        addresses=set()
        try:
            for info in socket.getaddrinfo(socket.gethostname(),None,socket.AF_INET,socket.SOCK_STREAM):
                addresses.add(info[4][0])
        except OSError:
            pass
        try:
            with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as probe:
                # UDP connect chooses the route but does not send a packet.
                probe.connect(('192.0.2.1',9))
                addresses.add(probe.getsockname()[0])
        except OSError:
            pass
        choices=sorted(x for x in addresses if not x.startswith(('127.','169.254.')) and x!='0.0.0.0')
        return ' / '.join(choices[:2]) or 'узнайте через ipconfig'

    def _remember_coop_values(self):
        values=self.ui.coop_values()
        self.coop_name=''.join(c for c in values['name'] if c.isprintable()).strip()[:18] or 'Повар'
        self.coop_address=values['address'].strip()[:253]
        self.coop_code=values['code'].strip()[:12]
        try:
            port=int(values['port'].strip())
            if not 1<=port<=65535: raise ValueError('port')
            self.coop_port=port
        except (ValueError,TypeError):
            self.ui.coop_setup('Порт должен быть числом от 1 до 65535.')
            return False
        return True

    def host_coop(self):
        if self.mode!='coop_setup' or not self._remember_coop_values(): return
        try:
            self.net_server=CoopServer(self.profile,save_path(),port=self.coop_port)
        except (OSError,ValueError) as exc:
            self.ui.coop_setup('Не удалось открыть порт: '+str(exc)[:70])
            return
        self.coop_port=self.net_server.port; self.coop_code=self.net_server.code
        self.net_is_host=True
        self.net_client=CoopClient('127.0.0.1',self.coop_port,self.coop_name,self.coop_code,self.net_server.host_token)
        self.mode='connecting'; self.ui.connecting()

    def join_coop(self):
        if self.mode!='coop_setup' or not self._remember_coop_values(): return
        if not self.coop_address:
            self.ui.coop_setup('Введите IP-адрес или имя компьютера хоста.')
            return
        if not (len(self.coop_code)==6 and self.coop_code.isascii() and self.coop_code.isdigit()):
            self.ui.coop_setup('Код комнаты должен состоять из шести цифр.')
            return
        self.net_is_host=False
        self.net_client=CoopClient(self.coop_address,self.coop_port,self.coop_name,self.coop_code)
        self.mode='connecting'; self.ui.connecting()

    def _stop_network(self):
        client,server=self.net_client,self.net_server
        self.net_client=None; self.net_server=None
        if client: client.close()
        if server:
            server.stop()
            # Host's authoritative profile is separate from the render snapshot.
            self.profile=Profile(**vars(server.profile))
        self.net_id=None; self.net_is_host=False; self.net_phase=''; self.net_epoch=-1
        self.net_players=[]; self.net_chat=[]; self.net_summary_signature=None
        self.chat_open=False
        if hasattr(self,'world'): self.world.clear_players()
        if hasattr(self,'ui'): self.ui.show_coop_chat(False)

    def _network_failure(self, message):
        self.return_menu()
        self.ui.coop_setup(str(message)[:110])

    @staticmethod
    def _read_players(raw):
        if not isinstance(raw,list) or len(raw)>8: raise ValueError('players')
        players=[]; ids=set()
        for p in raw:
            if not isinstance(p,dict) or not isinstance(p.get('id'),str): raise ValueError('player')
            pid=p['id'][:64]
            if not pid or pid in ids: raise ValueError('player id')
            ids.add(pid)
            x,y,heading=float(p['x']),float(p['y']),float(p['heading'])
            slot=int(p['slot'])
            if not all(math.isfinite(v) for v in (x,y,heading)) or not (-9<=x<=9 and -9<=y<=9 and 0<=slot<8):
                raise ValueError('player position')
            name=''.join(c for c in str(p.get('name','Игрок')) if c.isprintable())[:18] or 'Игрок'
            players.append({'id':pid,'name':name,'slot':slot,'host':bool(p.get('host')),
                            'x':x,'y':y,'heading':heading%360,'held':item_data(item_from_data(p.get('held')))})
        return players

    def _enter_network_shift(self, own):
        self.mode='playing'; self.target=None
        self.heading=own['heading']; self.pitch=-3
        for k in self.keys: self.keys[k]=False
        self.camera.setPos(own['x'],own['y'],1.68); self.camera.setHpr(self.heading,self.pitch,0)
        self.chat_open=False; self.ui.close_chat()
        self.ui.clear_overlay(); self.ui.show_hud(True); self.ui.show_coop_chat(True)
        self.ui.update_chat(self.net_chat)
        self.world.update_food(self.shift); self._refresh_held(force=True)
        self.net_move_timer=0.; self._capture_mouse(True)

    def _apply_snapshot(self, data):
        phase=data['phase']; epoch=int(data['epoch'])
        if phase not in ('lobby','playing','summary') or epoch<0: raise ValueError('phase')
        players=self._read_players(data['players'])
        own=next((p for p in players if p['id']==self.net_id),None)
        if own is None: raise ValueError('own player missing')
        self.net_players=players
        old_epoch=self.net_epoch
        self.net_phase=phase; self.net_epoch=epoch
        if phase=='lobby':
            if self.mode!='lobby':
                self.mode='lobby'; self._capture_mouse(False); self.ui.lobby()
            self.ui.update_lobby(players)
            return
        self.shift=shift_from_data(data['shift'],own['held'])
        if self.net_is_host: self.profile=self.shift.profile
        if phase=='playing':
            if old_epoch!=epoch or self.mode not in ('playing','pause'):
                self._enter_network_shift(own)
        else:
            signature=(epoch,tuple(vars(self.shift.profile).items()),self.shift.served,self.shift.lost,self.shift.earnings)
            if self.mode!='summary' or self.net_summary_signature!=signature:
                self.mode='summary'; self.net_summary_signature=signature
                self.chat_open=False; self.ui.close_chat(); self._capture_mouse(False)
                self.ui.show_coop_chat(False); self.ui.summary()

    def _poll_network(self):
        client=self.net_client
        if not client: return
        for event in client.poll():
            if client is not self.net_client: return
            typ=event.get('type')
            if typ=='welcome':
                self.net_id=event.get('id')
                self.net_is_host=bool(event.get('host'))
                if not isinstance(self.net_id,str) or (self.net_server and not self.net_is_host):
                    self._network_failure('Не удалось подтвердить хоста комнаты.')
                    return
            elif typ=='snapshot' and self.net_id:
                try: self._apply_snapshot(event)
                except (KeyError,ValueError,TypeError,OverflowError):
                    self._network_failure('Получены некорректные данные комнаты.')
                    return
            elif typ=='chat':
                name=str(event.get('name','Игрок'))[:18]
                text=str(event.get('text',''))[:140]
                self.net_chat.append((name,text)); self.net_chat=self.net_chat[-30:]
                self.ui.update_chat(self.net_chat)
            elif typ=='event':
                self.ui.notify(str(event.get('message',''))[:160],bool(event.get('ok')))
                self.play_sound(str(event.get('sound','click')))
            elif typ in ('rejected','disconnected'):
                self._network_failure(event.get('message','Соединение с хостом закрыто.'))
                return

    def _send_movement(self):
        if self.net_client:
            p=self.camera.getPos(self.render)
            self.net_client.send({'type':'move','x':float(p.x),'y':float(p.y),'heading':float(self.heading)})

    def _send_action(self, action, station=''):
        if not self.net_client: return
        self._send_movement()
        if not self.net_client.send({'type':'action','action':action,'station':station}):
            self.ui.notify('Не удалось отправить действие. Проверь соединение.',False)

    def open_chat(self):
        if not self.net_client or self.mode!='playing' or self.chat_open: return
        self.chat_open=True
        for key in self.keys: self.keys[key]=False
        self.ui.open_chat()

    def send_chat(self, text):
        if not self.net_client: return
        text=''.join(c for c in str(text) if c.isprintable()).strip()[:140]
        if text: self.net_client.send({'type':'chat','text':text})
        if self.mode=='lobby' and self.ui.lobby_entry:
            self.ui.lobby_entry.enterText('')
        if self.chat_open:
            self.chat_open=False; self.ui.close_chat(); self._skip_mouse=True

    def start_shift(self):
        if self.net_client:
            if self.net_is_host and self.net_phase in ('lobby','summary'):
                self.net_client.send({'type':'start'})
            return
        self.shift=Shift(self.profile)
        self.mode='playing'; self.target=None; self.heading=0; self.pitch=-3
        for k in self.keys: self.keys[k]=False
        self.camera.setPos(0,-5.0,1.68); self.camera.setHpr(self.heading,self.pitch,0)
        self.ui.clear_overlay(); self.ui.show_hud(True); self.ui.show_coop_chat(False)
        self.ui.notify('Добро пожаловать на смену! Первый заказ уже ждёт.',True)
        self.world.update_food(self.shift); self._refresh_held(force=True)
        self._capture_mouse(True); self.play_sound('ding')

    def resume(self):
        if self.mode!='pause': return
        self.mode='playing'; self.ui.clear_overlay(); self.ui.show_hud(True); self._capture_mouse(True)

    def return_menu(self):
        self._stop_network()
        self.mode='menu'; self.target=None; self.shift=None
        for k in self.keys: self.keys[k]=False
        if self.held_visual: self.held_visual.removeNode(); self.held_visual=None
        self.held_fingerprint=None
        self.camera.setPos(0,-5.0,1.68); self.camera.setHpr(0,0,0)
        for c in self.world.customers: c.hide()
        self.world.dynamic.node().removeAllChildren(); self.world._fingerprint=None
        self.ui.menu(); self._capture_mouse(False); self._save()

    def escape(self):
        if self.chat_open:
            self.chat_open=False; self.ui.close_chat(); self._skip_mouse=True
        elif self.mode=='playing':
            self.mode='pause'; self._capture_mouse(False); self.ui.show_hud(False); self.ui.pause()
        elif self.mode=='pause': self.resume()
        elif self.mode in ('summary','lobby','connecting','coop_setup'): self.return_menu()
        else: self.ui.menu()

    def buy_upgrade(self,key):
        if self.mode!='summary': return
        if self.net_client:
            if self.net_is_host: self.net_client.send({'type':'upgrade','key':key})
            return
        self.play_sound('success' if self.profile.buy(key) else 'bad')
        self._save(); self.ui.summary()

    def _result(self,result):
        self.ui.notify(result.message,result.ok); self.play_sound(result.sound)
        self.world.update_food(self.shift); self._refresh_held()

    def interact(self):
        if self.mode=='playing' and not self.chat_open and self.target:
            if self.net_client: self._send_action('interact',self.target.key)
            else: self._result(self.shift.interact(self.target.key))

    def flip(self):
        if self.mode=='playing' and not self.chat_open and self.target and self.target.key in GRILL_KEYS:
            if self.net_client: self._send_action('flip',self.target.key)
            else: self._result(self.shift.flip(self.target.key))

    def wrap(self):
        if self.mode=='playing' and not self.chat_open and self.target and self.target.key=='board':
            if self.net_client: self._send_action('wrap',self.target.key)
            else: self._result(self.shift.wrap())

    def drop(self):
        if self.mode=='playing' and not self.chat_open:
            if self.net_client: self._send_action('discard')
            else: self._result(self.shift.discard_held())

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
        dt=max(0.0,min(globalClock.getDt(),.12))
        self.elapsed+=dt
        self._poll_network()
        if self.mode=='playing' and self.shift:
            if not self.chat_open: self._move(dt)
            self.target=self.find_target()
            if self.net_client:
                self.net_move_timer-=dt
                if self.net_move_timer<=0:
                    self._send_movement(); self.net_move_timer=.08
                self.world.update_players(self.net_players,self.net_id,self.elapsed,dt)
            else:
                for event in self.shift.tick(dt):
                    self.ui.notify(event.message,event.ok); self.play_sound(event.sound)
            self.world.update_food(self.shift); self.world.update_customers(self.shift,self.elapsed)
            self._refresh_held(); self.ui.update(self.shift,self.target,dt)
            if not self.net_client and self.shift.finished:
                self.mode='summary'; self._capture_mouse(False); self._save(); self.ui.summary()
        elif self.mode=='pause' and self.net_client:
            # The server and other players continue while a local menu is open.
            self.world.update_players(self.net_players,self.net_id,self.elapsed,dt)
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
