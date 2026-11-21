"""Native Panda3D interface, with Cyrillic text and no browser component."""
from __future__ import annotations
from direct.gui.DirectGui import DirectButton, DirectFrame, DGG
from direct.gui.OnscreenImage import OnscreenImage
from direct.gui.OnscreenText import OnscreenText
from panda3d.core import TextNode, TransparencyAttrib
from .logic import ITEM_NAMES, TOPPING_NAMES

INK=(.07,.17,.16,1); DARK=(.04,.12,.11,.94); CARD=(.10,.23,.21,.96)
CREAM=(.99,.95,.85,1); MUTED=(.72,.79,.72,1); YELLOW=(1,.72,.29,1)
ORANGE=(.94,.37,.23,1); RED=(.80,.25,.16,1); WHITE=(1,.99,.94,1); GREEN=(.47,.78,.55,1)


class Interface:
    def __init__(self, game):
        self.game=game; self.base=game; self.font=game.font; self.bold=game.font_bold
        self.aspect=game.getAspectRatio()
        self.hud=game.aspect2d.attachNewNode('hud')
        self.overlay=game.aspect2d.attachNewNode('overlay')
        self.order_widgets=[]
        self._overlay_widgets=[]
        self._make_hud()
        self.hud.hide()
        self.notice_timer=0

    def _track_overlay(self, parent, widget):
        if parent == self.overlay or self.overlay.isAncestorOf(parent):
            self._overlay_widgets.append(widget)
        return widget

    def frame(self,parent,x,z,w,h,color=CARD):
        widget = DirectFrame(parent=parent,frameColor=color,frameSize=(0,w,-h,0),pos=(x,0,z),relief=DGG.FLAT)
        return self._track_overlay(parent, widget)

    def label(self,parent,text,x,z,size=.045,color=CREAM,bold=False,align=TextNode.ALeft,may_change=False):
        widget = OnscreenText(parent=parent,text=text,pos=(x,z),scale=size,fg=color,
                            align=align,font=self.bold if bold else self.font,
                            mayChange=may_change,shadow=(0,0,0,.18),shadowOffset=(.025,.025))
        return self._track_overlay(parent, widget)

    def button(self,parent,text,x,z,w,h,command,color=YELLOW,text_color=INK,size=.052):
        widget = DirectButton(parent=parent,text=text,text_font=self.bold,text_scale=size,text_fg=text_color,
                            text_pos=(w/2,-h/2-size*.30),frameSize=(0,w,-h,0),
                            frameColor=color,relief=DGG.FLAT,pos=(x,0,z),
                            pressEffect=False,command=command,rolloverSound=None,clickSound=None,
                            borderWidth=(0,0))
        return self._track_overlay(parent, widget)

    def clear_overlay(self):
        for widget in reversed(self._overlay_widgets):
            widget.destroy()
        self._overlay_widgets=[]
        for child in self.overlay.getChildren(): child.removeNode()

    def _make_hud(self):
        a=self.aspect
        # Slim branded masthead and a centered shift clock.
        self.frame(self.hud,-a+.07,.94,.78,.12,DARK)
        self.label(self.hud,'SHIFT  /  DINER',-a+.10,.865,.043,YELLOW,True)
        self.day_label=self.label(self.hud,'ДЕНЬ 01',-a+.64,.865,.034,CREAM,True,may_change=True)
        self.frame(self.hud,-.32,.94,.64,.12,DARK)
        self.label(self.hud,'СМЕНА',-.25,.865,.032,MUTED,True)
        self.time_label=self.label(self.hud,'04:00',.23,.858,.052,WHITE,True,align=TextNode.ARight,may_change=True)
        self.frame(self.hud,a-.82,.94,.75,.12,DARK)
        self.label(self.hud,'ВЫРУЧКА',a-.78,.865,.031,MUTED,True)
        self.money_label=self.label(self.hud,'$ 0',a-.12,.858,.050,YELLOW,True,align=TextNode.ARight,may_change=True)

        # Mission callout, intentionally kept away from the center crosshair.
        self.frame(self.hud,-a+.07,.76,.90,.22,DARK)
        self.label(self.hud,'ЗАДАЧА СМЕНЫ',-a+.105,.70,.030,YELLOW,True)
        self.mission=self.label(self.hud,'',-a+.105,.635,.038,CREAM,True,may_change=True)
        self.submission=self.label(self.hud,'',-a+.105,.585,.029,MUTED,may_change=True)

        # Three independent order tickets, with a patience indicator.
        self.label(self.hud,'ЗАКАЗЫ',a-.78,.76,.033,CREAM,True)
        for i in range(3):
            z=.71-i*.245
            card=self.frame(self.hud,a-.79,z,.72,.218,(.97,.93,.82,.97))
            self.frame(card,0,0,.018,.218,ORANGE)
            title=self.label(card,'',.035,-.050,.037,INK,True,may_change=True)
            ingredients=self.label(card,'',.035,-.097,.030,(.25,.31,.26,1),may_change=True)
            sides=self.label(card,'',.035,-.145,.028,(.25,.31,.26,1),may_change=True)
            bar_bg=self.frame(card,.035,-.174,.65,.012,(.75,.76,.67,1))
            bar=self.frame(card,.035,-.174,.65,.012,(.34,.63,.35,1))
            self.order_widgets.append((card,title,ingredients,sides,bar))

        # Central interaction hints; no modal popup while cooking.
        self.crosshair=self.label(self.hud,'+',0,-.014,.042,WHITE,True,TextNode.ACenter)
        self.context_frame=self.frame(self.hud,-.63,-.32,1.26,.16,DARK)
        self.context=self.label(self.context_frame,'',.63,-.057,.041,WHITE,True,TextNode.ACenter,True)
        self.context_detail=self.label(self.context_frame,'',.63,-.112,.030,MUTED,False,TextNode.ACenter,True)
        self.held=self.label(self.hud,'',0,-.54,.035,YELLOW,True,TextNode.ACenter,True)
        self.context_frame.hide()

        self.frame(self.hud,-a+.07,-.80,2.65,.125,DARK)
        self.label(self.hud,'ПОДСКАЗКА',-a+.105,-.849,.027,YELLOW,True)
        self.tutorial=self.label(self.hud,'',-a+.105,-.896,.033,CREAM,may_change=True)
        self.label(self.hud,'WASD  движение    SHIFT  бег    E  взять / положить    F  перевернуть    R  завернуть    ESC  пауза',
                   0,-.975,.026,CREAM,False,TextNode.ACenter)
        self.toast_frame=self.frame(self.hud,-.63,.77,1.26,.10,(.11,.29,.23,.96))
        self.toast=self.label(self.toast_frame,'',.63,-.065,.034,WHITE,True,TextNode.ACenter,True)
        self.toast_frame.hide()

    def show_hud(self,yes):
        if yes: self.hud.show()
        else: self.hud.hide()

    def notify(self,message,ok=True):
        if not message: return
        self.toast['text']=message
        self.toast_frame['frameColor']=(.11,.29,.23,.96) if ok else (.47,.19,.14,.96)
        self.toast_frame.show(); self.notice_timer=3.5

    def update(self, shift, target, dt):
        day=shift.profile.day
        self.day_label['text']=f'{day:02d}'
        seconds=max(0,int(shift.remaining+0.999))
        self.time_label['text']=f'{seconds//60:02d}:{seconds%60:02d}'
        self.money_label['text']=f'$ {shift.earnings}'
        self.mission['text']='Обслужи гостей'
        self.submission['text']=f'Выдано: {shift.served}     Ушло: {shift.lost}'
        self.tutorial['text']=shift.tutorial()
        for i,(card,title,ingredients,sides,bar) in enumerate(self.order_widgets):
            if i>=len(shift.orders): card.hide(); continue
            card.show(); o=shift.orders[i]
            title['text']=f'#{o.number:02d}   {o.recipe.name}'
            chosen=[TOPPING_NAMES[k] for k in ('cheese','lettuce','tomato','pickle') if k in o.recipe.toppings]
            ingredients['text']='бургер: '+', '.join(chosen)+('  ✓' if o.burger_done else '')
            extra=[]
            if o.needs_fries: extra.append('фри'+(' ✓' if o.fries_done else ''))
            if o.needs_soda: extra.append('напиток'+(' ✓' if o.soda_done else ''))
            sides['text']=(' + '.join(extra)) if extra else 'только бургер'
            bar['frameSize']=(0,.65*o.percent,-.012,0)
            bar['frameColor']=GREEN if o.percent>.4 else ORANGE
        if shift.held:
            name=ITEM_NAMES.get(shift.held.kind,shift.held.kind).upper()
            self.held['text']=f'В РУКАХ: {name}    ·    Q — УБРАТЬ'
        else: self.held['text']=''
        if target:
            self.context_frame.show()
            title,detail=self.context_for(target,shift)
            self.context['text']=title
            self.context_detail['text']=detail
        else: self.context_frame.hide()
        if self.notice_timer>0:
            self.notice_timer-=dt
            if self.notice_timer<=0: self.toast_frame.hide()

    def context_for(self, station, shift):
        key=station.key
        if key=='fridge': return 'E   ВЗЯТЬ КОТЛЕТУ', 'ХОЛОДИЛЬНИК  /  свежие ингредиенты'
        if key=='grill':
            if shift.patty:
                p=shift.patty
                side=f'СТОРОНЫ: {int(p.sides[0])}% / {int(p.sides[1])}%'
                if p.burnt: return 'E   СНЯТЬ СГОРЕВШУЮ КОТЛЕТУ',side
                if p.ready: return 'E   СНЯТЬ КОТЛЕТУ',side+'  ·  ГОТОВО!'
                return 'F   ПЕРЕВЕРНУТЬ КОТЛЕТУ',side+'  ·  обе стороны от 85%'
            return 'E   ПОЛОЖИТЬ КОТЛЕТУ','ГРИЛЬ  /  сначала возьми её в холодильнике'
        if key=='board':
            layers=', '.join(TOPPING_NAMES.get(i,'котлета' if i=='patty' else 'булочка') for i in shift.board)
            return 'E   ДОБАВИТЬ   /   R   ЗАВЕРНУТЬ', ('НА ДОСКЕ: '+layers) if layers else 'СТОЛ СБОРКИ  /  булочка появится сама'
        if key in TOPPING_NAMES: return 'E   ВЗЯТЬ '+station.label,'Добавь на столе сборки'
        if key=='fryer':
            status=shift.fryer.status(shift.fryer_seconds)
            detail=('ГОТОВНОСТЬ: '+str(int(min(200,100*shift.fryer.elapsed/shift.fryer_seconds)))+'%') if shift.fryer.active else 'Картошка жарится автоматически'
            return ('E   ВЗЯТЬ КАРТОШКУ' if status in ('ГОТОВА','СГОРЕЛА') else 'E   НАЧАТЬ ЖАРКУ'),status+'  /  '+detail
        if key=='soda': return 'E   НАЛИТЬ НАПИТОК','Газировка для заказа'
        if key=='service': return 'E   ВЫДАТЬ ЗАКАЗ','Отдай бургер, фри и напиток по отдельности'
        if key=='bin': return 'E   ВЫБРОСИТЬ','Убрать предмет в руках или очистить доску'
        return station.label,''

    def _darken(self):
        a=self.aspect
        self.frame(self.overlay,-a,1,2*a,2,(.025,.07,.065,.93))

    def menu(self):
        self.show_hud(False); self.clear_overlay(); self._darken(); a=self.aspect
        # Editorial title screen: big type and original poster artwork.
        self.frame(self.overlay,-a+.18,.81,.60,.07,ORANGE)
        self.label(self.overlay,'НЕЗАВИСИМАЯ ИГРА',-a+.215,.761,.027,WHITE,True)
        self.label(self.overlay,'BURGER',-a+.17,.49,.19,CREAM,True)
        self.label(self.overlay,'SHIFT',-a+.17,.27,.19,YELLOW,True)
        self.label(self.overlay,'СИМУЛЯТОР БУРГЕРНОЙ',-a+.18,.13,.043,CREAM,True)
        self.label(self.overlay,'Жарь. Собирай. Выдавай. Не дай гостям заскучать.',-a+.18,.055,.035,MUTED)
        self.button(self.overlay,'НАЧАТЬ СМЕНУ',-a+.18,-.075,1.38,.14,self.game.start_shift)
        self.button(self.overlay,'КАК ИГРАТЬ',-a+.18,-.25,1.38,.12,self.guide,color=(.20,.34,.30,1),text_color=CREAM,size=.044)
        self.button(self.overlay,'ВЫХОД',-a+.18,-.40,.67,.10,self.game.userExit,color=(.14,.25,.23,1),text_color=CREAM,size=.039)
        self.label(self.overlay,f'ДЕНЬ {self.game.profile.day:02d}    /    БАЛАНС ${self.game.profile.bank}',-a+.18,-.69,.036,YELLOW,True)
        self.label(self.overlay,'Одиночная игра  •  создано по мотивам Burger Shift: Team Rush',-a+.18,-.84,.028,MUTED)
        # Image is an original generated asset; it is not a screenshot of the original.
        poster_x=a-.74
        self.frame(self.overlay,poster_x-.52,.83,1.04,1.62,(.88,.72,.46,1))
        img=OnscreenImage(parent=self.overlay,image='assets/art/diner_poster.png',pos=(poster_x,0,.02),scale=(.49,1,.78))
        img.setTransparency(TransparencyAttrib.MAlpha)
        self._track_overlay(self.overlay, img)
        self.frame(self.overlay,poster_x-.49,-.69,.98,.12,RED)
        self.label(self.overlay,'FRESH FOOD  /  GOOD MOOD',poster_x,-.77,.032,CREAM,True,TextNode.ACenter)

    def guide(self):
        self.clear_overlay(); self._darken(); a=self.aspect
        self.label(self.overlay,'ПЕРВАЯ СМЕНА',-1.35,.70,.10,YELLOW,True)
        self.label(self.overlay,'Всё, что нужно знать, чтобы обслужить первого гостя.',-1.35,.59,.037,MUTED)
        rows=[
            ('01', 'ВОЗЬМИ КОТЛЕТУ', 'Найди холодильник и нажми E. Положи котлету на гриль.'),
            ('02', 'ОБЖАРЬ ОБЕ СТОРОНЫ', 'На гриле нажми F, чтобы перевернуть. После 85% с каждой стороны — E.'),
            ('03', 'СОБЕРИ БУРГЕР', 'На столе сборки добавь котлету и начинку по чеку. Нажми R, чтобы завернуть.'),
            ('04', 'ВЫДАЙ ЗАКАЗ', 'Отнеси еду к выдаче. Фри и напиток выдаются отдельно. Следи за терпением!'),
        ]
        for i,(n,title,body) in enumerate(rows):
            z=.42-i*.25
            self.frame(self.overlay,-1.35,z,2.70,.20,(.10,.22,.20,.98))
            self.label(self.overlay,n,-1.29,z-.12,.055,YELLOW,True)
            self.label(self.overlay,title,-1.13,z-.074,.043,CREAM,True)
            self.label(self.overlay,body,-1.13,z-.142,.031,MUTED)
        self.button(self.overlay,'НАЗАД',-1.35,-.67,.82,.12,self.menu,color=YELLOW,size=.043)
        self.label(self.overlay,'WASD — движение   •   Мышь — обзор   •   SHIFT — бег   •   Q — убрать предмет',-.32,-.745,.029,CREAM)

    def pause(self):
        self.clear_overlay(); self._darken()
        self.label(self.overlay,'ПАУЗА',0,.46,.13,CREAM,True,TextNode.ACenter)
        self.label(self.overlay,'Смена подождёт. Возвращайся, когда будешь готов.',0,.33,.035,MUTED,False,TextNode.ACenter)
        self.button(self.overlay,'ПРОДОЛЖИТЬ',-.72,.17,1.44,.14,self.game.resume)
        self.button(self.overlay,'НАЧАТЬ ЗАНОВО',-.72,-.02,1.44,.12,self.game.start_shift,color=(.20,.34,.30,1),text_color=CREAM,size=.042)
        self.button(self.overlay,'В ГЛАВНОЕ МЕНЮ',-.72,-.19,1.44,.12,self.game.return_menu,color=(.20,.34,.30,1),text_color=CREAM,size=.042)

    def summary(self):
        self.show_hud(False); self.clear_overlay(); self._darken(); s=self.game.shift; p=self.game.profile
        self.label(self.overlay,'СМЕНА ЗАКОНЧЕНА',-1.48,.73,.082,CREAM,True)
        self.label(self.overlay,'Хорошая работа. Самое время улучшить кухню.',-1.48,.62,.038,MUTED)
        for i,(value,caption) in enumerate([(f'{s.served}','ВЫДАНО'),(f'{s.lost}','УШЛО'),(f'${s.earnings}','ЗАРАБОТАНО'),(f'${p.bank}','БАЛАНС')]):
            x=-1.48+i*.72
            self.frame(self.overlay,x,.49,.65,.24,(.10,.23,.20,.98))
            self.label(self.overlay,value,x+.04,.35,.067,YELLOW,True)
            self.label(self.overlay,caption,x+.04,.285,.028,MUTED,True)
        self.label(self.overlay,'УЛУЧШЕНИЯ КУХНИ',-1.48,.10,.046,CREAM,True)
        rows=[('grill','ГРИЛЬ','Быстрее готовятся котлеты'),('fryer','ФРИТЮРНИЦА','Быстрее готовится картофель'),('patience','ТЕРПЕНИЕ','Гости ждут дольше')]
        for i,(key,title,desc) in enumerate(rows):
            z=.025-i*.17; level=getattr(p,key)
            self.frame(self.overlay,-1.48,z,2.72,.14,(.10,.22,.20,.98))
            self.label(self.overlay,f'{title}  {level}/3',-1.42,z-.052,.036,CREAM,True)
            self.label(self.overlay,desc,-1.42,z-.102,.028,MUTED)
            label='МАКС.' if level>=3 else f'${p.upgrade_cost(key)}'
            self.button(self.overlay,label,.59,z-.024,.57,.09,lambda k=key:self.game.buy_upgrade(k),
                        color=YELLOW if level<3 and p.bank>=p.upgrade_cost(key) else (.30,.37,.32,1),
                        text_color=INK if level<3 and p.bank>=p.upgrade_cost(key) else MUTED,size=.032)
        self.button(self.overlay,'СЛЕДУЮЩИЙ ДЕНЬ',-1.48,-.58,1.48,.13,self.game.start_shift,size=.045)
        self.button(self.overlay,'В МЕНЮ',.07,-.58,1.17,.13,self.game.return_menu,color=(.20,.34,.30,1),text_color=CREAM,size=.042)
        self.label(self.overlay,'Прогресс сохраняется автоматически.',-1.48,-.84,.030,MUTED)
