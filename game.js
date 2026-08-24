/* ============================================================================
   Cantori — Depth 0: "First Light"
   A single torch-lit stone room you can walk around.

   Controls:
     - Tap / click anywhere  -> the character finds a route and walks there,
                                 around pillars, diagonals included.
     - Keyboard: arrows / WASD (orthogonal), plus 8-direction keys:
                 vi-keys  y u b n  and the numpad.

   This is the foundation. Everything else — real dungeons, monsters, loot —
   gets built on top of it.
   ========================================================================== */

(function () {
  "use strict";

  // ---- The room ------------------------------------------------------------
  const COLS = 15;
  const ROWS = 21;

  const WALL = 1;
  const FLOOR = 0;

  // 2x2 pillar blocks (top-left corner of each) to walk around.
  const PILLARS = [
    [3, 4], [10, 4],
    [3, 12], [10, 12],
    [6, 8],
  ];

  function buildRoom() {
    const grid = [];
    for (let y = 0; y < ROWS; y++) {
      const row = [];
      for (let x = 0; x < COLS; x++) {
        const border = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
        row.push(border ? WALL : FLOOR);
      }
      grid.push(row);
    }
    for (const [px, py] of PILLARS) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = px + dx, y = py + dy;
          if (grid[y] && grid[y][x] !== undefined) grid[y][x] = WALL;
        }
      }
    }
    return grid;
  }

  const map = buildRoom();
  const isWall = (x, y) =>
    x < 0 || y < 0 || x >= COLS || y >= ROWS || map[y][x] === WALL;
  const passable = (x, y) => !isWall(x, y);

  // A single step (dx, dy) is legal if the destination is open and — for
  // diagonals — we're not squeezing through a gap between two wall corners.
  function canStep(x, y, dx, dy) {
    const nx = x + dx, ny = y + dy;
    if (!passable(nx, ny)) return false;
    if (dx !== 0 && dy !== 0 && isWall(x + dx, y) && isWall(x, y + dy)) return false;
    return true;
  }

  // ---- The player ----------------------------------------------------------
  const player = { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };
  while (isWall(player.x, player.y)) player.y++;

  let walkPath = [];   // queued tiles the player is auto-walking through

  function move(dx, dy) {
    // manual move — cancels any auto-walk in progress
    walkPath = [];
    if (canStep(player.x, player.y, dx, dy)) {
      player.x += dx;
      player.y += dy;
    }
  }

  // ---- Pathfinding (breadth-first, 8-direction) ---------------------------
  const DIRS8 = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  function findPath(sx, sy, gx, gy) {
    if (!passable(gx, gy) || (sx === gx && sy === gy)) return [];
    const key = (x, y) => y * COLS + x;
    const prev = new Map();
    prev.set(key(sx, sy), null);
    const queue = [[sx, sy]];
    let head = 0;
    while (head < queue.length) {
      const [cx, cy] = queue[head++];
      if (cx === gx && cy === gy) break;
      for (const [dx, dy] of DIRS8) {
        if (!canStep(cx, cy, dx, dy)) continue;
        const nx = cx + dx, ny = cy + dy, k = key(nx, ny);
        if (prev.has(k)) continue;
        prev.set(k, [cx, cy]);
        queue.push([nx, ny]);
      }
    }
    if (!prev.has(key(gx, gy))) return [];   // unreachable
    const path = [];
    let cur = [gx, gy];
    while (cur) {
      path.push({ x: cur[0], y: cur[1] });
      cur = prev.get(key(cur[0], cur[1]));
    }
    path.reverse();
    path.shift();                             // drop the starting tile
    return path;
  }

  function walkTo(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return;
    const path = findPath(player.x, player.y, tx, ty);
    if (path.length) walkPath = path;         // retarget; ignore taps on walls
  }

  // ---- Canvas & responsive sizing -----------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let tile = 24;
  let dpr = 1;

  const reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const stage = document.getElementById("stage");
    const availW = stage.clientWidth;
    const availH = stage.clientHeight;
    tile = Math.max(8, Math.floor(Math.min(availW / COLS, availH / ROWS)));

    const cssW = tile * COLS;
    const cssH = tile * ROWS;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- Colours -------------------------------------------------------------
  const COL = {
    floorA: "#211a11",
    floorB: "#1b150d",
    wallTop: "#3a2f1d",
    wallFace: "#2a2114",
    grout: "#120d07",
    player: "#f6b845",
    playerCore: "#ffd98a",
  };

  // ---- Torch light (a preview of Depth 1's fog-of-war) --------------------
  let flick = 0;
  function lightAt(x, y) {
    const dx = x - player.x, dy = y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radius = 4.4 + flick;
    const soft = 2.2;
    let b = 1 - (dist - (radius - soft)) / soft;
    return Math.max(0.06, Math.min(1, b));
  }

  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * amount);
    const g = Math.round(((n >> 8) & 255) * amount);
    const b = Math.round((n & 255) * amount);
    return `rgb(${r},${g},${b})`;
  }

  // ---- Draw ----------------------------------------------------------------
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = COL.grout;
    ctx.fillRect(0, 0, COLS * tile, ROWS * tile);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const b = lightAt(x, y);
        const px = x * tile, py = y * tile;
        if (map[y][x] === WALL) {
          ctx.fillStyle = shade(COL.wallFace, b);
          ctx.fillRect(px, py, tile, tile);
          ctx.fillStyle = shade(COL.wallTop, b);
          ctx.fillRect(px, py, tile, Math.max(2, tile * 0.18));
        } else {
          const base = (x + y) % 2 === 0 ? COL.floorA : COL.floorB;
          ctx.fillStyle = shade(base, b);
          ctx.fillRect(px + 1, py + 1, tile - 1, tile - 1);
        }
      }
    }

    // faint markers along the route we're about to walk
    if (walkPath.length) {
      for (const step of walkPath) {
        const b = lightAt(step.x, step.y);
        if (b <= 0.08) continue;
        ctx.fillStyle = `rgba(246,184,69,${0.14 * b})`;
        const s = tile * 0.24;
        ctx.fillRect(
          step.x * tile + (tile - s) / 2,
          step.y * tile + (tile - s) / 2,
          s, s
        );
      }
    }

    // player: a glowing amber '@'
    const cx = player.x * tile + tile / 2;
    const cy = player.y * tile + tile / 2;
    const glow = ctx.createRadialGradient(cx, cy, tile * 0.1, cx, cy, tile * 2.6);
    glow.addColorStop(0, "rgba(246,184,69,0.28)");
    glow.addColorStop(1, "rgba(246,184,69,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - tile * 3, cy - tile * 3, tile * 6, tile * 6);

    ctx.fillStyle = COL.player;
    ctx.font = `700 ${Math.floor(tile * 0.8)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("@", cx, cy + tile * 0.04);
    ctx.fillStyle = COL.playerCore;
    ctx.fillText("@", cx, cy + tile * 0.04 - Math.max(1, tile * 0.04));
  }

  // ---- Main loop: advance auto-walk + gentle torch flicker ----------------
  const STEP_MS = 90;   // time between auto-walk steps
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
      }
    } else {
      acc = 0;
    }

    if (!reduceMotion) {
      flick = Math.sin(t / 420) * 0.16 + Math.sin(t / 130) * 0.06;
    }
    draw();
    requestAnimationFrame(frame);
  }

  // ---- Input: keyboard (8 directions) -------------------------------------
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

  // ---- Input: tap / click (walk a full route to the tapped tile) ----------
  function tileAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return [
      Math.floor((clientX - rect.left) / (rect.width / COLS)),
      Math.floor((clientY - rect.top) / (rect.height / ROWS)),
    ];
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

  // ---- Go ------------------------------------------------------------------
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();
  requestAnimationFrame(frame);
})();
