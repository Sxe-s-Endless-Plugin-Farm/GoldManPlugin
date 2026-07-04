const PLUGIN_ID = "goldman-revive";
const HANDLE_KEY = "__EF_GOLDMAN_REVIVE_HANDLE__";

const DEFAULTS = Object.freeze({
    position: null,
    collapsed: false
});

const GOLDMAN_HOOK_KEYS = Object.freeze([
    "className",
    "sheetName",
    "lives",
    "onGoldDropMulti",
    "goldMan",
    "goldman",
    "goldUnit",
    "goldSprite",
    "goldEffect",
    "goldManVO",
    "goldmanVO",
    "isGoldMan",
    "isGoldman",
    "onGoldManClick",
    "onGoldmanClick",
    "onGoldManTouch",
    "onGoldmanTouch"
]);

const REVIVE_HOOK_KEYS = Object.freeze([
    "btnRevive",
    "reviveButton",
    "buttonRevive",
    "lastReviveTime",
    "onRevive",
    "onReviveClick",
    "onReviveButtonClick"
]);

const GOLD_TEXT_PATTERN = /gold\s*goblin|goldgoblin|gold\s*man|goldman|golden|bonus\s*gold|gold\s*reward|shower\s*of\s*gold/i;
const REVIVE_TEXT_PATTERN = /revive|reive/i;
const CLICK_METHOD_PATTERN = /click|tap|press|touch|pointer|mouse/i;
const REVIVE_METHOD_PATTERN = /revive|reive/i;
const GOLDMAN_TARGET_KEYS = Object.freeze([
    "goldMan",
    "goldman",
    "goldUnit",
    "goldSprite",
    "goldEffect",
    "goldManVO",
    "goldmanVO",
    "sprite",
    "icon"
]);

function readJson(runtime, key, fallback) {
    const stored = runtime?.storage?.get?.(PLUGIN_ID, key, fallback);
    if (typeof stored !== "string") {
        return stored ?? fallback;
    }
    try {
        return JSON.parse(stored);
    } catch {
        return fallback;
    }
}

function readBoolean(runtime, key, fallback) {
    const stored = runtime?.storage?.get?.(PLUGIN_ID, key, fallback);
    if (stored === "false") {
        return false;
    }
    if (stored === "true") {
        return true;
    }
    return typeof stored === "boolean" ? stored : fallback;
}

function writeValue(runtime, key, value) {
    runtime?.storage?.set?.(PLUGIN_ID, key, typeof value === "object" ? JSON.stringify(value) : value);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getPrototypeMethodNames(candidate) {
    const names = new Set();
    let current = candidate;
    let depth = 0;
    while (current && current !== Object.prototype && depth < 4) {
        for (const name of Object.getOwnPropertyNames(current)) {
            names.add(name);
        }
        current = Object.getPrototypeOf(current);
        depth += 1;
    }
    return Array.from(names);
}

function getTextValue(candidate, depth = 0, seen = new Set()) {
    if (!candidate || depth > 2 || seen.has(candidate)) {
        return "";
    }
    if (typeof candidate === "string" || typeof candidate === "number") {
        return String(candidate);
    }
    if (typeof candidate !== "object") {
        return "";
    }
    seen.add(candidate);
    const parts = [];
    for (const key of ["name", "id", "label", "text", "_text", "title", "tooltip", "displayName", "skinName"]) {
        const value = candidate[key];
        if (typeof value === "string" || typeof value === "number") {
            parts.push(String(value));
        }
    }
    for (const key of ["label", "lbl", "lblTitle", "lblName", "txt", "button", "btn", "sprite", "icon"]) {
        const value = candidate[key];
        if (value && typeof value === "object") {
            parts.push(getTextValue(value, depth + 1, seen));
        }
    }
    return parts.filter(Boolean).join(" ");
}

function hasGoldmanShape(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return false;
    }
    if (candidate.className === "GoldGoblin" || candidate.sheetName === "GoldGoblin") {
        return true;
    }
    if (GOLD_TEXT_PATTERN.test(getTextValue(candidate))) {
        return true;
    }
    for (const key of Object.keys(candidate).slice(0, 80)) {
        if (GOLD_TEXT_PATTERN.test(key)) {
            return true;
        }
    }
    const constructorName = String(candidate.constructor?.name || "");
    return GOLD_TEXT_PATTERN.test(constructorName);
}

function isGoldGoblinUnit(candidate) {
    return candidate
        && typeof candidate === "object"
        && (candidate.className === "GoldGoblin" || candidate.sheetName === "GoldGoblin")
        && typeof candidate.onClicked === "function";
}

function isGoldGoblinAvailable(candidate) {
    if (!isGoldGoblinUnit(candidate)) {
        return false;
    }
    if (candidate.isAlive === false || candidate.state === "DIE" || candidate.eventMode === "none") {
        return false;
    }
    if (Number.isFinite(Number(candidate.lives)) && Number(candidate.lives) <= 0) {
        return false;
    }
    if (Number.isFinite(Number(candidate.lifetime)) && Number(candidate.lifetime) <= 0) {
        return false;
    }
    return true;
}

function clickGoldGoblinDirect(candidate) {
    if (!isGoldGoblinAvailable(candidate)) {
        return false;
    }
    const presses = Number.isFinite(Number(candidate.lives))
        ? Math.max(1, Math.min(12, Math.ceil(Number(candidate.lives))))
        : 10;
    let clicked = false;
    for (let index = 0; index < presses; index += 1) {
        if (!isGoldGoblinAvailable(candidate)) {
            break;
        }
        try {
            candidate.onClicked({
                currentTarget: candidate,
                target: candidate,
                type: "pointerdown",
                synthetic: true
            });
            clicked = true;
        } catch {
            break;
        }
    }
    return clicked;
}

function hasReviveShape(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return false;
    }
    if (REVIVE_TEXT_PATTERN.test(getTextValue(candidate))) {
        return true;
    }
    for (const key of Object.keys(candidate).slice(0, 80)) {
        if (REVIVE_TEXT_PATTERN.test(key)) {
            return true;
        }
    }
    return getPrototypeMethodNames(candidate).some(name => REVIVE_METHOD_PATTERN.test(name));
}

function isObjectActive(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return false;
    }
    if (candidate.destroyed === true || candidate._destroyed === true || candidate.isDestroyed === true) {
        return false;
    }
    if (candidate.visible === false || candidate._visible === false || candidate.renderable === false || candidate.worldVisible === false) {
        return false;
    }
    if (candidate.enabled === false || candidate._enabled === false || candidate.disabled === true) {
        return false;
    }
    if (Number(candidate.alpha) === 0 || Number(candidate.scale?.x) === 0 || Number(candidate.scale?.y) === 0) {
        return false;
    }
    let parent = candidate.parent;
    let depth = 0;
    while (parent && depth < 8) {
        if (parent.visible === false || parent._visible === false || parent.renderable === false || Number(parent.alpha) === 0) {
            return false;
        }
        parent = parent.parent;
        depth += 1;
    }
    return true;
}

function findCanvas() {
    return document.querySelector("canvas");
}

function getObjectBounds(candidate) {
    try {
        if (typeof candidate.getBounds === "function") {
            const bounds = candidate.getBounds();
            if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) && Number(bounds.width) > 0 && Number(bounds.height) > 0) {
                return {
                    x: Number(bounds.x),
                    y: Number(bounds.y),
                    width: Number(bounds.width),
                    height: Number(bounds.height)
                };
            }
        }
    } catch {
        // Bounds are best-effort for minified renderers.
    }

    const x = Number(candidate.worldX ?? candidate.globalX ?? candidate.worldTransform?.tx ?? candidate.transform?.worldTransform?.tx ?? candidate._x ?? candidate.x);
    const y = Number(candidate.worldY ?? candidate.globalY ?? candidate.worldTransform?.ty ?? candidate.transform?.worldTransform?.ty ?? candidate._y ?? candidate.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
        const width = Number(candidate.width ?? candidate.hitArea?.width) || 1;
        const height = Number(candidate.height ?? candidate.hitArea?.height) || 1;
        return { x, y, width, height };
    }
    return null;
}

function getObjectCenter(candidate) {
    const bounds = getObjectBounds(candidate);
    if (bounds) {
        return {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2
        };
    }
    try {
        if (typeof candidate?.toGlobal === "function") {
            const point = candidate.toGlobal({ x: 0, y: 0 });
            if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
                const width = Number(candidate.width ?? candidate.hitArea?.width) || 1;
                const height = Number(candidate.height ?? candidate.hitArea?.height) || 1;
                return { x: Number(point.x) + width / 2, y: Number(point.y) + height / 2 };
            }
        }
    } catch {
        // Global conversion is optional.
    }
    return null;
}

function getCanvasClientPoints(point) {
    const canvas = findCanvas();
    if (!canvas || !point) {
        return [];
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 && canvas.width > 0 ? rect.width / canvas.width : 1;
    const scaleY = rect.height > 0 && canvas.height > 0 ? rect.height / canvas.height : 1;
    const candidates = [
        { x: rect.left + point.x * scaleX, y: rect.top + point.y * scaleY },
        { x: rect.left + point.x, y: rect.top + point.y },
        { x: point.x, y: point.y }
    ];
    return candidates
        .filter(candidate => (
            Number.isFinite(candidate.x)
            && Number.isFinite(candidate.y)
            && candidate.x >= rect.left
            && candidate.x <= rect.right
            && candidate.y >= rect.top
            && candidate.y <= rect.bottom
        ))
        .map(candidate => ({
            x: clamp(candidate.x, rect.left, rect.right - 1),
            y: clamp(candidate.y, rect.top, rect.bottom - 1)
        }));
}

function hasCanvasPoint(candidate) {
    return getCanvasClientPoints(getObjectCenter(candidate)).length > 0;
}

function hasVisibleCanvasArea(candidate) {
    const bounds = getObjectBounds(candidate);
    if (!bounds || bounds.width < 4 || bounds.height < 4) {
        return false;
    }
    return getCanvasClientPoints({
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2
    }).length > 0;
}

function dispatchCanvasClickAt(point) {
    const canvas = findCanvas();
    const points = getCanvasClientPoints(point);
    if (!canvas || points.length === 0) {
        return false;
    }
    let dispatched = false;
    for (const pointCandidate of points) {
        dispatchCanvasPointerSequence(canvas, pointCandidate.x, pointCandidate.y);
        dispatched = true;
    }
    return dispatched;
}

function dispatchCanvasPointerSequence(canvas, x, y) {
    const target = document.elementFromPoint(x, y) || canvas;
    const eventInit = {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        buttons: 1
    };
    for (const type of ["pointerover", "pointerenter", "pointermove", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        const EventCtor = type.startsWith("pointer") && window.PointerEvent ? window.PointerEvent : window.MouseEvent;
        target.dispatchEvent(new EventCtor(type, eventInit));
        if (target !== canvas) {
            canvas.dispatchEvent(new EventCtor(type, eventInit));
        }
    }
    if (typeof window.Touch === "function" && typeof window.TouchEvent === "function") {
        try {
            const touch = new window.Touch({
                identifier: Date.now(),
                target,
                clientX: x,
                clientY: y,
                screenX: x,
                screenY: y,
                pageX: x + window.scrollX,
                pageY: y + window.scrollY,
                radiusX: 8,
                radiusY: 8,
                force: 0.8
            });
            target.dispatchEvent(new window.TouchEvent("touchstart", {
                bubbles: true,
                cancelable: true,
                touches: [touch],
                targetTouches: [touch],
                changedTouches: [touch]
            }));
            target.dispatchEvent(new window.TouchEvent("touchend", {
                bubbles: true,
                cancelable: true,
                touches: [],
                targetTouches: [],
                changedTouches: [touch]
            }));
        } catch {
            // Touch constructors are not available in every browser/runtime.
        }
    }
}

function dispatchCanvasClickAtClientPoint(point) {
    const canvas = findCanvas();
    if (!canvas || !point) {
        return false;
    }
    const rect = canvas.getBoundingClientRect();
    if (
        !Number.isFinite(point.x)
        || !Number.isFinite(point.y)
        || point.x < rect.left
        || point.x > rect.right
        || point.y < rect.top
        || point.y > rect.bottom
    ) {
        return false;
    }
    dispatchCanvasPointerSequence(canvas, point.x, point.y);
    return true;
}

function getCanvasClientPointFromLocal(canvasX, canvasY) {
    const canvas = findCanvas();
    if (!canvas || !Number.isFinite(canvasX) || !Number.isFinite(canvasY)) {
        return null;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width > 0 ? rect.width / canvas.width : 1;
    const scaleY = canvas.height > 0 ? rect.height / canvas.height : 1;
    return {
        x: rect.left + canvasX * scaleX,
        y: rect.top + canvasY * scaleY,
        canvasX,
        canvasY
    };
}

function dispatchCanvasClickAtLocalPoint(canvasX, canvasY) {
    const point = getCanvasClientPointFromLocal(canvasX, canvasY);
    return dispatchCanvasClickAtClientPoint(point);
}

function toCanvasLocalPoint(clientX, clientY) {
    const canvas = findCanvas();
    if (!canvas) {
        return {
            clientX,
            clientY,
            canvasX: clientX,
            canvasY: clientY,
            hasCanvas: false
        };
    }
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return null;
    }
    const scaleX = rect.width > 0 && canvas.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 && canvas.height > 0 ? canvas.height / rect.height : 1;
    return {
        clientX,
        clientY,
        canvasX: (clientX - rect.left) * scaleX,
        canvasY: (clientY - rect.top) * scaleY,
        hasCanvas: true
    };
}

function isGoldPixel(data, index) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    return alpha > 180
        && red > 175
        && green > 110
        && green < 230
        && blue < 100
        && red >= green * 0.9
        && green > blue * 1.55;
}

function isGoldmanOrangePixel(data, index) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    return alpha > 160
        && red > 135
        && green > 65
        && green < 150
        && blue < 85
        && red > green * 1.15;
}

function isGoldmanCreamPixel(data, index) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    return alpha > 160
        && red > 185
        && green > 145
        && green < 220
        && blue > 75
        && blue < 150
        && red > blue * 1.35;
}

function isLikelyBattlefieldPixel(data, index) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    return alpha > 160
        && green >= red * 0.85
        && green >= blue * 0.9
        && red >= 35
        && red <= 115
        && green >= 45
        && green <= 125
        && blue >= 25
        && blue <= 95;
}

function findGoldmanCandidatesByPixels(limit = 6) {
    const canvas = findCanvas();
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
        return [];
    }

    let imageData;
    try {
        imageData = canvas.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
        return [];
    }
    if (!imageData?.data) {
        return [];
    }

    const { data, width, height } = imageData;
    const step = Math.max(2, Math.floor(Math.min(width, height) / 360));
    const visited = new Uint8Array(Math.ceil(width / step) * Math.ceil(height / step));
    const gridWidth = Math.ceil(width / step);
    const candidates = [];
    const startY = Math.floor(height * 0.12);
    const endY = Math.floor(height * 0.58);
    const startX = Math.floor(width * 0.03);
    const endX = Math.floor(width * 0.76);

    function gridIndex(x, y) {
        return Math.floor(y / step) * gridWidth + Math.floor(x / step);
    }

    function pixelIndex(x, y) {
        return (y * width + x) * 4;
    }

    for (let y = startY; y < endY; y += step) {
        for (let x = startX; x < endX; x += step) {
            const startGridIndex = gridIndex(x, y);
            if (visited[startGridIndex] || !isGoldPixel(data, pixelIndex(x, y))) {
                continue;
            }

            const stack = [[x, y]];
            visited[startGridIndex] = 1;
            let count = 0;
            let minX = x;
            let maxX = x;
            let minY = y;
            let maxY = y;
            let orangeCount = 0;
            let creamCount = 0;
            let fieldAround = 0;

            while (stack.length) {
                const [currentX, currentY] = stack.pop();
                count += 1;
                minX = Math.min(minX, currentX);
                maxX = Math.max(maxX, currentX);
                minY = Math.min(minY, currentY);
                maxY = Math.max(maxY, currentY);

                for (let accentY = currentY - step * 5; accentY <= currentY + step * 5; accentY += step) {
                    if (accentY < 0 || accentY >= height) {
                        continue;
                    }
                    for (let accentX = currentX - step * 5; accentX <= currentX + step * 5; accentX += step) {
                        if (accentX < 0 || accentX >= width) {
                            continue;
                        }
                        const index = pixelIndex(accentX, accentY);
                        if (isGoldmanOrangePixel(data, index)) {
                            orangeCount += 1;
                        }
                        if (isGoldmanCreamPixel(data, index)) {
                            creamCount += 1;
                        }
                    }
                }

                for (let fieldY = currentY - step * 10; fieldY <= currentY + step * 10; fieldY += step * 4) {
                    if (fieldY < 0 || fieldY >= height) {
                        continue;
                    }
                    for (let fieldX = currentX - step * 10; fieldX <= currentX + step * 10; fieldX += step * 4) {
                        if (fieldX >= 0 && fieldX < width && isLikelyBattlefieldPixel(data, pixelIndex(fieldX, fieldY))) {
                            fieldAround += 1;
                        }
                    }
                }

                for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
                    const nextX = currentX + dx;
                    const nextY = currentY + dy;
                    if (nextX < startX || nextX >= endX || nextY < startY || nextY >= endY) {
                        continue;
                    }
                    const nextGridIndex = gridIndex(nextX, nextY);
                    if (visited[nextGridIndex]) {
                        continue;
                    }
                    visited[nextGridIndex] = 1;
                    if (isGoldPixel(data, pixelIndex(nextX, nextY))) {
                        stack.push([nextX, nextY]);
                    }
                }
            }

            const boxWidth = maxX - minX + step;
            const boxHeight = maxY - minY + step;
            const area = boxWidth * boxHeight;
            if (
                count >= 10
                && count <= 260
                && boxWidth >= 14
                && boxWidth <= Math.max(48, width * 0.08)
                && boxHeight >= 12
                && boxHeight <= Math.max(44, height * 0.07)
                && boxWidth / boxHeight >= 0.65
                && boxWidth / boxHeight <= 2.6
                && area <= width * height * 0.025
                && orangeCount >= 2
                && creamCount >= 1
                && fieldAround >= 3
            ) {
                const centerX = (minX + maxX) / 2;
                const centerY = (minY + maxY) / 2 + boxHeight * 0.18;
                const score = count * 2
                    + Math.min(orangeCount, 28) * 3
                    + Math.min(creamCount, 16) * 4
                    + Math.min(fieldAround, 20)
                    - Math.abs(boxWidth - boxHeight) * 0.45;
                candidates.push({ x: centerX, y: centerY, width: boxWidth, height: boxHeight, count, orangeCount, creamCount, fieldAround, score });
            }
        }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, limit);
}

function findGoldmanByPixels() {
    return findGoldmanCandidatesByPixels(1)[0] || null;
}


function getClientPointFromEvent(event) {
    const touch = event?.changedTouches?.[0] || event?.touches?.[0];
    const clientX = touch ? touch.clientX : event?.clientX;
    const clientY = touch ? touch.clientY : event?.clientY;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
        return null;
    }
    return { clientX, clientY };
}

function tryEmit(candidate) {
    if (typeof candidate?.emit !== "function") {
        return false;
    }
    let emitted = false;
    for (const eventName of ["pointertap", "tap", "click", "pointerdown", "pointerup"]) {
        try {
            candidate.emit(eventName, { currentTarget: candidate, target: candidate });
            emitted = true;
        } catch {
            // Keep trying renderer event names.
        }
    }
    return emitted;
}

function callMatchingMethods(candidate, pattern, args = []) {
    if (!candidate || typeof candidate !== "object") {
        return false;
    }
    let called = false;
    for (const name of getPrototypeMethodNames(candidate)) {
        if (name === "constructor" || !pattern.test(name) || typeof candidate[name] !== "function") {
            continue;
        }
        try {
            candidate[name](...args);
            called = true;
        } catch {
            // Some click handlers need renderer args; skip and keep looking.
        }
        if (called) {
            return true;
        }
    }
    return false;
}

function clickGameObject(candidate) {
    if (!candidate || !isObjectActive(candidate)) {
        return false;
    }
    if (dispatchCanvasClickAt(getObjectCenter(candidate))) {
        return true;
    }
    if (tryEmit(candidate)) {
        return true;
    }
    return callMatchingMethods(candidate, CLICK_METHOD_PATTERN, [{ currentTarget: candidate, target: candidate }]);
}

function getNestedObject(candidate, key, seen = new Set()) {
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) {
        return null;
    }
    seen.add(candidate);
    const value = candidate[key];
    if (value && typeof value === "object") {
        return value;
    }
    for (const childKey of ["view", "container", "sprite", "icon", "button", "btn"]) {
        const child = candidate[childKey];
        if (child && typeof child === "object") {
            const nested = getNestedObject(child, key, seen);
            if (nested) {
                return nested;
            }
        }
    }
    return null;
}

function getGoldmanTargets(candidate) {
    const targets = [];
    if (candidate && typeof candidate === "object") {
        targets.push(candidate);
        for (const key of GOLDMAN_TARGET_KEYS) {
            const nested = getNestedObject(candidate, key);
            if (nested && !targets.includes(nested)) {
                targets.push(nested);
            }
        }
    }
    return targets;
}

function isGoldmanOnScreen(candidate) {
    return getGoldmanTargets(candidate).some(target => isObjectActive(target) && hasVisibleCanvasArea(target));
}

function getGoldmanClickTarget(candidate) {
    return getGoldmanTargets(candidate).find(target => isObjectActive(target) && hasVisibleCanvasArea(target)) || null;
}

function clickGoldman(candidate) {
    if (isGoldGoblinUnit(candidate)) {
        return clickGoldGoblinDirect(candidate);
    }
    const target = getGoldmanClickTarget(candidate);
    return target ? clickGameObject(target) : false;
}

function findDomButton(pattern) {
    const selector = "button, [role='button'], input[type='button'], input[type='submit'], a";
    for (const element of Array.from(document.querySelectorAll(selector))) {
        if (element.closest("[data-ef-plugin-overlay]")) {
            continue;
        }
        const text = [
            element.textContent,
            element.value,
            element.getAttribute("aria-label"),
            element.getAttribute("title")
        ].filter(Boolean).join(" ");
        const disabled = element.disabled === true || element.getAttribute("aria-disabled") === "true";
        const rect = element.getBoundingClientRect();
        if (!disabled && pattern.test(text) && rect.width > 0 && rect.height > 0) {
            return element;
        }
    }
    return null;
}

function clickRevive(reviveCandidates, confirmedReviveCandidates = null) {
    for (const candidate of Array.from(reviveCandidates)) {
        if (!(confirmedReviveCandidates?.has?.(candidate) || hasReviveShape(candidate)) || !isObjectActive(candidate)) {
            continue;
        }
        for (const button of [candidate.btnRevive, candidate.reviveButton, candidate.buttonRevive]) {
            if (clickGameObject(button)) {
                return true;
            }
        }
        if (callMatchingMethods(candidate, REVIVE_METHOD_PATTERN) || clickGameObject(candidate)) {
            return true;
        }
    }

    const reviveButton = findDomButton(REVIVE_TEXT_PATTERN);
    if (reviveButton) {
        reviveButton.click();
        return true;
    }
    return false;
}

function createOverlay() {
    const root = document.createElement("section");
    root.dataset.efPluginOverlay = PLUGIN_ID;
    root.style.cssText = [
        "position:fixed",
        "right:16px",
        "bottom:74px",
        "z-index:2147483647",
        "min-width:230px",
        "padding:6px 10px 10px",
        "border:1px solid #8f793a",
        "border-radius:7px",
        "background:#0b0b0b",
        "color:#f7e7a0",
        "font:12px/1.35 monospace",
        "box-shadow:0 2px 8px rgba(0,0,0,.45)",
        "user-select:none"
    ].join(";");

    root.innerHTML = `
        <div data-ef-goldman-drag style="display:flex;align-items:center;gap:8px;font-weight:700;border-bottom:1px solid #8f793a;padding-bottom:5px;margin-bottom:7px;cursor:move;">
            <button data-ef-goldman-toggle type="button" title="Minimize Goldman Revive" style="width:22px;height:22px;line-height:18px;background:#2d2815;color:#f7e7a0;border:1px solid #8f793a;border-radius:3px;font:700 14px monospace;cursor:pointer;">-</button>
            <span data-ef-goldman-title style="flex:1;text-align:center;">GoldMan Hiding</span>
        </div>
        <div data-ef-goldman-body>
            <button data-ef-goldman-hidden type="button" disabled style="width:100%;height:24px;margin-bottom:7px;background:#2d2815;color:#f7b267;border:1px solid #8f793a;border-radius:3px;font:700 11px monospace;cursor:not-allowed;">Goldman Is Currently Hiding</button>
            <div data-ef-goldman-actions style="display:grid;grid-template-columns:3fr 2fr;gap:5px;margin-bottom:7px;">
                <button data-ef-goldman-trigger type="button" disabled style="min-width:0;height:24px;background:#1f8edb;color:#ffffff;border:1px solid #8ad8ff;border-radius:3px;font:700 11px monospace;cursor:not-allowed;">Revive with Goldman</button>
                <button data-ef-goldman-test type="button" disabled style="min-width:0;height:24px;background:#2d2815;color:#f7e7a0;border:1px solid #8f793a;border-radius:3px;font:700 11px monospace;cursor:not-allowed;">Rob Goldman</button>
            </div>
        </div>
    `;

    return {
        root,
        dragHandle: root.querySelector("[data-ef-goldman-drag]"),
        toggle: root.querySelector("[data-ef-goldman-toggle]"),
        title: root.querySelector("[data-ef-goldman-title]"),
        body: root.querySelector("[data-ef-goldman-body]"),
        hidden: root.querySelector("[data-ef-goldman-hidden]"),
        actions: root.querySelector("[data-ef-goldman-actions]"),
        trigger: root.querySelector("[data-ef-goldman-trigger]"),
        test: root.querySelector("[data-ef-goldman-test]")
    };
}

function installDrag(runtime, overlay, cleanups) {
    const saved = readJson(runtime, "position", DEFAULTS.position);
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        overlay.root.style.left = `${saved.left}px`;
        overlay.root.style.top = `${saved.top}px`;
        overlay.root.style.right = "auto";
        overlay.root.style.bottom = "auto";
    }

    let drag = null;
    function onPointerMove(event) {
        if (!drag) {
            return;
        }
        const left = clamp(event.clientX - drag.offsetX, 0, window.innerWidth - overlay.root.offsetWidth);
        const top = clamp(event.clientY - drag.offsetY, 0, window.innerHeight - overlay.root.offsetHeight);
        overlay.root.style.left = `${left}px`;
        overlay.root.style.top = `${top}px`;
        overlay.root.style.right = "auto";
        overlay.root.style.bottom = "auto";
    }
    function onPointerUp() {
        if (!drag) {
            return;
        }
        drag = null;
        writeValue(runtime, "position", {
            left: parseFloat(overlay.root.style.left) || 0,
            top: parseFloat(overlay.root.style.top) || 0
        });
    }
    function onPointerDown(event) {
        if (event.target === overlay.toggle || event.target === overlay.trigger) {
            return;
        }
        const rect = overlay.root.getBoundingClientRect();
        drag = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
        event.preventDefault();
    }

    overlay.dragHandle.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    cleanups.push(() => overlay.dragHandle.removeEventListener("pointerdown", onPointerDown));
    cleanups.push(() => window.removeEventListener("pointermove", onPointerMove));
    cleanups.push(() => window.removeEventListener("pointerup", onPointerUp));
}

function attachGoldmanRevive(runtime) {
    const cleanups = [];
    const goldmanCandidates = new Set();
    const reviveCandidates = new Set();
    const confirmedGoldmanCandidates = new WeakSet();
    const confirmedReviveCandidates = new WeakSet();
    const overlay = createOverlay();
    let collapsed = readBoolean(runtime, "collapsed", DEFAULTS.collapsed);

    document.body.appendChild(overlay.root);
    installDrag(runtime, overlay, cleanups);

    window.__EF_GOLDMAN_REVIVE_DEBUG__ = {
        goldmanCandidates,
        reviveCandidates,
        getActiveGoldman,
        getGoldmanClickTarget,
        clickGoldman: () => clickGoldman(getActiveGoldman()),
        clickGoldGoblinDirect: () => clickGoldGoblinDirect(getActiveGoldman()),
        getGoldGoblinUnits: () => Array.from(goldmanCandidates).filter(isGoldGoblinUnit)
    };
    cleanups.push(() => {
        if (window.__EF_GOLDMAN_REVIVE_DEBUG__?.goldmanCandidates === goldmanCandidates) {
            delete window.__EF_GOLDMAN_REVIVE_DEBUG__;
        }
    });

    function setCollapsed(nextCollapsed) {
        collapsed = Boolean(nextCollapsed);
        overlay.body.hidden = collapsed;
        overlay.toggle.textContent = collapsed ? "+" : "-";
        overlay.toggle.title = collapsed ? "Maximize Goldman Revive" : "Minimize Goldman Revive";
        overlay.root.style.minWidth = collapsed ? "170px" : "230px";
        overlay.dragHandle.style.borderBottom = collapsed ? "0" : "1px solid #8f793a";
        overlay.dragHandle.style.marginBottom = collapsed ? "0" : "7px";
        writeValue(runtime, "collapsed", collapsed);
    }

    function getActiveGoldman() {
        for (const candidate of Array.from(goldmanCandidates)) {
            if (isGoldGoblinAvailable(candidate)) {
                return candidate;
            }
        }
        for (const candidate of Array.from(goldmanCandidates)) {
            if ((confirmedGoldmanCandidates.has(candidate) || hasGoldmanShape(candidate)) && isGoldmanOnScreen(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    function hasRevive() {
        if (findDomButton(REVIVE_TEXT_PATTERN)) {
            return true;
        }
        return Array.from(reviveCandidates).some(candidate => (
            confirmedReviveCandidates.has(candidate) || hasReviveShape(candidate)
        ) && isObjectActive(candidate));
    }

    function render() {
        const activeGoldman = getActiveGoldman();
        const canClickGoldman = !!activeGoldman;
        overlay.title.textContent = activeGoldman ? "GoldMan Active" : "GoldMan Hiding";
        overlay.hidden.hidden = canClickGoldman;
        overlay.actions.hidden = !canClickGoldman;
        overlay.hidden.style.display = canClickGoldman ? "none" : "block";
        overlay.actions.style.display = canClickGoldman ? "grid" : "none";
        overlay.trigger.disabled = !canClickGoldman;
        overlay.trigger.style.cursor = canClickGoldman ? "pointer" : "not-allowed";
        overlay.trigger.style.background = canClickGoldman ? "#1f8edb" : "#25445a";
        overlay.trigger.style.borderColor = canClickGoldman ? "#8ad8ff" : "#52758c";
        overlay.trigger.style.color = canClickGoldman ? "#ffffff" : "#b8d6e8";
        overlay.test.disabled = !canClickGoldman;
        overlay.test.style.cursor = canClickGoldman ? "pointer" : "not-allowed";
        overlay.test.style.borderColor = canClickGoldman ? "#d19a35" : "#8f793a";
    }

    function rememberGoldman(candidate) {
        if (isGoldGoblinUnit(candidate) || hasGoldmanShape(candidate)) {
            goldmanCandidates.add(candidate);
        }
        for (const key of GOLDMAN_TARGET_KEYS) {
            const unit = getNestedObject(candidate, key);
            if (unit && typeof unit === "object") {
                confirmedGoldmanCandidates.add(unit);
                goldmanCandidates.add(unit);
            }
        }
    }

    function rememberRevive(candidate) {
        if (hasReviveShape(candidate)) {
            reviveCandidates.add(candidate);
        }
        for (const button of [candidate?.btnRevive, candidate?.reviveButton, candidate?.buttonRevive]) {
            if (button && typeof button === "object") {
                confirmedReviveCandidates.add(button);
                reviveCandidates.add(button);
            }
        }
    }

    function runCombo(event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const activeGoldman = getActiveGoldman();
        if (!activeGoldman) {
            render();
            return;
        }

        const clickedGoldman = clickGoldman(activeGoldman);
        const clickedReviveNow = clickRevive(reviveCandidates, confirmedReviveCandidates);
        window.setTimeout(() => {
            if (clickedGoldman && !clickedReviveNow) {
                clickRevive(reviveCandidates, confirmedReviveCandidates);
            }
            render();
        }, 25);
        render();
    }

    function onTestClick(event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        clickGoldGoblinDirect(getActiveGoldman());
        render();
    }

    const onToggleClick = () => setCollapsed(!collapsed);
    const stopOverlayPointer = event => event.stopPropagation();
    overlay.toggle.addEventListener("click", onToggleClick);
    overlay.toggle.addEventListener("pointerdown", stopOverlayPointer);
    overlay.trigger.addEventListener("click", runCombo);
    overlay.trigger.addEventListener("pointerdown", stopOverlayPointer);
    overlay.test.addEventListener("click", onTestClick);
    overlay.test.addEventListener("pointerdown", stopOverlayPointer);
    cleanups.push(() => overlay.toggle.removeEventListener("click", onToggleClick));
    cleanups.push(() => overlay.toggle.removeEventListener("pointerdown", stopOverlayPointer));
    cleanups.push(() => overlay.trigger.removeEventListener("click", runCombo));
    cleanups.push(() => overlay.trigger.removeEventListener("pointerdown", stopOverlayPointer));
    cleanups.push(() => overlay.test.removeEventListener("click", onTestClick));
    cleanups.push(() => overlay.test.removeEventListener("pointerdown", stopOverlayPointer));

    if (runtime?.hooks?.onObjectWithProperties) {
        cleanups.push(runtime.hooks.onObjectWithProperties(GOLDMAN_HOOK_KEYS, rememberGoldman));
        cleanups.push(runtime.hooks.onObjectWithProperties(REVIVE_HOOK_KEYS, rememberRevive));
    }

    const renderTimer = window.setInterval(render, 250);
    cleanups.push(() => window.clearInterval(renderTimer));
    setCollapsed(collapsed);
    render();

    runtime?.logger?.info?.(PLUGIN_ID, "installed");

    return {
        detach() {
            for (const cleanup of cleanups.splice(0)) {
                try {
                    cleanup();
                } catch {
                    // Best-effort detach.
                }
            }
            overlay.root.remove();
            runtime?.logger?.info?.(PLUGIN_ID, "detached");
        }
    };
}

export default {
    id: PLUGIN_ID,
    handleKey: HANDLE_KEY,

    setup(runtime) {
        return attachGoldmanRevive(runtime);
    }
};
