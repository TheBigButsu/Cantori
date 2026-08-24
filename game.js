/* ============================================================================
   Cantori — Depth 0: "First Light"
   A single torch-lit stone room you can walk around.

   This is the foundation. It proves the whole pipeline works on a real phone:
   a tiled dungeon, a character, touch + keyboard controls, and a light radius
   that previews the fog-of-war coming at Depth 1. Everything else gets built
   on top of this.
   ========================================================================== */

(function () {
  "use strict";

  // ---- The room ------------------------------------------------------------
  // Built as a grid: a walled border with a few pillars to walk around.
  const COLS = 15;
  const ROWS = 21;

  const WALL = 1;
  const FLOOR = 0;

  // 2x2 pillar blocks scattered through the room (top-left corner of each).
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

  // ---- The player ----------------------------------------------------------
  const player = { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };
  // nudge off a pillar if we happened to land on one
  while (isWall(player.x, player.y)) player.y++;

  function tryMove(dx, dy) {
    const nx = player.x + dx, ny = player.y + dy;
    if (!isWall(nx, ny)) {
      player.x = nx;
      player.y = ny;
    }
  }

  // ---- Canvas & responsive sizing -----------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let tile = 24;           // pixel size of one tile (recomputed on resize)
  let dpr = 1;

  const reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const stage = document.getElementById("stage");
    const availW = stage.clientWidth;
    const availH = stage.clientHeight;
    // largest whole-pixel tile that fits the board in the available space
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

  // ---- Torch light ---------------------------------------------------------
  // Brightness falls off with distance from the player. This is a preview of
  // the real fog-of-war we build at Depth 1.
  let flick = 0;
  function lightAt(x, y) {
    const dx = x - player.x, dy = y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radius = 4.4 + flick;      // tiles the torch reaches
    const soft = 2.2;                // fade width
    let b = 1 - (dist - (radius - soft)) / soft;
    b = Math.max(0.06, Math.min(1, b));
    return b;
  }

  function shade(hex, amount) {
    // amount 0..1 scales an #rrggbb toward black
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
          // lit top edge for a little depth
          ctx.fillStyle = shade(COL.wallTop, b);
          ctx.fillRect(px, py, tile, Math.max(2, tile * 0.18));
        } else {
          const base = (x + y) % 2 === 0 ? COL.floorA : COL.floorB;
          ctx.fillStyle = shade(base, b);
          ctx.fillRect(px + 1, py + 1, tile - 1, tile - 1);
        }
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

  // ---- Main loop (only for the gentle torch flicker) -----------------------
  function frame(t) {
    if (!reduceMotion) {
      flick = Math.sin(t / 420) * 0.16 + Math.sin(t / 130) * 0.06;
    }
    draw();
    requestAnimationFrame(frame);
  }

  // ---- Input: keyboard -----------------------------------------------------
  const KEYS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
  };
  window.addEventListener("keydown", (e) => {
    const move = KEYS[e.key];
    if (move) {
      e.preventDefault();
      tryMove(move[0], move[1]);
    }
  });

  // ---- Input: tap / click (step one tile toward the tapped point) ---------
  function stepToward(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const tx = Math.floor((clientX - rect.left) / (rect.width / COLS));
    const ty = Math.floor((clientY - rect.top) / (rect.height / ROWS));
    const dx = tx - player.x;
    const dy = ty - player.y;
    if (dx === 0 && dy === 0) return;
    // move along the dominant axis first — reads as walking toward the tap
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (!tryMoveStep(Math.sign(dx), 0)) tryMoveStep(0, Math.sign(dy));
    } else {
      if (!tryMoveStep(0, Math.sign(dy))) tryMoveStep(Math.sign(dx), 0);
    }
  }
  function tryMoveStep(dx, dy) {
    if (dx === 0 && dy === 0) return false;
    const nx = player.x + dx, ny = player.y + dy;
    if (!isWall(nx, ny)) { player.x = nx; player.y = ny; return true; }
    return false;
  }

  canvas.addEventListener("click", (e) => stepToward(e.clientX, e.clientY));
  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      stepToward(t.clientX, t.clientY);
    },
    { passive: false }
  );

  // ---- Go ------------------------------------------------------------------
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();
  requestAnimationFrame(frame);
})();
