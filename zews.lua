-- ZEWS Visual Studio | MoonLoader 0.26+ / mimgui / GTA SA 1.0 US
-- UTF-8. No network requests, executable patches or changes to timecyc.dat.
-- Address references and compatibility notes: README.md.

local Core = {}
function Core.copy(value)
    if type(value) ~= 'table' then return value end
    local out = {}
    for k, v in pairs(value) do out[k] = Core.copy(v) end
    return out
end
local function number(v, fallback, lo, hi, integer)
    if type(v) ~= 'number' or v ~= v or v == math.huge or v == -math.huge then return fallback end
    v = math.max(lo, math.min(hi, v))
    return integer and math.floor(v + 0.5) or v
end
local function boolean(v, fallback)
    if type(v) == 'boolean' then return v end
    return fallback
end
local function tableOrEmpty(v) return type(v) == 'table' and v or {} end
local function color(v, fallback, alpha)
    v = tableOrEmpty(v)
    local out = {}
    for i = 1, alpha and 4 or 3 do out[i] = number(v[i], fallback[i], 0, 1) end
    return out
end

-- Each array contains 8 time samples x 23 weather types, including interiors.
-- Field order is R/G/B[/A], with independent switches for each group.
Core.groups = {
    { key = 'skyTop', label = 'Небо · зенит', addresses = {0xB7BF78, 0xB7BEC0, 0xB7BE08}, value = {0.22, 0.48, 0.80} },
    { key = 'skyBottom', label = 'Небо · горизонт', addresses = {0xB7BD50, 0xB7BC98, 0xB7BBE0}, value = {0.78, 0.84, 0.92} },
    { key = 'ambient', label = 'Освещение окружения', addresses = {0xB7C3C8, 0xB7C310, 0xB7C258}, value = {0.38, 0.40, 0.45} },
    { key = 'objects', label = 'Освещение объектов', addresses = {0xB7C1A0, 0xB7C0E8, 0xB7C030}, value = {0.42, 0.42, 0.45} },
    { key = 'sun', label = 'Солнце · ядро', addresses = {0xB7BB28, 0xB7BA70, 0xB7B9B8}, value = {1.0, 0.91, 0.68} },
    { key = 'corona', label = 'Солнце · свечение', addresses = {0xB7B900, 0xB7B848, 0xB7B790}, value = {1.0, 0.75, 0.40} },
    { key = 'clouds', label = 'Низкие облака', addresses = {0xB7AEF0, 0xB7AE38, 0xB7AD80}, value = {0.85, 0.87, 0.92} },
    { key = 'fluffy', label = 'Объёмные облака · низ', addresses = {0xB7ACC8, 0xB7AC10, 0xB7AB58}, value = {0.85, 0.85, 0.90} },
    { key = 'water', label = 'Вода · цвет и прозрачность', addresses = {0xB7AAA0, 0xB7A9E8, 0xB7A930, 0xB7A878}, value = {0.15, 0.48, 0.57, 0.65} },
    { key = 'postfx1', label = 'Color filter 1 · RGBA', addresses = {0xB7A7C0, 0xB7A708, 0xB7A650, 0xB7A598}, value = {0.95, 0.85, 0.75, 0.16} },
    { key = 'postfx2', label = 'Color filter 2 · RGBA', addresses = {0xB7A4E0, 0xB7A428, 0xB7A370, 0xB7A2B8}, value = {0.72, 0.82, 1.0, 0.12} },
}
Core.scalars = {
    {key = 'farClip', label = 'Дальность прорисовки', address = 0xB7B1D0, size = 2, min = 200, max = 2000, default = 900, factor = 1},
    {key = 'fogStart', label = 'Начало тумана', address = 0xB7B060, size = 2, min = 0, max = 1900, default = 250, factor = 1},
    {key = 'shadows', label = 'Интенсивность теней', address = 0xB7B4B0, size = 1, min = 0, max = 255, default = 150, factor = 1},
    {key = 'lightShadows', label = 'Тени от источников света', address = 0xB7B3F8, size = 1, min = 0, max = 255, default = 100, factor = 1},
    {key = 'poleShadows', label = 'Тени столбов', address = 0xB7B340, size = 1, min = 0, max = 255, default = 100, factor = 1},
    {key = 'sunSize', label = 'Размер солнца', address = 0xB7B6D8, size = 1, min = 0, max = 10, default = 1, factor = 10},
    {key = 'cloudAlpha', label = 'Непрозрачность облаков', address = 0xB7A200, size = 1, min = 0, max = 255, default = 180, factor = 1},
    {key = 'waterFog', label = 'Туман воды', address = 0xB7A090, size = 1, min = 0, max = 255, default = 0, factor = 1},
}
function Core.defaults()
    local d = {
        enabled = true, autosave = true,
        hud = { custom = false, hideNative = false, hideRadar = false, health = true, armor = true,
            money = true, clock = true, fps = true, x = 0.77, y = 0.08, scale = 1,
            opacity = 0.88, healthColor = {0.35, 0.88, 0.70, 1}, armorColor = {0.48, 0.65, 1, 1},
            accent = {0.48, 0.65, 1, 1} },
        world = { lockTime = false, hour = 12, minute = 0, lockWeather = false, weather = 1 },
        graphics = {}, cycle = {},
    }
    for _, g in ipairs(Core.groups) do d.cycle[g.key] = { enabled = false, color = Core.copy(g.value) } end
    for _, s in ipairs(Core.scalars) do d.graphics[s.key] = { enabled = false, value = s.default } end
    return d
end
function Core.sanitize(input)
    input = tableOrEmpty(input)
    local d = Core.defaults()
    d.enabled = boolean(input.enabled, d.enabled)
    d.autosave = boolean(input.autosave, d.autosave)
    local h, w = tableOrEmpty(input.hud), tableOrEmpty(input.world)
    for _, k in ipairs({'custom', 'hideNative', 'hideRadar', 'health', 'armor', 'money', 'clock', 'fps'}) do
        d.hud[k] = boolean(h[k], d.hud[k])
    end
    for _, spec in ipairs({{'x', 0, 1}, {'y', 0, 1}, {'scale', 0.65, 1.6}, {'opacity', 0, 1}}) do
        d.hud[spec[1]] = number(h[spec[1]], d.hud[spec[1]], spec[2], spec[3])
    end
    for _, k in ipairs({'healthColor', 'armorColor', 'accent'}) do d.hud[k] = color(h[k], d.hud[k], true) end
    d.world.lockTime = boolean(w.lockTime, false)
    d.world.lockWeather = boolean(w.lockWeather, false)
    d.world.hour = number(w.hour, 12, 0, 23, true)
    d.world.minute = number(w.minute, 0, 0, 59, true)
    d.world.weather = number(w.weather, 1, 0, 22, true)
    local cycle, graphics = tableOrEmpty(input.cycle), tableOrEmpty(input.graphics)
    for _, g in ipairs(Core.groups) do
        local v = tableOrEmpty(cycle[g.key])
        d.cycle[g.key] = {enabled = boolean(v.enabled, false), color = color(v.color, g.value, #g.value == 4)}
    end
    for _, s in ipairs(Core.scalars) do
        local v = tableOrEmpty(graphics[s.key])
        d.graphics[s.key] = {enabled = boolean(v.enabled, false), value = number(v.value, s.default, s.min, s.max, s.factor == 1)}
    end
    -- Constrain fog only when both overrides are owned by ZEWS.
    if d.graphics.farClip.enabled and d.graphics.fogStart.enabled then
        d.graphics.fogStart.value = math.min(d.graphics.fogStart.value, d.graphics.farClip.value - 10)
    end
    return d
end

-- Own only data we actually change. Restore only if it still equals our last write,
-- so unloading does not overwrite a later change by another mod/server.
function Core.newPatcher(read, write)
    local p = { entries = {} }
    function p:set(key, address, size, values)
        local e = self.entries[key]
        if not e then
            e = {address = address, size = size, original = {}, last = {}}
            for i = 1, #values do e.original[i] = read(address + (i - 1) * size, size) end
            self.entries[key] = e
        end
        for i, value in ipairs(values) do
            local a = address + (i - 1) * size
            if e.last[i] ~= value then
                write(a, size, value)
                e.last[i] = value
            end
        end
    end
    function p:restore(key)
        local e = self.entries[key]
        if not e then return end
        for i, original in ipairs(e.original) do
            local a = e.address + (i - 1) * e.size
            if read(a, e.size) == e.last[i] then write(a, e.size, original) end
        end
        self.entries[key] = nil
    end
    function p:restoreAll()
        local keys = {}
        for key in pairs(self.entries) do keys[#keys + 1] = key end
        for _, key in ipairs(keys) do self:restore(key) end
    end
    return p
end
function Core.presets(name, current)
    local d = Core.sanitize(current)
    d.enabled = true
    -- Presets replace world/graphics/cycle, but keep personal HUD layout.
    local base = Core.defaults()
    d.world, d.graphics, d.cycle = base.world, base.graphics, base.cycle
    local function scalar(k, v) d.graphics[k] = {enabled = true, value = v} end
    local function tint(k, v) d.cycle[k] = {enabled = true, color = v} end
    if name == 'clean' then
        d.world = {lockTime = true, hour = 12, minute = 0, lockWeather = true, weather = 1}
        scalar('farClip', 1000); scalar('fogStart', 450)
        tint('skyTop', {0.20, 0.48, 0.78}); tint('skyBottom', {0.75, 0.85, 0.95})
    elseif name == 'sunset' then
        d.world = {lockTime = true, hour = 20, minute = 0, lockWeather = true, weather = 0}
        scalar('farClip', 900); scalar('fogStart', 220); scalar('sunSize', 2)
        tint('skyTop', {0.32, 0.25, 0.48}); tint('skyBottom', {1, 0.55, 0.35})
        tint('sun', {1, 0.82, 0.48}); tint('corona', {1, 0.43, 0.22})
    elseif name == 'night' then
        d.world = {lockTime = true, hour = 0, minute = 0, lockWeather = true, weather = 1}
        scalar('farClip', 800); scalar('fogStart', 180)
        tint('skyTop', {0.025, 0.04, 0.10}); tint('skyBottom', {0.12, 0.15, 0.26})
        tint('ambient', {0.16, 0.19, 0.29}); tint('objects', {0.22, 0.24, 0.34})
    elseif name == 'soft' then
        d.world = {lockTime = true, hour = 9, minute = 0, lockWeather = true, weather = 4}
        scalar('farClip', 700); scalar('fogStart', 120); scalar('shadows', 80)
        tint('skyTop', {0.48, 0.58, 0.67}); tint('skyBottom', {0.76, 0.79, 0.80})
    end
    return Core.sanitize(d)
end

-- Allows headless tests without loading MoonLoader, FFI or game memory.
if rawget(_G, 'ZEWS_TEST') then return Core end

script_name('ZEWS Visual Studio')
script_author('ZEWS')
script_version('1.0.0')
script_description('HUD, graphics and timecycle editor. Open: /zews')
require 'lib.moonloader'
local ok, imgui = pcall(require, 'mimgui')
if not ok then error('ZEWS: mimgui is required. Install THE-FYP/mimgui into moonloader/lib.') end
local ffi = require 'ffi'
local memory = require 'memory'
local bit = require 'bit'
-- Keep pixel-based HUD positioning predictable; the HUD has its own scale slider.
imgui.SetDpiScalingMode(0)
local new = imgui.new
local glyphRanges -- Font atlas retains this memory until the renderer is destroyed.
local open = new.bool(false)
local editingHud = false
local tab = 1
local ready, supported = false, false
local cfg = Core.defaults()
local profiles = {}
local pending, changedAt, applyDirty = false, 0, true
local status = 'Изменения применяются сразу. /zews — открыть или закрыть.'
local path = getWorkingDirectory() .. '\\config\\zews.json'
local patcher = Core.newPatcher(
    function(a, size) return memory.read(a, size, false) end,
    function(a, size, value) memory.write(a, value, size, false) end)
local timeSnapshot, weatherSnapshot
local fps, frames, fpsAt = 0, 0, 0
local lastMaster = true

local function notify(text) status = text end
local function mark()
    pending, changedAt, applyDirty = true, getGameTimer(), true
end
local function readJSON(file)
    local f = io.open(file, 'rb')
    if not f then return nil end
    local content = f:read('*a'); f:close()
    if #content > 512 * 1024 then return nil end
    local success, value = pcall(decodeJson, content)
    if success and type(value) == 'table' and value.version == 1 and type(value.settings) == 'table' then return value end
end
local function load()
    local data = readJSON(path)
    if not data then
        data = readJSON(path .. '.bak')
        if data then notify('Основной конфиг повреждён: загружена резервная копия.') end
    end
    if not data then return end
    cfg = Core.sanitize(data.settings)
    for i = 1, 3 do
        local p = tableOrEmpty(data.profiles)[tostring(i)]
        if type(p) == 'table' then profiles[tostring(i)] = Core.sanitize(p) end
    end
end
local function save()
    cfg = Core.sanitize(cfg)
    local success, content = pcall(encodeJson, {version = 1, settings = cfg, profiles = profiles})
    if not success then notify('Не удалось сформировать JSON.'); return false end
    local f = io.open(path .. '.tmp', 'wb')
    if not f then notify('Нет доступа к moonloader/config. Настройки не сохранены.'); return false end
    local written = f:write(content)
    local closed = f:close()
    if not written or not closed then os.remove(path .. '.tmp'); notify('Ошибка записи конфига.'); return false end
    local existing = io.open(path, 'rb')
    if existing then
        existing:close()
        os.remove(path .. '.bak')
        if not os.rename(path, path .. '.bak') then os.remove(path .. '.tmp'); notify('Не удалось создать резервную копию.'); return false end
    end
    if not os.rename(path .. '.tmp', path) then
        if existing then os.rename(path .. '.bak', path) end
        notify('Не удалось заменить конфиг. Предыдущая версия сохранена.'); return false
    end
    pending = false
    notify('Настройки сохранены · moonloader/config/zews.json')
    return true
end

local function fill(value)
    local values = {}
    for i = 1, 184 do values[i] = value end
    return values
end
local function applyArrays()
    if not supported then return end
    for _, group in ipairs(Core.groups) do
        local v = cfg.cycle[group.key]
        for i, address in ipairs(group.addresses) do
            local key = group.key .. i
            if cfg.enabled and v.enabled then patcher:set(key, address, 1, fill(math.floor(v.color[i] * 255 + 0.5)))
            else patcher:restore(key) end
        end
    end
    for _, spec in ipairs(Core.scalars) do
        local v = cfg.graphics[spec.key]
        if cfg.enabled and v.enabled then
            patcher:set(spec.key, spec.address, spec.size, fill(math.floor(v.value * spec.factor + 0.5)))
        else patcher:restore(spec.key) end
    end
end
local function restoreWorld()
    if timeSnapshot then
        local h, m = getTimeOfDay()
        if h == timeSnapshot.lastHour and m == timeSnapshot.lastMinute then setTimeOfDay(timeSnapshot.hour, timeSnapshot.minute) end
        timeSnapshot = nil
    end
    if weatherSnapshot then
        -- Release only the forced weather value that ZEWS still owns.
        if memory.read(0xC81318, 2, false) == weatherSnapshot.last then
            for _, a in ipairs({0xC81318, 0xC8131C, 0xC81320}) do memory.write(a, weatherSnapshot[a], 2, false) end
        end
        weatherSnapshot = nil
    end
end
local function applyFrame()
    if not supported then return end
    if applyDirty then
        cfg = Core.sanitize(cfg)
        applyArrays()
        applyDirty = false
    end
    if cfg.enabled then
        if cfg.hud.hideNative then patcher:set('nativeHud', 0xBAA45D, 1, {0}) else patcher:restore('nativeHud') end
        if cfg.hud.hideRadar then patcher:set('radar', 0xBAA3FB, 1, {1}) else patcher:restore('radar') end
    end
    if not cfg.enabled then
        if lastMaster then patcher:restoreAll(); restoreWorld() end
        lastMaster = false
        return
    end
    lastMaster = true
    local w = cfg.world
    if w.lockTime then
        if not timeSnapshot then
            local h, m = getTimeOfDay()
            timeSnapshot = {hour = h, minute = m}
        end
        setTimeOfDay(w.hour, w.minute)
        timeSnapshot.lastHour, timeSnapshot.lastMinute = w.hour, w.minute
    elseif timeSnapshot then
        local h, m = getTimeOfDay()
        if h == timeSnapshot.lastHour and m == timeSnapshot.lastMinute then setTimeOfDay(timeSnapshot.hour, timeSnapshot.minute) end
        timeSnapshot = nil
    end
    if w.lockWeather then
        if not weatherSnapshot then
            weatherSnapshot = {}
            for _, a in ipairs({0xC81318, 0xC8131C, 0xC81320}) do weatherSnapshot[a] = memory.read(a, 2, false) end
        end
        forceWeatherNow(w.weather)
        weatherSnapshot.last = w.weather
    elseif weatherSnapshot then
        if memory.read(0xC81318, 2, false) == weatherSnapshot.last then
            for _, a in ipairs({0xC81318, 0xC8131C, 0xC81320}) do memory.write(a, weatherSnapshot[a], 2, false) end
        end
        weatherSnapshot = nil
    end
end

-- UI helpers use transient FFI values; JSON always contains plain Lua values.
local function check(label, object, key)
    local value = new.bool(object[key])
    if imgui.Checkbox(label, value) then object[key] = value[0]; mark(); return true end
end
local function slider(label, object, key, lo, hi, integer)
    local value = integer and new.int(object[key]) or new.float(object[key])
    local changed
    if integer then changed = imgui.SliderInt(label, value, lo, hi)
    else changed = imgui.SliderFloat(label, value, lo, hi, '%.2f') end
    if changed then object[key] = tonumber(value[0]); mark() end
end
local function colorEdit(label, object, key)
    local value, arr = object[key], new.float[#object[key]]()
    for i = 1, #value do arr[i - 1] = value[i] end
    local changed
    if #value == 4 then changed = imgui.ColorEdit4(label, arr)
    else changed = imgui.ColorEdit3(label, arr) end
    if changed then for i = 1, #value do value[i] = tonumber(arr[i - 1]) end; mark() end
end
local function muted(text) imgui.TextColored(imgui.ImVec4(0.53, 0.58, 0.69, 1), text) end
local function paragraph(text) imgui.TextWrapped(text); imgui.Spacing() end
local function heading(title, description)
    imgui.TextColored(imgui.ImVec4(0.58, 0.70, 1, 1), title)
    if description then paragraph(description) end
    imgui.Spacing(); imgui.Separator(); imgui.Spacing()
end
local function button(text, width) return imgui.Button(text, imgui.ImVec2(width or 0, 34)) end
local function preset(name)
    cfg = Core.presets(name, cfg); mark()
    notify('Пресет применён. Отдельные параметры можно изменить во вкладках.')
end
local function resetAll()
    cfg = Core.defaults(); editingHud = false; mark()
    notify('Настройки ZEWS сброшены. Сохранённые профили оставлены.')
end

local function drawOverview()
    heading('Твой San Andreas. Твоя атмосфера.', 'Локальная настройка картинки без замены файлов игры. Начни с пресета или собери свой стиль.')
    check('ZEWS включён', cfg, 'enabled')
    imgui.SameLine(); muted(cfg.enabled and 'LIVE PREVIEW' or 'ПАУЗА · оригинальные значения возвращены')
    imgui.Spacing()
    local presets = {
        {'clean', '01 / CLEAN DAY', 'Чистое синее небо, полдень и дальний горизонт.'},
        {'sunset', '02 / GOLDEN HOUR', 'Тёплый горизонт, мягкое солнце и вечерний свет.'},
        {'night', '03 / MIDNIGHT', 'Холодная ночная палитра и приглушённое окружение.'},
        {'soft', '04 / SOFT HAZE', 'Пасмурное утро, лёгкая дымка и мягкие тени.'},
    }
    for _, p in ipairs(presets) do
        imgui.PushID(p[1])
        if button(p[2], 210) then preset(p[1]) end
        imgui.TextWrapped(p[3]); imgui.Spacing()
        imgui.PopID()
    end
    imgui.Separator(); imgui.Spacing()
    paragraph('Пресеты заменяют только время, погоду, графику и палитру. Твой HUD и пользовательские профили сохраняются.')
    paragraph('Графика здесь — параметры штатного рендера GTA SA. Это не ENB/ReShade: отражения, SSAO и современные шейдеры требуют отдельных модов.')
end
local function drawHudSettings()
    heading('HUD / меньше шума, больше игры', 'Настраиваемый HUD — отдельная панель здоровья, брони, денег и времени. Штатный интерфейс скрывается отдельно.')
    check('Свой HUD', cfg.hud, 'custom')
    check('Скрывать стандартный HUD GTA', cfg.hud, 'hideNative')
    check('Скрывать радар', cfg.hud, 'hideRadar')
    imgui.Separator(); imgui.Spacing()
    if button(editingHud and 'Завершить перемещение' or 'Переместить HUD мышью', 270) then
        editingHud = not editingHud
        if editingHud then cfg.hud.custom = true; mark() end
    end
    paragraph('В режиме перемещения перетащи панель за её фон. /zews закрывает меню и завершает перемещение.')
    slider('Позиция X', cfg.hud, 'x', 0, 1, false)
    slider('Позиция Y', cfg.hud, 'y', 0, 1, false)
    slider('Масштаб HUD', cfg.hud, 'scale', 0.65, 1.6, false)
    slider('Плотность фона', cfg.hud, 'opacity', 0, 1, false)
    for _, spec in ipairs({{'health', 'Здоровье'}, {'armor', 'Броня'}, {'money', 'Деньги'}, {'clock', 'Время'}, {'fps', 'FPS'}}) do check(spec[2], cfg.hud, spec[1]) end
    imgui.Spacing()
    colorEdit('Цвет здоровья', cfg.hud, 'healthColor')
    colorEdit('Цвет брони', cfg.hud, 'armorColor')
    colorEdit('Акцент HUD', cfg.hud, 'accent')
    paragraph('Элементы сторонних HUD-модов и серверные TextDraw не изменяются. Положение и размеры штатного радара не редактируются.')
end
local function drawGraphics()
    heading('GRAPHICS / штатный рендер', 'Галочка включает переопределение параметра. Без галочки используются исходные таблицы твоей сборки.')
    for _, spec in ipairs(Core.scalars) do
        imgui.PushID(spec.key)
        local v = cfg.graphics[spec.key]
        check('##enabled', v, 'enabled'); imgui.SameLine()
        slider(spec.label, v, 'value', spec.min, spec.max, spec.factor == 1)
        imgui.PopID()
    end
    imgui.Spacing(); imgui.Separator(); imgui.Spacing()
    paragraph('Большая дальность может снизить FPS и не увеличивает серверную дистанцию стриминга. Туман автоматически ограничивается дальностью, если включены оба параметра.')
    paragraph('Изменения таблиц общие для всех часов и погод, включая интерьерные слоты. Особые зоны, интерьеры и другие графические моды могут влиять на итоговую картинку.')
end
local weatherNames = {'Солнечно / LA', 'Ясно / LA', 'Ясно + смог / LA', 'Солнце + смог / LA', 'Облачно / LA',
    'Солнечно / SF', 'Ясно / SF', 'Облачно / SF', 'Дождь / SF', 'Туман / SF', 'Солнечно / LV', 'Ясно / LV',
    'Облачно / LV', 'Сельская жара', 'Сельская ясная', 'Сельская облачная', 'Сельский дождь', 'Пустынная жара',
    'Пустынная ясная', 'Песчаная буря', 'Под водой / спец.', 'Интерьер 1 / спец.', 'Интерьер 2 / спец.'}
local function drawWorld()
    heading('WORLD / время и погода', 'Переопределение действует только у тебя. Проверь правила сервера перед использованием.')
    check('Зафиксировать время', cfg.world, 'lockTime')
    slider('Часы', cfg.world, 'hour', 0, 23, true)
    slider('Минуты', cfg.world, 'minute', 0, 59, true)
    imgui.Spacing()
    if button('06:00', 85) then cfg.world.hour = 6; cfg.world.minute = 0; mark() end
    imgui.SameLine(); if button('12:00', 85) then cfg.world.hour = 12; cfg.world.minute = 0; mark() end
    imgui.SameLine(); if button('20:00', 85) then cfg.world.hour = 20; cfg.world.minute = 0; mark() end
    imgui.SameLine(); if button('00:00', 85) then cfg.world.hour = 0; cfg.world.minute = 0; mark() end
    imgui.Spacing(); imgui.Separator(); imgui.Spacing()
    check('Зафиксировать погоду', cfg.world, 'lockWeather')
    slider('ID погоды', cfg.world, 'weather', 0, 22, true)
    imgui.TextColored(imgui.ImVec4(0.58, 0.70, 1, 1), weatherNames[cfg.world.weather + 1])
    if imgui.BeginCombo('Выбор погоды', weatherNames[cfg.world.weather + 1]) then
        for i, name in ipairs(weatherNames) do
            if imgui.Selectable(('%02d / %s'):format(i - 1, name), cfg.world.weather == i - 1) then cfg.world.weather = i - 1; mark() end
        end
        imgui.EndCombo()
    end
    imgui.Spacing()
    paragraph('ID 20–22 — специальные режимы GTA, а не обычная уличная погода. На серверах со своей синхронизацией возможны конфликты и мерцание.')
    paragraph('При отключении фиксации возвращается снимок до включения, если ZEWS всё ещё владеет значением. Следующее обновление сервера установит актуальные время и погоду.')
end
local function drawCycle()
    heading('TIMECYCLE / палитра мира', 'Независимые RGB/RGBA-переопределения. Выбранный цвет записывается во все 184 слота времени и погоды, а не только в текущий час.')
    for _, group in ipairs(Core.groups) do
        imgui.PushID(group.key)
        local v = cfg.cycle[group.key]
        check('##enabled', v, 'enabled'); imgui.SameLine()
        colorEdit(group.label, v, 'color')
        imgui.PopID()
    end
    imgui.Spacing(); imgui.Separator(); imgui.Spacing()
    paragraph('Альфа воды и color filter — параметры движка, а не прозрачность всего экрана. Вид фильтров зависит от активного post-processing и установленных модов.')
    if button('Отключить все цветовые переопределения') then
        for _, v in pairs(cfg.cycle) do v.enabled = false end
        mark()
    end
    paragraph('Оригинальный timecyc.dat не меняется. Отключение галочки возвращает значения из памяти, сохранённые перед включением соответствующей группы.')
end
local function drawProfiles()
    heading('PROFILES / сохранить свой стиль', 'Три локальных слота. Каждый хранит HUD, графику, палитру, время и погоду.')
    check('Автосохранение изменений', cfg, 'autosave')
    imgui.Spacing()
    for i = 1, 3 do
        local key = tostring(i)
        imgui.PushID(i)
        imgui.Text(('ПРОФИЛЬ %02d · %s'):format(i, profiles[key] and 'сохранён' or 'пусто'))
        if button(profiles[key] and 'Перезаписать слот' or 'Сохранить в слот', 180) then
            imgui.OpenPopup('saveSlot')
        end
        if imgui.BeginPopup('saveSlot') then
            imgui.Text('Записать текущие настройки в этот слот?')
            if button('Да, сохранить') then profiles[key] = Core.copy(cfg); mark(); save(); imgui.CloseCurrentPopup() end
            imgui.EndPopup()
        end
        imgui.SameLine()
        if button('Загрузить', 120) then
            if profiles[key] then cfg = Core.sanitize(profiles[key]); mark(); notify('Загружен профиль ' .. key)
            else notify('Этот слот пока пуст.') end
        end
        imgui.Spacing(); imgui.PopID()
    end
    imgui.Separator(); imgui.Spacing()
    if button('Сбросить настройки ZEWS', 260) then imgui.OpenPopup('reset') end
    if imgui.BeginPopup('reset') then
        paragraph('Вернуть настройки ZEWS по умолчанию? Слоты профилей останутся.')
        if button('Подтвердить сброс') then resetAll(); imgui.CloseCurrentPopup() end
        imgui.EndPopup()
    end
    paragraph('Сохранение через временный файл и резервную копию .bak. При повреждении основного JSON загрузится резервная версия.')
    paragraph('Зависимости: MoonLoader 0.26+, mimgui, SA:MP. Адресные функции рассчитаны только на GTA SA 1.0 US Compact/Hoodlum. На другой версии запись в память заблокирована.')
end

imgui.OnInitialize(function()
    imgui.GetIO().IniFilename = nil
    local fontPath = getFolderPath(0x14) .. '\\tahoma.ttf'
    if doesFileExist(fontPath) then
        local builder = imgui.ImFontGlyphRangesBuilder()
        builder:AddRanges(imgui.GetIO().Fonts:GetGlyphRangesCyrillic())
        builder:AddText('·—–…')
        glyphRanges = imgui.ImVector_ImWchar()
        builder:BuildRanges(glyphRanges)
        local font = imgui.GetIO().Fonts:AddFontFromFileTTF(fontPath, 16, nil, glyphRanges[0].Data)
        if font ~= nil then imgui.GetIO().FontDefault = font end
    end
    local s = imgui.GetStyle()
    s.WindowRounding, s.ChildRounding, s.FrameRounding = 14, 10, 6
    s.PopupRounding, s.GrabRounding, s.ScrollbarRounding = 8, 6, 8
    s.WindowPadding, s.FramePadding, s.ItemSpacing = imgui.ImVec2(20, 18), imgui.ImVec2(10, 7), imgui.ImVec2(10, 10)
    s.WindowBorderSize, s.ChildBorderSize, s.FrameBorderSize = 0, 0, 0
    local c = s.Colors
    local function set(k, r, g, b, a) c[imgui.Col[k]] = imgui.ImVec4(r, g, b, a or 1) end
    set('WindowBg', 0.055, 0.064, 0.090, 0.98)
    set('ChildBg', 0.075, 0.086, 0.118, 1)
    set('PopupBg', 0.085, 0.096, 0.135, 1)
    set('Text', 0.89, 0.92, 0.98, 1)
    set('TextDisabled', 0.45, 0.50, 0.61, 1)
    set('FrameBg', 0.12, 0.15, 0.21, 1)
    set('FrameBgHovered', 0.18, 0.23, 0.34, 1)
    set('FrameBgActive', 0.22, 0.29, 0.43, 1)
    set('Button', 0.17, 0.23, 0.36, 1)
    set('ButtonHovered', 0.25, 0.35, 0.56, 1)
    set('ButtonActive', 0.29, 0.42, 0.68, 1)
    set('Header', 0.19, 0.27, 0.43, 1)
    set('HeaderHovered', 0.25, 0.35, 0.56, 1)
    set('HeaderActive', 0.29, 0.42, 0.68, 1)
    set('CheckMark', 0.48, 0.69, 1, 1)
    set('SliderGrab', 0.48, 0.65, 1, 1)
    set('SliderGrabActive', 0.66, 0.79, 1, 1)
    set('Separator', 0.18, 0.21, 0.29, 1)
    set('TitleBg', 0.055, 0.064, 0.090, 1)
    set('TitleBgActive', 0.075, 0.086, 0.118, 1)
end)

local pages = {drawOverview, drawHudSettings, drawGraphics, drawWorld, drawCycle, drawProfiles}
local pageNames = {'01   Обзор', '02   HUD', '03   Графика', '04   Время / погода', '05   Таймцикл', '06   Профили'}
imgui.OnFrame(function() return ready and open[0] end, function()
    local sw, sh = getScreenResolution()
    imgui.SetNextWindowSize(imgui.ImVec2(math.min(960, sw - 30), math.min(680, sh - 30)), imgui.Cond.FirstUseEver)
    imgui.SetNextWindowPos(imgui.ImVec2(sw / 2, sh / 2), imgui.Cond.FirstUseEver, imgui.ImVec2(0.5, 0.5))
    imgui.SetNextWindowSizeConstraints(imgui.ImVec2(math.min(680, sw - 20), math.min(440, sh - 20)), imgui.ImVec2(sw - 10, sh - 10))
    if imgui.Begin('ZEWS / Visual Studio', open, bit.bor(imgui.WindowFlags.NoCollapse, imgui.WindowFlags.NoSavedSettings)) then
        imgui.TextColored(imgui.ImVec4(0.58, 0.72, 1, 1), 'Z E W S')
        imgui.SameLine(); muted('VISUAL STUDIO  /  1.0')
        imgui.Separator(); imgui.Spacing()
        if not supported then
            imgui.TextColored(imgui.ImVec4(1, 0.65, 0.36, 1), 'Версия GTA не распознана. Применение настроек заблокировано.')
        end
        imgui.BeginChild('navigation', imgui.ImVec2(185, -86), false)
        imgui.Spacing()
        for i, name in ipairs(pageNames) do
            if imgui.Selectable(name, tab == i, 0, imgui.ImVec2(0, 38)) then tab = i end
        end
        imgui.Spacing(); imgui.Separator(); imgui.Spacing()
        muted('SA:MP / MOONLOADER')
        muted(supported and 'GTA SA 1.0 US' or 'НЕИЗВЕСТНАЯ ВЕРСИЯ')
        imgui.EndChild()
        imgui.SameLine()
        imgui.BeginChild('content', imgui.ImVec2(0, -86), false)
        imgui.PushItemWidth(math.max(150, imgui.GetContentRegionAvail().x * 0.47))
        pages[tab]()
        imgui.PopItemWidth()
        imgui.EndChild()
        imgui.Separator()
        if button('Сохранить', 135) then save() end
        imgui.SameLine()
        if button('Закрыть', 110) then open[0] = false; editingHud = false end
        imgui.SameLine(); muted(pending and 'ЕСТЬ ИЗМЕНЕНИЯ' or 'СОХРАНЕНО / БЕЗ ИЗМЕНЕНИЙ')
        imgui.TextWrapped(status)
    end
    imgui.End()
    if not open[0] then editingHud = false end
end).LockPlayer = true

-- HUD uses a separate, input-transparent ImGui frame. Position is normalized
-- against free screen space, keeping it visible on different resolutions.
local function packed(c) return imgui.U32(c[1], c[2], c[3], c[4] or 1) end
imgui.OnFrame(function()
    return ready and supported and cfg.enabled and cfg.hud.custom and doesCharExist(PLAYER_PED)
        and not isPauseMenuActive() and not sampIsScoreboardOpen()
end, function()
    frames = frames + 1
    local now = getGameTimer()
    if now - fpsAt >= 500 then fps = math.floor(frames * 1000 / math.max(1, now - fpsAt) + 0.5); frames = 0; fpsAt = now end
    local h = cfg.hud
    local sw, sh = getScreenResolution()
    local scale = math.min(h.scale, (sw - 20) / 258, (sh - 20) / 230)
    local width = 258 * scale
    local height = (46 + (h.health and 43 or 0) + (h.armor and 43 or 0) + (h.money and 30 or 0) + ((h.clock or h.fps) and 30 or 0)) * scale
    local maxX, maxY = math.max(0, sw - width - 10), math.max(0, sh - height - 10)
    imgui.SetNextWindowPos(imgui.ImVec2(5 + maxX * h.x, 5 + maxY * h.y), imgui.Cond.Always)
    imgui.SetNextWindowSize(imgui.ImVec2(width, height), imgui.Cond.Always)
    imgui.SetNextWindowBgAlpha(h.opacity)
    local flags = bit.bor(imgui.WindowFlags.NoTitleBar, imgui.WindowFlags.NoResize,
        imgui.WindowFlags.NoScrollbar, imgui.WindowFlags.NoSavedSettings, imgui.WindowFlags.NoCollapse,
        imgui.WindowFlags.NoMove, imgui.WindowFlags.NoFocusOnAppearing, imgui.WindowFlags.NoBringToFrontOnFocus)
    if not (editingHud and open[0]) then flags = bit.bor(flags, imgui.WindowFlags.NoInputs) end
    imgui.PushStyleVar(imgui.StyleVar.WindowPadding, imgui.ImVec2(14 * scale, 10 * scale))
    imgui.PushStyleVar(imgui.StyleVar.ItemSpacing, imgui.ImVec2(8 * scale, 5 * scale))
    imgui.Begin('##zewsHud', nil, flags)
    imgui.SetWindowFontScale(scale)
    imgui.TextColored(imgui.ImVec4(h.accent[1], h.accent[2], h.accent[3], h.accent[4]), editingHud and 'ZEWS / ПЕРЕТАЩИ МЕНЯ' or 'Z E W S  /  HUD')
    local function bar(label, value, c)
        imgui.Text(('%s  %d'):format(label, math.floor(value)))
        local p = imgui.GetCursorScreenPos()
        local draw = imgui.GetWindowDrawList()
        local bw, bh = math.max(10, width - 28 * scale), 6 * scale
        draw:AddRectFilled(p, imgui.ImVec2(p.x + bw, p.y + bh), packed({0.19, 0.22, 0.28, 1}), 3 * scale)
        draw:AddRectFilled(p, imgui.ImVec2(p.x + bw * math.max(0, math.min(1, value / 100)), p.y + bh), packed(c), 3 * scale)
        imgui.Dummy(imgui.ImVec2(bw, 13 * scale))
    end
    if h.health then bar('HP', getCharHealth(PLAYER_PED), h.healthColor) end
    if h.armor then bar('AP', getCharArmour(PLAYER_PED), h.armorColor) end
    if h.money then imgui.Text(('$ %d'):format(getPlayerMoney(PLAYER_HANDLE))) end
    if h.clock or h.fps then
        local hour, minute = getTimeOfDay()
        imgui.Text((h.clock and ('%02d:%02d'):format(hour, minute) or '') .. (h.clock and h.fps and '  /  ' or '') .. (h.fps and (fps .. ' FPS') or ''))
    end
    if editingHud and open[0] and imgui.IsWindowHovered() and imgui.IsMouseDragging(0, 0) then
        local delta = imgui.GetIO().MouseDelta
        h.x = math.max(0, math.min(1, h.x + delta.x / math.max(1, maxX)))
        h.y = math.max(0, math.min(1, h.y + delta.y / math.max(1, maxY)))
        mark()
    end
    imgui.End()
    imgui.PopStyleVar(2)
end).HideCursor = true

function main()
    if not isSampLoaded() then return end
    while not isSampAvailable() do wait(100) end
    -- Plugin-SDK's 1.0 US Compact/Hoodlum signatures. Unknown => fail closed.
    local signature = memory.read(0x401000, 4, false)
    supported = signature == 0x53EC8B55 or signature == 0x16197BE9
    local dir = getWorkingDirectory() .. '\\config'
    if not doesDirectoryExist(dir) then createDirectory(dir) end
    load()
    sampRegisterChatCommand('zews', function()
        open[0] = not open[0]
        if not open[0] then editingHud = false end
    end)
    ready = true
    sampAddChatMessage('[ZEWS] Visual Studio loaded. Open: /zews', 0x8EADFF)
    if not supported then sampAddChatMessage('[ZEWS] Unsupported GTA version. Memory writes disabled (requires 1.0 US).', 0xFFB070) end
    while true do
        wait(0)
        if isSampAvailable() then applyFrame() end
        if pending and cfg.autosave and getGameTimer() - changedAt > 900 then
            if not save() then changedAt = getGameTimer() + 5000 end
        end
    end
end
function onScriptTerminate(script, quitGame)
    if script ~= thisScript() then return end
    if ready and pending and cfg.autosave then pcall(save) end
    if supported then
        pcall(function() patcher:restoreAll(); restoreWorld() end)
    end
end
