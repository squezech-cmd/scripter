-- Headless integration harness: real LuaJIT FFI values, mocked MoonLoader/game/ImGui.
-- No Windows DLL is loaded and no real process memory is accessed.
local ffi = require 'ffi'
local bit = require 'bit'
local click, selectPage, checkbox, changeSlider, openedPopup
local frames, initializers, commands, files = {}, {}, {}, {}
local scriptVersion, lastChatMessage
local dpiCalls, fontLoads = 0, 0
local clock, hour, minute, timeCalls, weatherCalls = 0, 8, 35, 0, 0
local memoryData, writeCount = {}, 0
local signature = TEST_SIGNATURE or 0x53EC8B55
memoryData[0x401000] = signature
memoryData[0xC81318], memoryData[0xC8131C], memoryData[0xC81320] = 65535, 4, 4
memoryData[0xBAA45D], memoryData[0xBAA3FB] = 1, 0
local function read(a, size) if memoryData[a] ~= nil then return memoryData[a] end return 42 end
local function write(a, v, size) memoryData[a] = v; writeCount = writeCount + 1 end
package.preload['memory'] = function() return {read = read, write = write} end
package.preload['lib.moonloader'] = function() return {} end
local function enum(names)
    local e = {}; local i = 0
    for name in names:gmatch('%S+') do e[name] = 2^i; i = i + 1 end
    return setmetatable(e, {__index = function(_, k) error('Unknown enum: ' .. k) end})
end
local ioState = {MouseDelta = {x = 5, y = 3}, Fonts = {
    GetGlyphRangesCyrillic = function() return {} end,
    AddFontFromFileTTF = function()
        if TEST_FONT_ERROR then error('test: Tahoma could not be loaded') end
        fontLoads = fontLoads + 1
        return {}
    end}}
local style = {Colors = {}}
local I = {
    WindowFlags = enum('NoCollapse NoSavedSettings NoTitleBar NoResize NoScrollbar NoMove NoFocusOnAppearing NoBringToFrontOnFocus NoInputs'),
    Col = enum('WindowBg ChildBg PopupBg Text TextDisabled FrameBg FrameBgHovered FrameBgActive Button ButtonHovered ButtonActive Header HeaderHovered HeaderActive CheckMark SliderGrab SliderGrabActive Separator TitleBg TitleBgActive'),
    StyleVar = enum('WindowPadding ItemSpacing'), Cond = enum('FirstUseEver Always'),
    new = setmetatable({}, {__index = function(_, k)
        local t = ffi.typeof(k)
        return setmetatable({}, {
            __call = function(_, v) return ffi.typeof('$[1]', t)(v) end,
            __index = function(_, n) return function() return ffi.typeof('$[?]', t)(n) end end})
    end}),
    ImVec2 = function(x, y) return {x = x, y = y} end,
    ImVec4 = function(x,y,z,w) return {x=x,y=y,z=z,w=w} end,
    ImFontGlyphRangesBuilder = function()
        return {AddRanges = function() end, AddText = function() end,
            BuildRanges = function(_, ranges) ranges[0] = {Data = {}} end}
    end,
    ImVector_ImWchar = function() return {} end,
    GetIO = function() return ioState end, GetStyle = function() return style end,
    OnInitialize = function(f) initializers[#initializers+1] = f end,
    OnFrame = function(cond, draw) local f = {condition = cond, draw = draw}; frames[#frames+1] = f; return f end,
    GetContentRegionAvail = function() return {x=600,y=500} end,
    GetCursorScreenPos = function() return {x=0,y=0} end,
    GetWindowDrawList = function()
        return {AddRectFilled = function(_, p1, p2, rgba)
            assert(type(rgba) == 'number' and rgba >= 0 and rgba <= 4294967295)
            assert(rgba == math.floor(rgba), 'ImU32 color must be an integer')
            assert(p2.x >= p1.x and p2.y >= p1.y, 'HUD bar inverted')
        end}
    end,
    IsWindowHovered = function() return true end,
    IsMouseDragging = function() return false end,
    U32 = function() return 0 end,
    Begin = function() return true end, BeginChild = function() return true end,
    BeginCombo = function() return true end,
    OpenPopup = function(name) openedPopup = name end,
    BeginPopup = function(name) return openedPopup == name end,
    CloseCurrentPopup = function() openedPopup = nil end,
    Button = function(label)
        if click == label then click = nil; return true end
        return false
    end,
    Selectable = function(label)
        if selectPage == label then selectPage = nil; return true end
        return false
    end,
    Checkbox = function(label, value)
        if checkbox == label then checkbox = nil; value[0] = not value[0]; return true end
        return false
    end,
    SliderInt = function(label, value)
        if changeSlider and changeSlider.label == label then value[0] = changeSlider.value; changeSlider = nil; return true end
        return false
    end,
    SliderFloat = function() return false end,
    ColorEdit3 = function(label, arr) assert(ffi.sizeof(arr) == 12); return false end,
    ColorEdit4 = function(label, arr) assert(ffi.sizeof(arr) == 16); return false end,
}
for name in ('SetDpiScalingMode Text TextWrapped TextColored Spacing Separator SameLine PushID PopID EndCombo EndPopup SetNextWindowSize SetNextWindowPos SetNextWindowSizeConstraints EndChild End PushItemWidth PopItemWidth SetNextWindowBgAlpha PushStyleVar PopStyleVar SetWindowFontScale Dummy'):gmatch('%S+') do I[name] = function() end end
-- The user's log reports exactly this missing API (also absent in mimgui 1.7.0).
local absent = {}
I.SetDpiScalingMode = function(value) assert(value == 0); dpiCalls = dpiCalls + 1 end
if TEST_LEGACY_MIMGUI then
    absent.SetDpiScalingMode = true
    I.SetDpiScalingMode = nil
end
if TEST_MINIMAL_MIMGUI then
    for _, name in ipairs({'ImFontGlyphRangesBuilder', 'ImVector_ImWchar', 'U32'}) do
        absent[name] = true; I[name] = nil
    end
end
setmetatable(I, {__index = function(_, k)
    if absent[k] then return nil end
    error('Unexpected ImGui API: ' .. k)
end})
package.preload['mimgui'] = function() return I end
function script_name() end; function script_author() end
function script_version(v) scriptVersion = v end
function script_description() end
function getWorkingDirectory() return 'MOONLOADER' end
function getGameTimer() return clock end
function getFolderPath() return 'FONT' end
function doesFileExist() return TEST_FONT_PRESENT end
function doesDirectoryExist() return true end
function isSampLoaded() return true end
function isSampAvailable() return true end
function sampRegisterChatCommand(name, fn) commands[name] = fn end
function sampAddChatMessage(text) lastChatMessage = text end
function getTimeOfDay() return hour, minute end
function setTimeOfDay(h, m) hour = h; minute = m; timeCalls = timeCalls + 1 end
function forceWeatherNow(w) memoryData[0xC81318] = w; memoryData[0xC8131C] = w; memoryData[0xC81320] = w; weatherCalls = weatherCalls + 1 end
function getScreenResolution() return 1920, 1080 end
function doesCharExist() return true end
function isPauseMenuActive() return false end
function sampIsScoreboardOpen() return false end
function getCharHealth() return 150 end -- overflow must be clamped visually
function getCharArmour() return 50 end
function getPlayerMoney() return 12000 end
function thisScript() return 'this' end
function wait(ms) clock = clock + (ms == 0 and 16 or ms); coroutine.yield() end
PLAYER_PED, PLAYER_HANDLE = 1, 0
local encoded = {}
local lastSaved
local function copy(v)
    if type(v) ~= 'table' then return v end
    local out = {}; for k, x in pairs(v) do out[k] = copy(x) end; return out
end
function encodeJson(v)
    lastSaved = copy(v); encoded[#encoded + 1] = copy(v); return tostring(#encoded)
end
function decodeJson(v) assert(encoded[tonumber(v)], 'bad JSON'); return copy(encoded[tonumber(v)]) end
-- In-memory Windows-like filesystem, including replace-by-rename failure.
local renameFails = false
io.open = function(path, mode)
    if mode == 'rb' then
        if files[path] == nil then return nil end
        return {read = function() return files[path] end, close = function() return true end}
    end
    assert(mode == 'wb')
    return {write = function(self, v) files[path] = v; return self end, close = function() return true end}
end
os.remove = function(path) files[path] = nil; return true end
os.rename = function(a, b)
    if renameFails or not files[a] or files[b] then return nil end
    files[b], files[a] = files[a], nil; return true
end

if TEST_REQUIRE_ERROR then
    package.preload['mimgui'] = function() error('test: missing cimguidx9 DLL') end
    local success, failure = pcall(dofile, 'zews.lua')
    assert(not success and tostring(failure):find('missing cimguidx9 DLL', 1, true))
    assert(#frames == 0 and writeCount == 0)
    print('PASS: dependency-load error retains original diagnostic')
    return
end
dofile('zews.lua')
assert(scriptVersion == '1.0.1')
assert(dpiCalls == (TEST_LEGACY_MIMGUI and 0 or 1))
assert(#frames == 2 and frames[1].LockPlayer == true and frames[2].HideCursor == true)
local co = coroutine.create(main)
local function tick()
    local ok, err = coroutine.resume(co); assert(ok, err)
end
local function render()
    for _, frame in ipairs(frames) do if frame.condition() then frame.draw() end end
end
local function press(label) click = label; render(); assert(click == nil, 'button not drawn: ' .. label); tick() end
local function page(label) selectPage = label; render(); assert(selectPage == nil); tick() end
local function toggle(label) checkbox = label; render(); assert(checkbox == nil, 'checkbox not drawn: ' .. label); tick() end
local function eq(a,b) assert(a==b, tostring(a)..' ~= '..tostring(b)) end

tick(); eq(writeCount, 0); assert(commands.zews)
for _, f in ipairs(initializers) do f() end
assert(fontLoads == ((TEST_FONT_PRESENT and not TEST_FONT_ERROR) and 1 or 0))
assert((ioState.FontDefault ~= nil) == (fontLoads > 0))
if signature == 0x53EC8B55 or signature == 0x16197BE9 then
    assert(lastChatMessage:find('1.0.1', 1, true))
end
commands.zews(); assert(frames[1].condition()); render(); tick()
eq(writeCount, 0) -- opening the menu has no game-side effect
-- Exercise every tab and its real FFI controls.
for _, label in ipairs({'02   HUD', '03   Графика', '04   Время / погода', '05   Таймцикл', '06   Профили', '01   Обзор'}) do page(label) end
press('01 / CLEAN DAY')
if signature ~= 0x53EC8B55 and signature ~= 0x16197BE9 then
    eq(writeCount, 0); eq(timeCalls, 0); eq(weatherCalls, 0)
    onScriptTerminate('this', false); eq(writeCount, 0)
    print('PASS: unknown executable fails closed across all tabs, presets and unload')
    return
end
assert(writeCount > 0); eq(hour,12); eq(minute,0); eq(memoryData[0xC81318],1)
eq(read(0xB7B1D0,2),1000); eq(read(0xB7B1D0 + 183*2,2),1000)
eq(read(0xB7BF78,1),51)
-- Manual save + rotation; slots save deep copies and restore settings.
press('Сохранить'); assert(files['MOONLOADER\\config\\zews.json'])
page('06   Профили'); press('Сохранить в слот'); press('Да, сохранить')
assert(files['MOONLOADER\\config\\zews.json.bak']); eq(lastSaved.profiles['1'].world.hour,12)
page('04   Время / погода')
changeSlider = {label='Часы',value=18}; render(); tick(); eq(hour,18)
page('06   Профили'); press('Загрузить'); eq(hour,12)
-- HUD visibility, overlay render, save and shutdown restoration.
page('02   HUD'); toggle('Свой HUD'); toggle('Скрывать стандартный HUD GTA'); toggle('Скрывать радар')
render(); eq(memoryData[0xBAA45D],0); eq(memoryData[0xBAA3FB],1)
press('Переместить HUD мышью'); render(); press('Завершить перемещение')
press('Сохранить'); eq(lastSaved.settings.hud.custom,true)
-- A failed rename leaves old config intact, and a retry succeeds.
renameFails = true; toggle('Здоровье'); press('Сохранить')
assert(files['MOONLOADER\\config\\zews.json']); renameFails = false; press('Сохранить')
-- Master switch restores changed data, but preserves a later external write.
page('01   Обзор'); memoryData[0xB7BF78] = 199
toggle('ZEWS включён'); eq(memoryData[0xB7BF78],199); eq(read(0xB7BF78+1,1),42)
eq(read(0xB7B1D0,2),42); eq(hour,8); eq(minute,35); eq(memoryData[0xC81318],65535)
eq(memoryData[0xBAA45D],1); eq(memoryData[0xBAA3FB],0)
-- Reloading an active config and damaged JSON fallback.
toggle('ZEWS включён'); press('Сохранить')
commands.zews(); assert(not frames[1].condition()); commands.zews()
local before = writeCount
onScriptTerminate('other',false); eq(writeCount,before)
onScriptTerminate('this',false); eq(read(0xB7B1D0,2),42); eq(memoryData[0xBAA45D],1)
-- Fresh script instance reads the saved JSON, then falls back to .bak if corrupt.
local function reload()
    frames, initializers = {}, {}
    dofile('zews.lua'); co = coroutine.create(main); tick(); tick()
end
reload(); eq(read(0xB7B1D0,2),1000); onScriptTerminate('this',false)
files['MOONLOADER\\config\\zews.json'] = 'CORRUPT'
-- Last backup has disabled master (from prior successful rotation).
reload(); commands.zews(); render(); onScriptTerminate('this',false)
print('PASS: command, tabs, FFI controls, live arrays, time/weather, profiles, HUD, save/backup/reload, master switch, unload')
