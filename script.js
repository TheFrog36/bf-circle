Promise.all([
    fetch("config.json").then(r => r.json()),
    fetch("program.json").then(r => r.json())
]).then(([configs, program]) => {

const NS = "http://www.w3.org/2000/svg";
const programKeys = Object.keys(program);

// --- URL parameter utilities ---
function getUrlParam(key, fallback) {
    return new URLSearchParams(window.location.search).get(key) || fallback;
}
function setUrlParam(key, value) {
    const params = new URLSearchParams(window.location.search);
    params.set(key, value);
    history.replaceState(null, "", "?" + params.toString());
}

let renderMode = getUrlParam("render", "render1");
let currentCode = getUrlParam("program", programKeys[0]);
if (!programKeys.includes(currentCode)) currentCode = programKeys[0];

// Default config values for any program missing from config.json
const DEFAULT_CONFIG = {
    FIXED_SIZE: 600, PADDING: 40, BG_COLOR: "#000", STROKE_COLOR: "#fff",
    STROKE_WIDTH_BOUNDARY: 40, STROKE_WIDTH_ARC: 20, STROKE_WIDTH_BRACKET: 20,
    STROKE_WIDTH_DOT: 10, BRACKET_GAP: 40, DUM_RADIUS: 50, ARC_ANGLE: 180,
    DENT_ANGLE_GT: 30, DENT_ANGLE_LT: 30, DENT_ANGLE_PLUS: 30,
    DENT_ANGLE_MINUS: 30, DENT_ANGLE_DOT: 30, DENT_ANGLE_COMMA: 30,
    DENT_ANGLE_OPEN: 30, DENT_ANGLE_CLOSE: 30,
    DENT_PADDING: 10, DENT_MAX_SIZE: 1000, GAP_MAX_SIZE: 1000
};

const DENT_SYMBOL_KEYS = {
    ">": "DENT_ANGLE_GT", "<": "DENT_ANGLE_LT", "+": "DENT_ANGLE_PLUS",
    "-": "DENT_ANGLE_MINUS", ".": "DENT_ANGLE_DOT", ",": "DENT_ANGLE_COMMA",
    "[": "DENT_ANGLE_OPEN", "]": "DENT_ANGLE_CLOSE"
};

// Ensure every program has a config entry (merge defaults for missing keys)
for (const key of programKeys) {
    configs[key] = { ...DEFAULT_CONFIG, ...(configs[key] || {}) };
}

let config = configs[currentCode];
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
            items.push({ type: ch, pos: i, mods: [] });
            pendingMods = [];
        } else if (ch === "+" || ch === "-" || ch === "." || ch === ",") {
            if (items.length > 0) {
                const last = items[items.length - 1];
                if (last.mods) {
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
        if (ch === "." || ch === ",") {
            for (let j = 0; j < count; j++)
                symbols.push({ shape: ch === "." ? "semicircle-out" : "semicircle-in" });
        } else {
            const hundreds = Math.floor(count / 100);
            const tens = Math.floor((count % 100) / 10);
            const ones = count % 10;
            for (let j = 0; j < hundreds; j++) symbols.push({ shape: "dot", filled: ch === "+", rings: 2 });
            for (let j = 0; j < tens; j++) symbols.push({ shape: "dot", filled: ch === "+", rings: 1 });
            for (let j = 0; j < ones; j++) symbols.push({ shape: "dot", filled: ch === "+", rings: 0 });
        }
    }
    return symbols;
}

function createCircle(svg, cx, cy, r, stroke, strokeWidth) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", cx);
    c.setAttribute("cy", cy);
    c.setAttribute("r", r);
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", stroke);
    c.setAttribute("stroke-width", strokeWidth);
    svg.appendChild(c);
    return c;
}

function initCanvas(cfg) {
    const code = program[currentCode];
    const parsed = parse(code);
    const items = parsed.items;

    const numDirItems = items.filter(i => i.type === "dir").length;
    const numOpen = items.filter(i => i.type === "[").length;
    const numClose = items.filter(i => i.type === "]").length;

    const baseBracketSpace = numOpen * 6 + numClose * 2;
    const autoSize = Math.round(2 * (10 + cfg.DUM_RADIUS + (numDirItems + 1) * 20 + baseBracketSpace));
    const size = sizeOverride != null ? sizeOverride : Math.max(500, Math.min(15000, autoSize));
    const scale = size / 10000;

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
    bg.setAttribute("fill", cfg.BG_COLOR);
    svg.appendChild(bg);

    const cx = size / 2, cy = size / 2;
    const PADDING = 10 * scale;
    const outerRadius = cx - PADDING;
    const dumRadius = cfg.DUM_RADIUS * scale;

    return { code, parsed, items, size, scale, svg, cx, cy, outerRadius, dumRadius };
}

// --- Draw function ---
function draw(cfg) {
    const { STROKE_COLOR } = cfg;
    const { code, parsed, items, size, scale, svg, cx, cy, outerRadius, dumRadius } = initCanvas(cfg);
    const { leadingMods } = parsed;

    const STROKE_WIDTH_BOUNDARY = cfg.STROKE_WIDTH_BOUNDARY * scale;
    const STROKE_WIDTH_ARC = cfg.STROKE_WIDTH_ARC * scale;
    const STROKE_WIDTH_BRACKET = cfg.STROKE_WIDTH_BRACKET * scale;
    const STROKE_WIDTH_DOT = cfg.STROKE_WIDTH_DOT * scale;
    const BRACKET_GAP = cfg.BRACKET_GAP * scale;

    const leftoverSpace = outerRadius - dumRadius;
    const sectionWidth = leftoverSpace / (items.length + 1);

    const outerCircle = createCircle(svg, cx, cy, outerRadius, STROKE_COLOR, STROKE_WIDTH_BOUNDARY);
    createCircle(svg, cx, cy, dumRadius, STROKE_COLOR, STROKE_WIDTH_BOUNDARY);

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
                angle: angle,
                shape: symbols[k].shape,
                filled: symbols[k].filled,
                rings: symbols[k].rings,
                itemIdx: "leading"
            });
        }
    }

    // Per-item paths instead of one monolithic path
    let currentAngle = 0; // cumulative angle in radians
    const arcRad = cfg.ARC_ANGLE * Math.PI / 180;
    const isFullCircle = (cfg.ARC_ANGLE >= 359.99);
    let penX = cx + outerRadius * Math.cos(currentAngle);
    let penY = cy + outerRadius * Math.sin(currentAngle);
    const bracketCircles = [];
    let rOffset = 0;
    const itemPaths = [];    // { d, idx, type: "arc"|"connector" }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.type === "dir") {
            rOffset += sectionWidth;
            const r = outerRadius - rOffset;
            const direction = (item.dir === ">") ? 1 : -1;
            const arcStartAngle = currentAngle;
            const arcEndAngle = currentAngle + direction * arcRad;

            const startX = cx + r * Math.cos(arcStartAngle);
            const startY = cy + r * Math.sin(arcStartAngle);
            const endX = cx + r * Math.cos(arcEndAngle);
            const endY = cy + r * Math.sin(arcEndAngle);

            let d;
            if (isFullCircle) {
                // SVG can't draw a single full-circle arc; split into two 180° halves
                const midAngle = currentAngle + direction * Math.PI;
                const midX = cx + r * Math.cos(midAngle);
                const midY = cy + r * Math.sin(midAngle);
                const sweepFlag = (direction > 0) ? 1 : 0;
                d = `M ${penX} ${penY} L ${startX} ${startY} A ${r} ${r} 0 0 ${sweepFlag} ${midX} ${midY} A ${r} ${r} 0 0 ${sweepFlag} ${endX} ${endY}`;
            } else {
                const sweepFlag = (direction > 0) ? 1 : 0;
                const largeArcFlag = (cfg.ARC_ANGLE > 180) ? 1 : 0;
                d = `M ${penX} ${penY} L ${startX} ${startY} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${endX} ${endY}`;
            }
            itemPaths.push({ d, idx: i, type: "arc" });

            penX = endX;
            penY = endY;
            currentAngle = arcEndAngle;

            if (item.mods.length > 0) {
                const symbols = compressMods(item.mods);
                const n = symbols.length;
                for (let k = 0; k < n; k++) {
                    const t = (k + 1) / (n + 1);
                    const angle = arcStartAngle + direction * arcRad * t;
                    dotsToDraw.push({
                        x: cx + r * Math.cos(angle),
                        y: cy + r * Math.sin(angle),
                        angle: angle,
                        shape: symbols[k].shape,
                        filled: symbols[k].filled,
                        rings: symbols[k].rings,
                        itemIdx: i
                    });
                }
            }
        } else {
            const isOpen = item.type === "[";
            rOffset += sectionWidth;
            const cosA = Math.cos(currentAngle);
            const sinA = Math.sin(currentAngle);
            const centerR = outerRadius - rOffset;

            let bracketR;
            if (isOpen) {
                const outerR = centerR + BRACKET_GAP / 2;
                const innerR = centerR - BRACKET_GAP / 2;
                const d = `M ${penX} ${penY} L ${cx + outerR * cosA} ${cy + outerR * sinA}`;
                itemPaths.push({ d, idx: i, type: "connector" });
                penX = cx + innerR * cosA;
                penY = cy + innerR * sinA;
                bracketCircles.push({ outerR, innerR, double: true, idx: i });
                bracketR = outerR;
            } else {
                const r = centerR;
                const d = `M ${penX} ${penY} L ${cx + r * cosA} ${cy + r * sinA}`;
                itemPaths.push({ d, idx: i, type: "connector" });
                penX = cx + r * cosA;
                penY = cy + r * sinA;
                bracketCircles.push({ outerR: r, double: false, idx: i });
                bracketR = r;
            }

            if (item.mods && item.mods.length > 0) {
                const symbols = compressMods(item.mods);
                const n = symbols.length;
                for (let k = 0; k < n; k++) {
                    const angle = (2 * Math.PI * (k + 1)) / (n + 1);
                    dotsToDraw.push({
                        x: cx + bracketR * Math.cos(angle),
                        y: cy + bracketR * Math.sin(angle),
                        angle: angle,
                        shape: symbols[k].shape,
                        filled: symbols[k].filled,
                        rings: symbols[k].rings,
                        itemIdx: i
                    });
                }
            }
        }
    }

    // Final line to inner circle
    const endX = cx + dumRadius * Math.cos(currentAngle);
    const endY = cy + dumRadius * Math.sin(currentAngle);
    const finalD = `M ${penX} ${penY} L ${endX} ${endY}`;
    itemPaths.push({ d: finalD, idx: -1, type: "connector" });

    // Append visible paths
    for (const ip of itemPaths) {
        const path = document.createElementNS(NS, "path");
        path.setAttribute("d", ip.d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", STROKE_COLOR);
        path.setAttribute("stroke-width", STROKE_WIDTH_ARC);
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        if (ip.idx >= 0) path.setAttribute("data-idx", ip.idx);
        svg.appendChild(path);
    }

    // bracket circles (full circles)
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

    // dots and semicircles
    const dotRadius = sectionWidth / 4;
    for (const dot of dotsToDraw) {
        if (dot.shape === "semicircle-out" || dot.shape === "semicircle-in") {
            const θ = dot.angle;
            const r = dotRadius;
            const p1x = dot.x + r * Math.cos(θ + Math.PI / 2);
            const p1y = dot.y + r * Math.sin(θ + Math.PI / 2);
            const p2x = dot.x + r * Math.cos(θ - Math.PI / 2);
            const p2y = dot.y + r * Math.sin(θ - Math.PI / 2);
            // outward: arc bulges away from center (sweep=1); inward: toward center (sweep=0)
            const sweep = dot.shape === "semicircle-out" ? 1 : 0;
            const path = document.createElementNS(NS, "path");
            path.setAttribute("d", `M ${p1x} ${p1y} A ${r} ${r} 0 0 ${sweep} ${p2x} ${p2y}`);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", STROKE_COLOR);
            path.setAttribute("stroke-width", STROKE_WIDTH_DOT);
            path.setAttribute("data-idx", dot.itemIdx);
            svg.appendChild(path);
        } else {
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

// --- draw2: render with dents and brackets ---
function drawDentRing(svg, cx, cy, R, dents, getAngleDeg, dentPaddingDeg, depth, strokeColor, strokeWidth, bgColor, maxArc, maxGapArc) {
    // dents: array of { dir: ">"|"<"|"+"|"-"|"."|","|"["|"]", idx: number }
    if (!dents || dents.length === 0) {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", cx);
        c.setAttribute("cy", cy);
        c.setAttribute("r", R);
        c.setAttribute("fill", "none");
        c.setAttribute("stroke", strokeColor);
        c.setAttribute("stroke-width", strokeWidth);
        svg.appendChild(c);
        return;
    }

    const n = dents.length;
    // Cap each dent angle: min(configured angle, maxArc / R)
    const maxAngleRad = (maxArc && R > 0) ? maxArc / R : Infinity;
    const cappedRad = d => Math.min(getAngleDeg(d.dir) * Math.PI / 180, maxAngleRad);

    // Fixed-size gaps with pixel cap (same approach as dent capping)
    const gapConfigRad = dentPaddingDeg * Math.PI / 180;
    const maxGapAngleRad = (maxGapArc && R > 0) ? maxGapArc / R : Infinity;
    const gapRad = Math.min(gapConfigRad, maxGapAngleRad);

    // Compute start angles, distributing any leftover space evenly into gaps
    const startAngles = [];
    const dentRads = dents.map(d => cappedRad(d));
    const totalDent = dentRads.reduce((a, b) => a + b, 0);
    const totalUsed = totalDent + n * gapRad;
    const leftover = 2 * Math.PI - totalUsed;
    const extraGap = leftover > 0 ? leftover / n : 0;
    const effectiveGap = gapRad + extraGap;
    let cursor = effectiveGap / 2;
    for (let i = 0; i < n; i++) {
        startAngles.push(cursor);
        cursor += dentRads[i] + effectiveGap;
    }

    // Emit one <path> per dent (tooth/flat + trailing gap arc), tagged with data-idx
    const bandDents = [];
    const hitPaths = [];   // collect d-strings + idx for hit areas

    for (let i = 0; i < n; i++) {
        const dentStart = startAngles[i];
        const myRad = dentRads[i];
        const dentEnd = dentStart + myRad;
        const dir = dents[i].dir;
        const dentIdx = dents[i].idx;
        const myLargeArc = myRad > Math.PI ? 1 : 0;

        // Leading gap arc (from previous dent's end to this dent's start)
        const prevEnd = i === 0
            ? 0  // start of circle
            : startAngles[i - 1] + dentRads[i - 1];
        const leadGapRad = dentStart - prevEnd;

        const bx0 = cx + R * Math.cos(dentStart);
        const by0 = cy + R * Math.sin(dentStart);

        // Build per-dent path: leading gap arc, dent shape, trailing gap arc
        let d = "";

        // Start point: at the end of the previous dent (or angle 0)
        const gapStartAngle = prevEnd;
        const gsx = cx + R * Math.cos(gapStartAngle);
        const gsy = cy + R * Math.sin(gapStartAngle);
        d += `M ${gsx} ${gsy} `;

        // Leading gap arc to dent start
        if (leadGapRad > 0.001) {
            const leadLargeArc = leadGapRad > Math.PI ? 1 : 0;
            d += `A ${R} ${R} 0 ${leadLargeArc} 1 ${bx0} ${by0} `;
        }

        // Dent shape
        if (dir === ">" || dir === "<") {
            const deviation = dir === ">" ? -depth : depth;
            const toothR = R + deviation;
            const tx0 = cx + toothR * Math.cos(dentStart);
            const ty0 = cy + toothR * Math.sin(dentStart);
            const tx1 = cx + toothR * Math.cos(dentEnd);
            const ty1 = cy + toothR * Math.sin(dentEnd);
            const bx1 = cx + R * Math.cos(dentEnd);
            const by1 = cy + R * Math.sin(dentEnd);

            d += `L ${tx0} ${ty0} `;
            d += `A ${toothR} ${toothR} 0 ${myLargeArc} 1 ${tx1} ${ty1} `;
            d += `L ${bx1} ${by1} `;
        } else {
            const bx1 = cx + R * Math.cos(dentEnd);
            const by1 = cy + R * Math.sin(dentEnd);
            d += `A ${R} ${R} 0 ${myLargeArc} 1 ${bx1} ${by1} `;
            bandDents.push(i);
        }

        const path = document.createElementNS(NS, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", strokeColor);
        path.setAttribute("stroke-width", strokeWidth);
        if (dentIdx != null) path.setAttribute("data-idx", dentIdx);
        svg.appendChild(path);

        hitPaths.push({ d, idx: dentIdx });
    }

    // Closing gap: from last dent's end back to first dent's leading gap start (angle 0)
    const lastEnd = startAngles[n - 1] + dentRads[n - 1];
    const closeRad = 2 * Math.PI - lastEnd;
    if (closeRad > 0.001) {
        const lx = cx + R * Math.cos(lastEnd);
        const ly = cy + R * Math.sin(lastEnd);
        const fx = cx + R * Math.cos(0);
        const fy = cy + R * Math.sin(0);
        const closeLargeArc = closeRad > Math.PI ? 1 : 0;
        const closeD = `M ${lx} ${ly} A ${R} ${R} 0 ${closeLargeArc} 1 ${fx} ${fy}`;
        const closePath = document.createElementNS(NS, "path");
        closePath.setAttribute("d", closeD);
        closePath.setAttribute("fill", "none");
        closePath.setAttribute("stroke", strokeColor);
        closePath.setAttribute("stroke-width", strokeWidth);
        svg.appendChild(closePath);
    }

    // Band segments
    const outerR = R + depth;
    const innerR = R - depth;

    function drawBand(r0, r1, aStart, aEnd, fill, idx) {
        const la = (aEnd - aStart) > Math.PI ? 1 : 0;
        const a0x = cx + r0 * Math.cos(aStart), a0y = cy + r0 * Math.sin(aStart);
        const a1x = cx + r0 * Math.cos(aEnd),   a1y = cy + r0 * Math.sin(aEnd);
        const b0x = cx + r1 * Math.cos(aStart), b0y = cy + r1 * Math.sin(aStart);
        const b1x = cx + r1 * Math.cos(aEnd),   b1y = cy + r1 * Math.sin(aEnd);
        const bd = `M ${a0x} ${a0y} A ${r0} ${r0} 0 ${la} 1 ${a1x} ${a1y} L ${b1x} ${b1y} A ${r1} ${r1} 0 ${la} 0 ${b0x} ${b0y} Z`;
        const bp = document.createElementNS(NS, "path");
        bp.setAttribute("d", bd);
        bp.setAttribute("stroke", strokeColor);
        bp.setAttribute("stroke-width", strokeWidth);
        bp.setAttribute("fill", fill);
        if (idx != null) bp.setAttribute("data-idx", idx);
        svg.appendChild(bp);
    }

    for (const i of bandDents) {
        const dir = dents[i].dir;
        const dentIdx = dents[i].idx;
        const dentStart = startAngles[i];
        const dentEnd = dentStart + dentRads[i];

        if (dir === "[") {
            drawBand(outerR, R, dentStart, dentEnd, strokeColor, dentIdx);
            drawBand(R, innerR, dentStart, dentEnd, bgColor, dentIdx);
        } else if (dir === "]") {
            drawBand(outerR, R, dentStart, dentEnd, bgColor, dentIdx);
            drawBand(R, innerR, dentStart, dentEnd, strokeColor, dentIdx);
        } else if (dir === ".") {
            drawBand(R, innerR, dentStart, dentEnd, strokeColor, dentIdx);
        } else if (dir === ",") {
            drawBand(outerR, R, dentStart, dentEnd, strokeColor, dentIdx);
        } else if (dir === "+") {
            drawBand(outerR, innerR, dentStart, dentEnd, strokeColor, dentIdx);
        } else {
            drawBand(outerR, innerR, dentStart, dentEnd, bgColor, dentIdx);
        }
    }

    // Hit-area overlays for render2 highlighting
    for (const hp of hitPaths) {
        if (hp.idx == null) continue;
        const hit = document.createElementNS(NS, "path");
        hit.setAttribute("d", hp.d);
        hit.setAttribute("fill", "none");
        hit.setAttribute("stroke", "transparent");
        hit.setAttribute("stroke-width", strokeWidth * 8);
        hit.setAttribute("data-idx", hp.idx);
        hit.classList.add("hit-area");
        svg.appendChild(hit);
    }
}

function draw2(cfg) {
    const { BG_COLOR, STROKE_COLOR } = cfg;
    const { code, parsed, items, size, scale, svg, cx, cy, outerRadius, dumRadius } = initCanvas(cfg);

    const STROKE_WIDTH_BOUNDARY = cfg.STROKE_WIDTH_BOUNDARY * scale;
    const STROKE_WIDTH_BRACKET = cfg.STROKE_WIDTH_BRACKET * scale;

    const outerCircle = createCircle(svg, cx, cy, outerRadius, STROKE_COLOR, STROKE_WIDTH_BOUNDARY);
    createCircle(svg, cx, cy, dumRadius, STROKE_COLOR, STROKE_WIDTH_BOUNDARY);

    // --- Group all parsed items into one dent list ---
    const allDents = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type === "dir") {
            allDents.push({ dir: item.dir, idx: i });
            if (item.mods) {
                for (const m of item.mods) {
                    allDents.push({ dir: m.ch, idx: i });
                }
            }
        } else {
            // [ or ]
            allDents.push({ dir: item.type, idx: i });
        }
    }

    // --- Split into rings with actual arc-length capacity ---
    const dentPaddingDeg = cfg.DENT_PADDING || 0;
    const getAngleDeg = dir => cfg[DENT_SYMBOL_KEYS[dir]] || 30;
    const maxArc = cfg.DENT_MAX_SIZE * scale;
    const maxGapArc = cfg.GAP_MAX_SIZE * scale;

    // Limit outer radius to where dents are still meaningfully visible.
    // At maxUsefulR, the smallest configured dent angle is reduced to 50% of configured.
    const minDentAngleRad = Math.min(...allDents.map(d => getAngleDeg(d.dir))) * Math.PI / 180;
    const maxUsefulR = (maxArc > 0 && minDentAngleRad > 0)
        ? 2 * maxArc / minDentAngleRad
        : outerRadius;
    const usableOuter = Math.min(outerRadius, maxUsefulR);

    // Iteratively assign dents to rings, recomputing radii until stable
    let levels = [];
    let prevLevelCount = -1;

    // Initial guess: use uncapped angles
    {
        let ringDents = [];
        let usedAngle = 0;
        for (const dent of allDents) {
            const needed = getAngleDeg(dent.dir) + dentPaddingDeg;
            if (usedAngle + needed > 360 && ringDents.length > 0) {
                levels.push(ringDents);
                ringDents = [];
                usedAngle = 0;
            }
            ringDents.push(dent);
            usedAngle += needed;
        }
        if (ringDents.length > 0) levels.push(ringDents);
    }

    // Repack loop: recompute using actual capped angles at each radius
    for (let iter = 0; iter < 10 && levels.length !== prevLevelCount; iter++) {
        prevLevelCount = levels.length;
        const totalLevels = levels.length;
        const rawRS = (usableOuter - dumRadius) / (totalLevels + 1);
        const ringSpacing = Math.min(rawRS, maxArc * 3 / 0.33);
        const effOuter = Math.min(usableOuter, dumRadius + ringSpacing * (totalLevels + 1));

        // Flatten all dents back and re-distribute using capped angles at actual radii
        const flat = levels.flat();
        levels = [];
        let ringDents = [];
        let usedAngle = 0;
        let ringIdx = 0;

        for (const dent of flat) {
            const R = effOuter - ringSpacing * (ringIdx + 1);
            const cappedDentDeg = (maxArc && R > 0)
                ? Math.min(getAngleDeg(dent.dir), (maxArc / R) * 180 / Math.PI)
                : getAngleDeg(dent.dir);
            const cappedGapDeg = (maxGapArc && R > 0)
                ? Math.min(dentPaddingDeg, (maxGapArc / R) * 180 / Math.PI)
                : dentPaddingDeg;
            const needed = cappedDentDeg + cappedGapDeg;

            if (usedAngle + needed > 360 && ringDents.length > 0) {
                levels.push(ringDents);
                ringDents = [];
                usedAngle = 0;
                ringIdx++;
            }
            ringDents.push(dent);
            usedAngle += needed;
        }
        if (ringDents.length > 0) levels.push(ringDents);
    }

    // --- Assign radii and draw ---
    const totalLevels = levels.length;
    if (totalLevels > 0) {
        const maxDepth = maxArc * 3;
        const rawSpacing = (usableOuter - dumRadius) / (totalLevels + 1);
        const ringSpacing = Math.min(rawSpacing, maxDepth / 0.33);
        const depth = Math.min(ringSpacing * 0.33, maxDepth);
        const effectiveOuter = Math.min(usableOuter, dumRadius + ringSpacing * (totalLevels + 1));
        outerCircle.setAttribute("r", effectiveOuter);

        for (let i = 0; i < totalLevels; i++) {
            const R = effectiveOuter - ringSpacing * (i + 1);
            drawDentRing(svg, cx, cy, R, levels[i], getAngleDeg, dentPaddingDeg, depth, STROKE_COLOR, STROKE_WIDTH_BRACKET, BG_COLOR, maxArc, maxGapArc);
        }
    }

    buildCodePanel(code, parsed);
}

// --- Render dispatcher ---
function redraw() {
    if (renderMode === "render2") {
        draw2(config);
    } else {
        draw(config);
    }
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
        if (item.mods) {
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
    redraw();
});

// --- Code editor ---
codePanelEl.addEventListener("input", () => {
    if (suppressCodeInput) return;
    program[currentCode] = getCodePanelText();
    sizeOverride = null;
    redraw();
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

// --- Render mode buttons ---
const renderBtnRow = document.getElementById("render-mode-btns");
const controlsEl = document.getElementById("controls");
["render1", "render2"].forEach(mode => {
    const btn = document.createElement("button");
    btn.textContent = mode;
    if (mode === renderMode) btn.classList.add("active");
    btn.addEventListener("click", () => {
        renderMode = mode;
        setUrlParam("render", mode);
        renderBtnRow.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        controlsEl.classList.toggle("mode-render2", mode === "render2");
        redraw();
    });
    renderBtnRow.appendChild(btn);
});
// Apply initial mode class
if (renderMode === "render2") controlsEl.classList.add("mode-render2");

// --- Initial draw ---
redraw();

// --- Program switcher ---
const btnRow = document.getElementById("program-btns");
programKeys.forEach(key => {
    const btn = document.createElement("button");
    btn.textContent = key;
    if (key === currentCode) btn.classList.add("active");
    btn.addEventListener("click", () => {
        currentCode = key;
        config = configs[currentCode];
        sizeOverride = null;
        btnRow.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        setUrlParam("program", key);
        syncSlidersFromConfig();
        redraw();
    });
    btnRow.appendChild(btn);
});

// --- Wrap number inputs with custom arrows ---
function wrapNumInput(input) {
    const wrap = document.createElement("span");
    wrap.className = "num-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const arrows = document.createElement("span");
    arrows.className = "num-arrows";

    const up = document.createElement("span");
    up.className = "num-arr";
    up.innerHTML = '<svg viewBox="0 0 8 5"><path d="M1 4L4 1L7 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    up.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.stepUp();
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const down = document.createElement("span");
    down.className = "num-arr";
    down.innerHTML = '<svg viewBox="0 0 8 5"><path d="M1 1L4 4L7 1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    down.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.stepDown();
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    arrows.appendChild(up);
    arrows.appendChild(down);
    wrap.appendChild(arrows);
    return wrap;
}

// Wrap all static number inputs in #controls
document.querySelectorAll("#controls input[type='number']").forEach(wrapNumInput);

// --- Slider controls ---
const sliders = {
    "sw-boundary": "STROKE_WIDTH_BOUNDARY",
    "sw-arc": "STROKE_WIDTH_ARC",
    "sw-bracket": "STROKE_WIDTH_BRACKET",
    "sw-dot": "STROKE_WIDTH_DOT",
    "dum-radius": "DUM_RADIUS",
    "bracket-gap": "BRACKET_GAP",
    "arc-angle": "ARC_ANGLE",
    "dent-padding": "DENT_PADDING",
    "dent-max-size": "DENT_MAX_SIZE",
    "gap-max-size": "GAP_MAX_SIZE",
};
const sliderEls = {};
for (const [id, key] of Object.entries(sliders)) {
    const el = document.getElementById(id);
    el.value = config[key];
    el.addEventListener("input", () => {
        config[key] = parseFloat(el.value);
        redraw();
    });
    sliderEls[id] = el;
}

// --- Per-symbol dent angle controls ---
const dentAngleContainer = document.getElementById("dent-angle-controls");
const dentAngleInputs = {};
const DENT_SYMBOLS = [
    { ch: ">", key: "DENT_ANGLE_GT", label: ">" },
    { ch: "<", key: "DENT_ANGLE_LT", label: "<" },
    { ch: "+", key: "DENT_ANGLE_PLUS", label: "+" },
    { ch: "-", key: "DENT_ANGLE_MINUS", label: "\u2212" },
    { ch: ".", key: "DENT_ANGLE_DOT", label: "." },
    { ch: ",", key: "DENT_ANGLE_COMMA", label: "," },
    { ch: "[", key: "DENT_ANGLE_OPEN", label: "[" },
    { ch: "]", key: "DENT_ANGLE_CLOSE", label: "]" },
];
DENT_SYMBOLS.forEach(sym => {
    const lbl = document.createElement("label");
    lbl.textContent = sym.label + " \u2220 ";
    const inp = document.createElement("input");
    inp.type = "number"; inp.step = "5"; inp.min = "5"; inp.max = "180";
    inp.value = config[sym.key];
    inp.addEventListener("input", () => {
        config[sym.key] = parseFloat(inp.value);
        redraw();
    });
    const btn = document.createElement("button");
    btn.className = "apply-all-btn";
    btn.title = "Apply this angle to all symbols";
    btn.innerHTML = '<svg viewBox="0 0 12 10" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 5H8M6 2.5L8.5 5L6 7.5"/><path d="M10 1.5V8.5" stroke-dasharray="1.5 1.5"/></svg>';
    btn.addEventListener("click", () => {
        const val = parseFloat(inp.value);
        DENT_SYMBOLS.forEach(s => {
            config[s.key] = val;
            dentAngleInputs[s.ch].value = val;
        });
        redraw();
    });
    lbl.appendChild(inp);
    wrapNumInput(inp);
    lbl.appendChild(btn);
    dentAngleContainer.appendChild(lbl);
    dentAngleInputs[sym.ch] = inp;
});

// --- Sync sliders to current config ---
function syncSlidersFromConfig() {
    for (const [id, key] of Object.entries(sliders)) {
        sliderEls[id].value = config[key];
    }
    DENT_SYMBOLS.forEach(sym => {
        dentAngleInputs[sym.ch].value = config[sym.key];
    });
}

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

function getCleanSvgSource() {
    const svgEl = document.querySelector("#container svg");
    const clone = svgEl.cloneNode(true);
    clone.querySelectorAll(".hit-area").forEach(el => el.remove());
    clone.querySelectorAll("[data-idx]").forEach(el => el.removeAttribute("data-idx"));
    clone.querySelectorAll(".highlight").forEach(el => el.classList.remove("highlight"));
    return new XMLSerializer().serializeToString(clone);
}

document.getElementById("dl-svg").addEventListener("click", () => {
    const source = getCleanSvgSource();
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bf-circle.svg";
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById("dl-png").addEventListener("click", () => {
    const source = getCleanSvgSource();
    const svgEl = document.querySelector("#container svg");
    const vb = svgEl.getAttribute("viewBox").split(" ");
    const w = parseFloat(vb[2]);
    const h = parseFloat(vb[3]);

    const img = new Image();
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
            const pngUrl = URL.createObjectURL(pngBlob);
            const a = document.createElement("a");
            a.href = pngUrl;
            a.download = "bf-circle.png";
            a.click();
            URL.revokeObjectURL(pngUrl);
        }, "image/png");
    };
    img.src = url;
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

codePanelEl.addEventListener("mouseover", (e) => {
    clearHighlights();
    const span = e.target.closest(".bf-char");
    if (span) highlightGroup(span.getAttribute("data-idx"));
});
codePanelEl.addEventListener("mouseleave", () => {
    clearHighlights();
});

const svgContainer2 = document.getElementById("container");
svgContainer2.addEventListener("mouseover", (e) => {
    clearHighlights();
    const el = e.target.closest("[data-idx]");
    if (el) highlightGroup(el.getAttribute("data-idx"));
});
svgContainer2.addEventListener("mouseleave", () => {
    clearHighlights();
});

}); // end fetch
