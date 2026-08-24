/* ============================================================================
   Cantori — Depth 1: "The Descent"

   A real dungeon now:
     - Procedurally generated levels (rooms + corridors), fresh every descent.
     - Fog of war: you see only what your torch reveals (recursive shadowcast);
       places you've been stay dimly remembered; the unseen is black.
     - Stairs down (>) — step on them to descend to a new, deeper level.
     - A camera that follows you, so dungeons can be bigger than the screen.

   Controls:
     - Tap / click an explored tile -> walk a route there (around walls, diagonal).
     - Keyboard: arrows / WASD, plus 8-direction keys y u b n and the numpad.
   ========================================================================== */

(function () {
  "use strict";

  // ---- Map model -----------------------------------------------------------
  const MAP_W = 33;
  const MAP_H = 33;
  const FOV_RADIUS = 8;

  const WALL = 0;
  const FLOOR = 1;
  const STAIRS = 2;

  let map = [];        // MAP_H x MAP_W of WALL/FLOOR/STAIRS
  let visible = [];    // currently in field of view
  let explored = [];   // ever seen
  let depth = 1;

  const player = { x: 0, y: 0 };
  let walkPath = [];

  const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  const isWall = (x, y) => !inBounds(x, y) || map[y][x] === WALL;
  const passable = (x, y) => inBounds(x, y) && map[y][x] !== WALL;

  function blankGrid(fill) {
    const g = [];
    for (let y = 0; y < MAP_H; y++) g.push(new Array(MAP_W).fill(fill));
    return g;
  }

  // ---- Dungeon generation (rooms + L-shaped corridors) --------------------
  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const roomCenter = (r) => ({
    x: Math.floor(r.x + r.w / 2),
    y: Math.floor(r.y + r.h / 2),
  });

  function overlaps(a, b, pad) {
    return (
      a.x - pad <= b.x + b.w &&
      a.x + a.w + pad >= b.x &&
      a.y - pad <= b.y + b.h &&
      a.y + a.h + pad >= b.y
    );
  }

  function carveRoom(r) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) map[y][x] = FLOOR;
  }
  function hTunnel(x1, x2, y) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
      if (map[y][x] === WALL) map[y][x] = FLOOR;
  }
  function vTunnel(y1, y2, x) {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
      if (map[y][x] === WALL) map[y][x] = FLOOR;
  }

  function generateLevel() {
    map = blankGrid(WALL);
    explored = blankGrid(false);
    visible = blankGrid(false);
    walkPath = [];

    const rooms = [];
    const MAX_ROOMS = 12;
    for (let tries = 0; tries < 140 && rooms.length < MAX_ROOMS; tries++) {
      const w = randInt(4, 8);
      const h = randInt(4, 8);
      const x = randInt(1, MAP_W - w - 2);
      const y = randInt(1, MAP_H - h - 2);
      const room = { x, y, w, h };
      if (rooms.some((r) => overlaps(r, room, 1))) continue;

      carveRoom(room);
      if (rooms.length > 0) {
        const a = roomCenter(rooms[rooms.length - 1]);
        const b = roomCenter(room);
        if (Math.random() < 0.5) {
          hTunnel(a.x, b.x, a.y);
          vTunnel(a.y, b.y, b.x);
        } else {
          vTunnel(a.y, b.y, a.x);
          hTunnel(a.x, b.x, b.y);
        }
      }
      rooms.push(room);
    }

    const start = roomCenter(rooms[0]);
    player.x = start.x;
    player.y = start.y;

    const last = roomCenter(rooms[rooms.length - 1]);
    map[last.y][last.x] = STAIRS;

    computeFOV();
  }

  // ---- Field of view (recursive shadowcasting) ----------------------------
  const OCT = [
    [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
    [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
  ];

  function castLight(cx, cy, row, start, end, xx, xy, yx, yy) {
    if (start < end) return;
    const r2 = FOV_RADIUS * FOV_RADIUS;
    let newStart = 0;
    for (let i = row; i <= FOV_RADIUS; i++) {
      let dx = -i - 1;
      const dy = -i;
      let blocked = false;
      while (dx <= 0) {
        dx++;
        const mx = cx + dx * xx + dy * xy;
        const my = cy + dx * yx + dy * yy;
        const lSlope = (dx - 0.5) / (dy + 0.5);
        const rSlope = (dx + 0.5) / (dy - 0.5);
        if (start < rSlope) continue;
        if (end > lSlope) break;

        if (dx * dx + dy * dy <= r2 && inBounds(mx, my)) {
          visible[my][mx] = true;
          explored[my][mx] = true;
        }
        if (blocked) {
          if (isWall(mx, my)) {
            newStart = rSlope;
            continue;
          } else {
            blocked = false;
            start = newStart;
          }
        } else if (isWall(mx, my) && i < FOV_RADIUS) {
          blocked = true;
          castLight(cx, cy, i + 1, start, lSlope, xx, xy, yx, yy);
          newStart = rSlope;
        }
      }
      if (blocked) break;
    }
  }

  function computeFOV() {
    for (let y = 0; y < MAP_H; y++) visible[y].fill(false);
    visible[player.y][player.x] = true;
    explored[player.y][player.x] = true;
    for (const o of OCT) castLight(player.x, player.y, 1, 1.0, 0.0, o[0], o[1], o[2], o[3]);
  }

  // ---- Movement ------------------------------------------------------------
  function canStep(x, y, dx, dy) {
    const nx = x + dx, ny = y + dy;
    if (!passable(nx, ny)) return false;
    if (dx !== 0 && dy !== 0 && isWall(x + dx, y) && isWall(x, y + dy)) return false;
    return true;
  }

  function onEnter() {
    computeFOV();
    if (map[player.y][player.x] === STAIRS) descend();
  }

  function move(dx, dy) {
    walkPath = [];
    if (canStep(player.x, player.y, dx, dy)) {
      player.x += dx;
      player.y += dy;
      onEnter();
    }
  }

  function descend() {
    depth++;
    const label = document.getElementById("depthLabel");
    if (label) label.innerHTML = "Depth&nbsp;" + depth;
    generateLevel();
  }

  // ---- Pathfinding (BFS, 8-direction, only across explored tiles) ---------
  const DIRS8 = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  function findPath(sx, sy, gx, gy) {
    if (!passable(gx, gy) || !explored[gy][gx]) return [];
    if (sx === gx && sy === gy) return [];
    const key = (x, y) => y * MAP_W + x;
    const prev = new Map();
    prev.set(key(sx, sy), null);
    const queue = [[sx, sy]];
    let head = 0;
    while (head < queue.length) {
      const [cx, cy] = queue[head++];
      if (cx === gx && cy === gy) break;
      for (const [dx, dy] of DIRS8) {
        const nx = cx + dx, ny = cy + dy;
        if (!explored[ny] || !explored[ny][nx]) continue;
        if (!canStep(cx, cy, dx, dy)) continue;
        const k = key(nx, ny);
        if (prev.has(k)) continue;
        prev.set(k, [cx, cy]);
        queue.push([nx, ny]);
      }
    }
    if (!prev.has(key(gx, gy))) return [];
    const path = [];
    let cur = [gx, gy];
    while (cur) {
      path.push({ x: cur[0], y: cur[1] });
      cur = prev.get(key(cur[0], cur[1]));
    }
    path.reverse();
    path.shift();
    return path;
  }

  function walkTo(tx, ty) {
    if (!inBounds(tx, ty)) return;
    const path = findPath(player.x, player.y, tx, ty);
    if (path.length) walkPath = path;
  }

  // ---- Canvas, camera & sizing --------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let tile = 26;
  let viewCols = 13, viewRows = 21;
  let camX = 0, camY = 0;
  let dpr = 1;

  const reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const stage = document.getElementById("stage");
    const availW = stage.clientWidth;
    const availH = stage.clientHeight;

    tile = Math.min(38, Math.max(16, Math.floor(availW / 13)));
    viewCols = Math.min(MAP_W, Math.max(5, Math.floor(availW / tile)));
    viewRows = Math.min(MAP_H, Math.max(5, Math.floor(availH / tile)));

    const cssW = viewCols * tile;
    const cssH = viewRows * tile;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function updateCamera() {
    const clamp = (v, max) => Math.max(0, Math.min(max, v));
    camX = clamp(player.x - Math.floor(viewCols / 2), MAP_W - viewCols);
    camY = clamp(player.y - Math.floor(viewRows / 2), MAP_H - viewRows);
  }

  // ---- Colours -------------------------------------------------------------
  const COL = {
    floorA: "#241c12",
    floorB: "#1d160d",
    wallFace: "#33291b",
    wallTop: "#48391f",
  };

  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * amount);
    const g = Math.round(((n >> 8) & 255) * amount);
    const b = Math.round((n & 255) * amount);
    return `rgb(${r},${g},${b})`;
  }

  let flick = 0;
  const MEM = 0.24;                 // brightness of remembered (out-of-sight) tiles
  function litBright(mx, my) {
    const dx = mx - player.x, dy = my - player.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const b = 1 - (d / (FOV_RADIUS + 1)) * 0.6 + flick;
    return Math.max(0.42, Math.min(1, b));
  }

  // ---- Draw ----------------------------------------------------------------
  function draw() {
    updateCamera();
    ctx.fillStyle = "#0c0905";
    ctx.fillRect(0, 0, viewCols * tile, viewRows * tile);

    for (let sy = 0; sy < viewRows; sy++) {
      for (let sx = 0; sx < viewCols; sx++) {
        const mx = camX + sx, my = camY + sy;
        if (!inBounds(mx, my) || !explored[my][mx]) continue;

        const vis = visible[my][mx];
        const b = vis ? litBright(mx, my) : MEM;
        const px = sx * tile, py = sy * tile;
        const t = map[my][mx];

        if (t === WALL) {
          ctx.fillStyle = shade(COL.wallFace, b);
          ctx.fillRect(px, py, tile, tile);
          ctx.fillStyle = shade(COL.wallTop, b);
          ctx.fillRect(px, py, tile, Math.max(2, tile * 0.16));
        } else {
          const base = (mx + my) % 2 === 0 ? COL.floorA : COL.floorB;
          ctx.fillStyle = shade(base, b);
          ctx.fillRect(px + 1, py + 1, tile - 1, tile - 1);
          if (t === STAIRS) {
            const sb = vis ? Math.max(b, 0.85) : MEM + 0.14;
            ctx.fillStyle = shade("#f6b845", sb);
            ctx.font = `700 ${Math.floor(tile * 0.82)}px ${bodyFont()}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(">", px + tile / 2, py + tile / 2 + tile * 0.04);
          }
        }

        // cool tint over remembered tiles so "seen before" reads apart from "seen now"
        if (!vis) {
          ctx.fillStyle = "rgba(70,90,130,0.10)";
          ctx.fillRect(px, py, tile, tile);
        }
      }
    }

    // route markers
    for (const s of walkPath) {
      if (!inBounds(s.x, s.y) || !explored[s.y][s.x]) continue;
      const px = (s.x - camX) * tile, py = (s.y - camY) * tile;
      const sz = tile * 0.22;
      ctx.fillStyle = "rgba(246,184,69,0.16)";
      ctx.fillRect(px + (tile - sz) / 2, py + (tile - sz) / 2, sz, sz);
    }

    // player
    const cx = (player.x - camX) * tile + tile / 2;
    const cy = (player.y - camY) * tile + tile / 2;
    const glow = ctx.createRadialGradient(cx, cy, tile * 0.1, cx, cy, tile * 2.6);
    glow.addColorStop(0, "rgba(246,184,69,0.26)");
    glow.addColorStop(1, "rgba(246,184,69,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - tile * 3, cy - tile * 3, tile * 6, tile * 6);

    ctx.font = `700 ${Math.floor(tile * 0.8)}px ${bodyFont()}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f6b845";
    ctx.fillText("@", cx, cy + tile * 0.04);
    ctx.fillStyle = "#ffd98a";
    ctx.fillText("@", cx, cy + tile * 0.04 - Math.max(1, tile * 0.04));
  }

  let _font = null;
  function bodyFont() {
    if (!_font) _font = getComputedStyle(document.body).fontFamily || "monospace";
    return _font;
  }

  // ---- Main loop -----------------------------------------------------------
  const STEP_MS = 90;
  let lastT = 0, acc = 0;
  function frame(t) {
    if (!lastT) lastT = t;
    const dt = t - lastT;
    lastT = t;

    if (walkPath.length) {
      acc += dt;
      while (acc >= STEP_MS && walkPath.length) {
        acc -= STEP_MS;
        const next = walkPath.shift();
        player.x = next.x;
        player.y = next.y;
        onEnter();               // may descend, which clears walkPath
      }
    } else {
      acc = 0;
    }

    if (!reduceMotion) flick = Math.sin(t / 420) * 0.14 + Math.sin(t / 130) * 0.05;
    draw();
    requestAnimationFrame(frame);
  }

  // ---- Keyboard ------------------------------------------------------------
  const BY_KEY = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    h: [-1, 0], j: [0, 1], k: [0, -1], l: [1, 0],
    y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1],
  };
  const BY_CODE = {
    Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0],
    Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
  };
  window.addEventListener("keydown", (e) => {
    const dir = BY_CODE[e.code] || BY_KEY[e.key] || BY_KEY[(e.key || "").toLowerCase()];
    if (dir) {
      e.preventDefault();
      move(dir[0], dir[1]);
    }
  });

  // ---- Tap / click ---------------------------------------------------------
  function tileAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = Math.floor((clientX - rect.left) / (rect.width / viewCols));
    const sy = Math.floor((clientY - rect.top) / (rect.height / viewRows));
    return [camX + sx, camY + sy];
  }
  canvas.addEventListener("click", (e) => {
    const [tx, ty] = tileAt(e.clientX, e.clientY);
    walkTo(tx, ty);
  });
  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const [tx, ty] = tileAt(t.clientX, t.clientY);
      walkTo(tx, ty);
    },
    { passive: false }
  );

  // ---- Dev hook (harmless; handy for testing/debugging in the console) ----
  window.cantori = {
    descend,
    regenerate: generateLevel,
    peek: () => ({ depth, x: player.x, y: player.y, explored: countExplored() }),
  };
  function countExplored() {
    let c = 0;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (explored[y][x]) c++;
    return c;
  }

  // ---- Go ------------------------------------------------------------------
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();
  generateLevel();
  requestAnimationFrame(frame);
})();
