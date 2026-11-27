local C = dofile('zews.lua')
local function eq(a, b) assert(a == b, tostring(a) .. ' ~= ' .. tostring(b)) end

-- Defaults must not mutate the game on a first install.
local d = C.defaults()
eq(d.hud.custom, false); eq(d.hud.hideNative, false); eq(d.world.lockTime, false)
for _, v in pairs(d.cycle) do eq(v.enabled, false) end
for _, v in pairs(d.graphics) do eq(v.enabled, false) end
local d2 = C.defaults(); d.hud.healthColor[1] = 0
eq(d2.hud.healthColor[1], 0.35)

-- Unknown / hostile JSON types and non-finite numbers never reach FFI or memory.
for _, input in ipairs({false, 1, 'bad', {}, {hud = false, world = 5, cycle = true, graphics = 'x'}}) do
    local s = C.sanitize(input); eq(s.world.hour, 12); eq(s.hud.scale, 1)
end
local s = C.sanitize({enabled = 0, autosave = 'false', hud = {x = 12, y = -2, scale = 0/0, opacity = math.huge, healthColor = {2, -3, 'x', 0.3}},
    world = {hour = 99, minute = -9, weather = 100, lockTime = 'true'},
    graphics = {farClip = {enabled = true, value = 300}, fogStart = {enabled = true, value = 1800}},
    cycle = {water = {enabled = true, color = {1.5, -1, 0.7, 0.5}}}})
eq(s.enabled, true); eq(s.autosave, true); eq(s.hud.x, 1); eq(s.hud.y, 0)
eq(s.hud.scale, 1); eq(s.hud.opacity, 0.88); eq(s.hud.healthColor[1], 1)
eq(s.hud.healthColor[2], 0); eq(s.world.hour, 23); eq(s.world.minute, 0)
eq(s.world.weather, 22); eq(s.world.lockTime, false); eq(s.graphics.fogStart.value, 290)
eq(s.cycle.water.color[1], 1); eq(s.cycle.water.color[2], 0); eq(s.cycle.water.color[4], 0.5)
local noFogClamp = C.sanitize({graphics = {farClip = {enabled = false, value = 200}, fogStart = {enabled = true, value = 1900}}})
eq(noFogClamp.graphics.fogStart.value, 1900)

-- Validate and round every scalar, independent of UI paths.
for _, spec in ipairs(C.scalars) do
    local a = C.sanitize({graphics = {[spec.key] = {enabled = true, value = 1e9}}})
    eq(a.graphics[spec.key].value, spec.max)
    local b = C.sanitize({graphics = {[spec.key] = {enabled = true, value = -1e9}}})
    eq(b.graphics[spec.key].value, spec.min)
end

-- Presets preserve HUD layout but cannot inherit stale cycle overrides.
local custom = C.defaults(); custom.hud.x = 0.15; custom.cycle.water.enabled = true
for _, name in ipairs({'clean', 'sunset', 'night', 'soft'}) do
    local p = C.presets(name, custom)
    eq(p.hud.x, 0.15); eq(p.world.lockTime, true); eq(p.world.lockWeather, true)
    eq(p.cycle.water.enabled, false)
    assert(p.graphics.fogStart.value < p.graphics.farClip.value)
end
eq(custom.cycle.water.enabled, true)
local profile = C.copy(custom); profile.hud.healthColor[1] = 0; eq(custom.hud.healthColor[1], 0.35)

-- Snapshot only touched memory; changes apply once; external changes survive restore.
local mem, writes = {}, 0
for i = 100, 110 do mem[i] = i end
local p = C.newPatcher(function(a, size) return mem[a] end, function(a, size, v) mem[a] = v; writes = writes + 1 end)
p:set('a', 100, 1, {1, 2, 3}); eq(writes, 3); eq(mem[100], 1)
p:set('a', 100, 1, {1, 2, 3}); eq(writes, 3)
p:set('a', 100, 1, {3, 2, 1}); eq(writes, 5)
mem[101] = 999 -- another mod owns this slot now
p:restore('a'); eq(mem[100], 100); eq(mem[101], 999); eq(mem[102], 102)
p:restore('a'); eq(writes, 7)
p:set('shorts', 104, 2, {300, 400, 500}); eq(mem[104], 300); eq(mem[106], 400); eq(mem[108], 500)
p:restoreAll(); eq(mem[104], 104); eq(mem[106], 106); eq(mem[108], 108)
p:set('fresh', 101, 1, {12}); p:restoreAll(); eq(mem[101], 999)

-- Check address ranges for accidental overlap and unsafe spans.
local occupied = {}
for _, group in ipairs(C.groups) do
    for _, addr in ipairs(group.addresses) do
        for a = addr, addr + 183 do assert(not occupied[a], 'array overlap'); occupied[a] = true end
    end
end
for _, spec in ipairs(C.scalars) do
    for a = spec.address, spec.address + 184 * spec.size - 1 do assert(not occupied[a], 'scalar overlap'); occupied[a] = true end
end
print('PASS: defaults, validation, presets, deep copy, memory ownership, array layout')
