Promise.all([
    fetch("config.json").then(r => r.json()),
    fetch("program.json").then(r => r.json())
]).then(([config, program]) => {

const NS = "http://www.w3.org/2000/svg";
const programKeys = Object.keys(program);
let currentCode = programKeys[0];
let sizeOverride = null;
let currentPosMap = new Map();

function parse(testString) {
    const leadingMods = [];
    const items = [];
    let pendingMods = [];
    for (let i = 0; i < testString.length; i++) {
        const ch = testString[i];
        if (ch === "<" || ch === ">") {
            items.push({ type: "dir", dir: ch, mods: pendingMods, pos: i });
            pendingMods = [];
        } else if (ch === "[" || ch === "]") {
            items.push({ type: ch, pos: i });
            pendingMods = [];
        } else if (ch === "+" || ch === "-") {
            if (items.length > 0) {
                const last = items[items.length - 1];
                if (last.type === "dir") {
                    last.mods.push({ ch, pos: i });
                } else {
                    pendingMods.push({ ch, pos: i });
                }
            } else {
                leadingMods.push({ ch, pos: i });
            }
        }
    }
    if (pendingMods.length > 0) {
        for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].type === "dir") {
                items[i].mods.push(...pendingMods);
                break;
            }
        }
    }
    return { leadingMods, items };
}

function compressMods(mods) {
    const symbols = [];
    let i = 0;
    while (i < mods.length) {
        const ch = mods[i].ch;
        let count = 0;
        while (i < mods.length && mods[i].ch === ch) { count++; i++; }
        const hundreds = Math.floor(count / 100);
        const tens = Math.floor((count % 100) / 10);
        const ones = count % 10;
        for (let j = 0; j < hundreds; j++) symbols.push({ filled: ch === "+", rings: 2 });
        for (let j = 0; j < tens; j++) symbols.push({ filled: ch === "+", rings: 1 });
        for (let j = 0; j < ones; j++) symbols.push({ filled: ch === "+", rings: 0 });
    }
    return symbols;
}

// --- Draw function ---
function draw(cfg) {
    const { BG_COLOR, STROKE_COLOR } = cfg;

    const code = program[currentCode];
    const { leadingMods, items } = parse(code);

    // Auto-compute canvas size based on program complexity
    const numDirItems = items.filter(i => i.type === "dir").length;
    const numOpen = items.filter(i => i.type === "[").length;
    const numClose = items.filter(i => i.type === "]").length;

    const MIN_SECTION_WIDTH = 20;
    const BASE_PADDING = 10;
    const BASE_DUM_RADIUS = cfg.DUM_RADIUS;
    const baseBracketSpace = numOpen * 6 + numClose * 2;
    const autoSize = Math.round(2 * (BASE_PADDING + BASE_DUM_RADIUS + (numDirItems + 1) * MIN_SECTION_WIDTH + baseBracketSpace));
    const size = sizeOverride != null ? sizeOverride : Math.max(500, Math.min(15000, autoSize));

    // Scale all settings proportionally to canvas size
    const scale = size / 10000;
    const PADDING = BASE_PADDING * scale;
    const STROKE_WIDTH_BOUNDARY = cfg.STROKE_WIDTH_BOUNDARY * scale;
    const STROKE_WIDTH_ARC = cfg.STROKE_WIDTH_ARC * scale;
    const STROKE_WIDTH_BRACKET = cfg.STROKE_WIDTH_BRACKET * scale;
    const STROKE_WIDTH_DOT = cfg.STROKE_WIDTH_DOT * scale;
    const BRACKET_GAP = cfg.BRACKET_GAP * scale;
    const dumRadius = BASE_DUM_RADIUS * scale;

    // Update size display (only when auto-computed)
    if (sizeOverride == null) document.getElementById("canvas-size").value = size;

    const svgContainer = document.getElementById("container");
    svgContainer.innerHTML = "";

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("xmlns", NS);
    svgContainer.appendChild(svg);

    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("width", size);
    bg.setAttribute("height", size);
    bg.setAttribute("fill", BG_COLOR);
    svg.appendChild(bg);

    const cx = size / 2;
    const cy = size / 2;
    const outerRadius = size / 2 - PADDING;
    const leftoverSpace = outerRadius - dumRadius;

    const openBracketWidth = BRACKET_GAP + STROKE_WIDTH_BRACKET;
    const closeBracketWidth = STROKE_WIDTH_BRACKET;
    const totalBracketSpace = numOpen * openBracketWidth + numClose * closeBracketWidth;
    const sectionWidth = (leftoverSpace - totalBracketSpace) / (numDirItems + 1);

    // outer circle
    const outerCircle = document.createElementNS(NS, "circle");
    outerCircle.setAttribute("cx", cx);
    outerCircle.setAttribute("cy", cy);
    outerCircle.setAttribute("r", outerRadius);
    outerCircle.setAttribute("fill", "none");
    outerCircle.setAttribute("stroke", STROKE_COLOR);
    outerCircle.setAttribute("stroke-width", STROKE_WIDTH_BOUNDARY);
    svg.appendChild(outerCircle);

    // inner circle
    const innerCircle = document.createElementNS(NS, "circle");
    innerCircle.setAttribute("cx", cx);
    innerCircle.setAttribute("cy", cy);
    innerCircle.setAttribute("r", dumRadius);
    innerCircle.setAttribute("fill", "none");
    innerCircle.setAttribute("stroke", STROKE_COLOR);
    innerCircle.setAttribute("stroke-width", STROKE_WIDTH_BOUNDARY);
    svg.appendChild(innerCircle);

    // dots on outer circle for leading +/-
    const dotsToDraw = [];
    if (leadingMods.length > 0) {
        const symbols = compressMods(leadingMods);
        const n = symbols.length;
        for (let k = 0; k < n; k++) {
            const angle = (2 * Math.PI * (k + 1)) / (n + 1);
            dotsToDraw.push({
                x: cx + outerRadius * Math.cos(angle),
                y: cy + outerRadius * Math.sin(angle),
                filled: symbols[k].filled,
                rings: symbols[k].rings,
                itemIdx: "leading"
            });
        }
    }

    // Per-item paths instead of one monolithic path
    let penX = cx + outerRadius;
    let penY = cy;
    let start = true;
    const bracketCircles = [];
    let rOffset = 0;
    const itemPaths = [];    // { d, idx, type: "arc"|"connector" }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.type === "dir") {
            rOffset += sectionWidth;
            const r = outerRadius - rOffset;
            const clockwise = item.dir === "<";
            const startX = cx + r * (start ? 1 : -1);
            const arcEndX = cx + r * (start ? -1 : 1);
            const sweepFlag = clockwise ? 0 : 1;

            const d = `M ${penX} ${penY} L ${startX} ${cy} A ${r} ${r} 0 0 ${sweepFlag} ${arcEndX} ${cy}`;
            itemPaths.push({ d, idx: i, type: "arc" });

            penX = arcEndX;
            penY = cy;

            if (item.mods.length > 0) {
                const symbols = compressMods(item.mods);
                const startAngle = start ? 0 : Math.PI;
                const endAngle = start ? Math.PI : 2 * Math.PI;
                const n = symbols.length;
                for (let k = 0; k < n; k++) {
                    const t = (k + 1) / (n + 1);
                    let angle;
                    if (!clockwise) {
                        angle = startAngle + (endAngle - startAngle) * t;
                    } else {
                        angle = startAngle - (endAngle - startAngle) * t;
                    }
                    dotsToDraw.push({
                        x: cx + r * Math.cos(angle),
                        y: cy + r * Math.sin(angle),
                        filled: symbols[k].filled,
                        rings: symbols[k].rings,
                        itemIdx: i
                    });
                }
            }

            start = !start;
        } else {
            const isOpen = item.type === "[";
            const bracketWidth = isOpen ? openBracketWidth : closeBracketWidth;
            const side = start ? 1 : -1;

            if (isOpen) {
                const outerR = outerRadius - rOffset;
                const innerR = outerR - BRACKET_GAP;
                // Line to bracket outer edge
                const d = `M ${penX} ${penY} L ${cx + outerR * side} ${cy}`;
                itemPaths.push({ d, idx: i, type: "connector" });
                penX = cx + innerR * side;
                penY = cy;
                bracketCircles.push({ outerR, innerR, double: true, idx: i });
            } else {
                rOffset += bracketWidth;
                const r = outerRadius - rOffset + bracketWidth / 2;
                const d = `M ${penX} ${penY} L ${cx + r * side} ${cy}`;
                itemPaths.push({ d, idx: i, type: "connector" });
                penX = cx + r * side;
                penY = cy;
                bracketCircles.push({ outerR: r, double: false, idx: i });
            }

            if (isOpen) rOffset += bracketWidth;
        }
    }

    // Final line to inner circle
    const endX = cx + dumRadius * (start ? 1 : -1);
    const finalD = `M ${penX} ${penY} L ${endX} ${cy}`;
    itemPaths.push({ d: finalD, idx: -1, type: "connector" });

    // Append visible paths
    for (const ip of itemPaths) {
        const path = document.createElementNS(NS, "path");
        path.setAttribute("d", ip.d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", STROKE_COLOR);
        path.setAttribute("stroke-width", STROKE_WIDTH_ARC);
        if (ip.idx >= 0) path.setAttribute("data-idx", ip.idx);
        svg.appendChild(path);
    }

    // bracket circles
    for (const bc of bracketCircles) {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", cx);
        c.setAttribute("cy", cy);
        c.setAttribute("r", bc.outerR);
        c.setAttribute("fill", "none");
        c.setAttribute("stroke", STROKE_COLOR);
        c.setAttribute("stroke-width", STROKE_WIDTH_BRACKET);
        c.setAttribute("data-idx", bc.idx);
        svg.appendChild(c);

        if (bc.double) {
            const c2 = document.createElementNS(NS, "circle");
            c2.setAttribute("cx", cx);
            c2.setAttribute("cy", cy);
            c2.setAttribute("r", bc.innerR);
            c2.setAttribute("fill", "none");
            c2.setAttribute("stroke", STROKE_COLOR);
            c2.setAttribute("stroke-width", STROKE_WIDTH_BRACKET);
            c2.setAttribute("data-idx", bc.idx);
            svg.appendChild(c2);
        }
    }

    // dots
    const dotRadius = sectionWidth / 4;
    for (const dot of dotsToDraw) {
        const innerR = dot.rings > 0 ? dotRadius * 0.5 : dotRadius;
        const circle = document.createElementNS(NS, "circle");
        circle.setAttribute("cx", dot.x);
        circle.setAttribute("cy", dot.y);
        circle.setAttribute("r", innerR);
        circle.setAttribute("data-idx", dot.itemIdx);
        if (dot.filled) {
            circle.setAttribute("fill", STROKE_COLOR);
        } else {
            circle.setAttribute("fill", "none");
            circle.setAttribute("stroke", STROKE_COLOR);
            circle.setAttribute("stroke-width", STROKE_WIDTH_DOT);
        }
        svg.appendChild(circle);

        for (let ri = 0; ri < dot.rings; ri++) {
            const ring = document.createElementNS(NS, "circle");
            ring.setAttribute("cx", dot.x);
            ring.setAttribute("cy", dot.y);
            ring.setAttribute("r", dotRadius * (0.75 + ri * 0.25));
            ring.setAttribute("fill", "none");
            ring.setAttribute("stroke", STROKE_COLOR);
            ring.setAttribute("stroke-width", STROKE_WIDTH_DOT);
            ring.setAttribute("data-idx", dot.itemIdx);
            svg.appendChild(ring);
        }
    }

    // Hit-area overlays (transparent, wide strokes for easier hovering)
    for (const ip of itemPaths) {
        if (ip.idx < 0) continue;
        const hit = document.createElementNS(NS, "path");
        hit.setAttribute("d", ip.d);
        hit.setAttribute("fill", "none");
        hit.setAttribute("stroke", "transparent");
        hit.setAttribute("stroke-width", STROKE_WIDTH_ARC * 8);
        hit.setAttribute("data-idx", ip.idx);
        hit.classList.add("hit-area");
        svg.appendChild(hit);
    }
    for (const bc of bracketCircles) {
        const hit = document.createElementNS(NS, "circle");
        hit.setAttribute("cx", cx);
        hit.setAttribute("cy", cy);
        hit.setAttribute("r", bc.outerR);
        hit.setAttribute("fill", "none");
        hit.setAttribute("stroke", "transparent");
        hit.setAttribute("stroke-width", STROKE_WIDTH_BRACKET * 8);
        hit.setAttribute("data-idx", bc.idx);
        hit.classList.add("hit-area");
        svg.appendChild(hit);

        if (bc.double) {
            const hit2 = document.createElementNS(NS, "circle");
            hit2.setAttribute("cx", cx);
            hit2.setAttribute("cy", cy);
            hit2.setAttribute("r", bc.innerR);
            hit2.setAttribute("fill", "none");
            hit2.setAttribute("stroke", "transparent");
            hit2.setAttribute("stroke-width", STROKE_WIDTH_BRACKET * 8);
            hit2.setAttribute("data-idx", bc.idx);
            hit2.classList.add("hit-area");
            svg.appendChild(hit2);
        }
    }

    // Build code panel
    buildCodePanel(code, { leadingMods, items });
}

// --- Code panel ---
const codePanelEl = document.getElementById("code-panel");
codePanelEl.setAttribute("contenteditable", "true");
codePanelEl.setAttribute("spellcheck", "false");
let suppressCodeInput = false;

function buildPosMap(parsed) {
    const posMap = new Map();
    for (const m of parsed.leadingMods) posMap.set(m.pos, "leading");
    for (let i = 0; i < parsed.items.length; i++) {
        const item = parsed.items[i];
        posMap.set(item.pos, i);
        if (item.type === "dir") {
            for (const m of item.mods) posMap.set(m.pos, i);
        }
    }
    return posMap;
}

function buildCodePanel(code, parsed) {
    // Save cursor position
    const sel = window.getSelection();
    let cursorOffset = -1;
    if (sel.rangeCount && codePanelEl.contains(sel.anchorNode)) {
        // Walk text to compute absolute offset
        const range = document.createRange();
        range.selectNodeContents(codePanelEl);
        range.setEnd(sel.anchorNode, sel.anchorOffset);
        cursorOffset = range.toString().length;
    }

    suppressCodeInput = true;
    codePanelEl.innerHTML = "";

    currentPosMap = buildPosMap(parsed);

    for (let i = 0; i < code.length; i++) {
        const span = document.createElement("span");
        span.textContent = code[i];
        if (currentPosMap.has(i)) {
            span.classList.add("bf-char");
            span.setAttribute("data-idx", currentPosMap.get(i));
        }
        codePanelEl.appendChild(span);
    }

    // Restore cursor
    if (cursorOffset >= 0) {
        try {
            const newRange = document.createRange();
            let walked = 0;
            const walker = document.createTreeWalker(codePanelEl, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                if (walked + node.length >= cursorOffset) {
                    newRange.setStart(node, cursorOffset - walked);
                    newRange.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(newRange);
                    break;
                }
                walked += node.length;
            }
        } catch (e) { /* ignore */ }
    }

    suppressCodeInput = false;
}

function getCodePanelText() {
    return codePanelEl.textContent;
}

// --- Canvas size (editable, blank = auto) ---
const sizeInput = document.getElementById("canvas-size");
sizeInput.addEventListener("input", () => {
    const v = parseInt(sizeInput.value, 10);
    sizeOverride = (v >= 100) ? v : null;
    draw(config);
});

// --- Code editor ---
codePanelEl.addEventListener("input", () => {
    if (suppressCodeInput) return;
    program[currentCode] = getCodePanelText();
    sizeOverride = null;
    draw(config);
});

// Force plain text on paste
codePanelEl.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
});

// --- Highlight color picker ---
const hlPicker = document.getElementById("highlight-color");
function applyHighlightColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    document.documentElement.style.setProperty("--hl-color", hex);
    document.documentElement.style.setProperty("--hl-bg", `rgba(${r}, ${g}, ${b}, 0.3)`);
    document.documentElement.style.setProperty("--hl-glow", `rgba(${r}, ${g}, ${b}, 0.8)`);
}
applyHighlightColor(hlPicker.value);
hlPicker.addEventListener("input", () => applyHighlightColor(hlPicker.value));

// --- Initial draw ---
draw(config);

// --- Program switcher ---
const btnRow = document.getElementById("program-btns");
programKeys.forEach(key => {
    const btn = document.createElement("button");
    btn.textContent = key;
    if (key === currentCode) btn.classList.add("active");
    btn.addEventListener("click", () => {
        currentCode = key;
        sizeOverride = null;
        btnRow.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        draw(config);
    });
    btnRow.appendChild(btn);
});

// --- Slider controls ---
const sliders = {
    "sw-boundary": "STROKE_WIDTH_BOUNDARY",
    "sw-arc": "STROKE_WIDTH_ARC",
    "sw-bracket": "STROKE_WIDTH_BRACKET",
    "sw-dot": "STROKE_WIDTH_DOT"
};

for (const [id, key] of Object.entries(sliders)) {
    const el = document.getElementById(id);
    el.value = config[key];
    el.addEventListener("input", () => {
        config[key] = parseFloat(el.value);
        draw(config);
    });
}

const dumRadiusInput = document.getElementById("dum-radius");
dumRadiusInput.value = config.DUM_RADIUS;
dumRadiusInput.addEventListener("input", () => {
    config.DUM_RADIUS = parseFloat(dumRadiusInput.value);
    draw(config);
});

const bracketGapInput = document.getElementById("bracket-gap");
bracketGapInput.value = config.BRACKET_GAP;
bracketGapInput.addEventListener("input", () => {
    config.BRACKET_GAP = parseFloat(bracketGapInput.value);
    draw(config);
});

// --- Zoom & pan ---
let zoom = 1, panX = 0, panY = 0;
let transformDirty = false;
const container = document.getElementById("container");
container.style.cursor = "grab";
function applyTransform() {
    if (transformDirty) return;
    transformDirty = true;
    requestAnimationFrame(() => {
        container.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        transformDirty = false;
    });
}
document.getElementById("zoom-in").addEventListener("click", () => {
    zoom *= 1.3;
    applyTransform();
});
document.getElementById("zoom-out").addEventListener("click", () => {
    zoom /= 1.3;
    applyTransform();
});

window.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoom *= factor;
    applyTransform();
}, { passive: false });

let dragging = false, dragStartX, dragStartY, startPanX, startPanY;
container.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    startPanX = panX;
    startPanY = panY;
    container.style.cursor = "grabbing";
});
window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    panX = startPanX + (e.clientX - dragStartX);
    panY = startPanY + (e.clientY - dragStartY);
    applyTransform();
});
window.addEventListener("mouseup", () => {
    dragging = false;
    container.style.cursor = "grab";
});

document.getElementById("download").addEventListener("click", () => {
    const svgEl = document.querySelector("#container svg");
    const clone = svgEl.cloneNode(true);
    clone.querySelectorAll(".hit-area").forEach(el => el.remove());
    clone.querySelectorAll("[data-idx]").forEach(el => el.removeAttribute("data-idx"));
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(clone);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bf-circle.svg";
    a.click();
    URL.revokeObjectURL(url);
});

// --- Bidirectional hover highlighting ---
function highlightGroup(idx) {
    if (dragging) return;
    const idxStr = String(idx);
    document.querySelectorAll(`#code-panel .bf-char[data-idx="${idxStr}"]`).forEach(el => el.classList.add("highlight"));
    document.querySelectorAll(`#container svg [data-idx="${idxStr}"]`).forEach(el => el.classList.add("highlight"));
}

function clearHighlights() {
    document.querySelectorAll(".highlight").forEach(el => el.classList.remove("highlight"));
}

codePanelEl.addEventListener("mouseenter", (e) => {
    const span = e.target.closest(".bf-char");
    if (span) highlightGroup(span.getAttribute("data-idx"));
}, true);
codePanelEl.addEventListener("mouseleave", (e) => {
    const span = e.target.closest(".bf-char");
    if (span) clearHighlights();
}, true);

const svgContainer2 = document.getElementById("container");
svgContainer2.addEventListener("mouseenter", (e) => {
    const el = e.target.closest("[data-idx]");
    if (el) highlightGroup(el.getAttribute("data-idx"));
}, true);
svgContainer2.addEventListener("mouseleave", (e) => {
    const el = e.target.closest("[data-idx]");
    if (el) clearHighlights();
}, true);

}); // end fetch
