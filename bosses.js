/* ============================================================================
   Cantori — BOSS PLAYBOOKS (module 2 of the game.js split)
   ----------------------------------------------------------------------------
   Everything a boss does on its own turn, plus the registry that dispatches to
   it. Adding a boss is a data.js row (name/hp/atk + whatever a playbook wants
   to read — the whole row survives makeBoss in game.js) and one entry here.
   game.js contains no per-boss `if (m.type === …)` branch; it calls the
   generic hooks below and lets PLAYBOOKS decide who, if anyone, answers.

   Everything this module touches (the map, the monster list, whether the run
   is over) is handed in as deps rather than closed over directly —
   map/monsters/dead are reassigned wholesale on every level generation, so a
   value captured at construction would go stale the moment floor 2 loads.
   Pass accessors for those three; everything else (functions, and player/gear
   which are only mutated) is a plain reference.

   Usage (from game.js):
     const _boss = window.CantoriBosses({ getMap: () => map, ... });
     if (m.type === "healing_node") return;                 // still special: never acts
     const pb = _boss.playbookFor(m.type);
     if (pb && pb.act) { pb.act(m); return; }
     defaultAct(m);                                          // no playbook → ordinary monster AI
     ...
     dmg = _boss.damageIn(target, dmg);                      // attack(): shields etc.
     _boss.onKill(target);                                   // killMonster(): adds dying, etc.
     _boss.onSpawn(bossMonster);                              // spawnBoss(): phase state, arena setup
     _boss.tick();                                            // worldTurn(): delayed effects
     _boss.reset();                                           // generateLevel()/generateShopLevel()

   See docs/BOSSES.md for the playbook interface and a worked example.
   ========================================================================== */
window.CantoriBosses = function (deps) {
  "use strict";
  const WALL = deps.WALL, attack = deps.attack, canSee = deps.canSee, chaseLastSeen = deps.chaseLastSeen,
    cheb = deps.cheb, computeFOV = deps.computeFOV, isDead = deps.isDead, die = deps.die,
    flash = deps.flash, flashScreen = deps.flashScreen, floatText = deps.floatText, inBounds = deps.inBounds,
    lineOfSight = deps.lineOfSight, log = deps.log, getMap = deps.getMap, monsterAt = deps.monsterAt,
    getMonsters = deps.getMonsters, patrolStep = deps.patrolStep, player = deps.player, randInt = deps.randInt,
    sayMonster = deps.sayMonster, shuns = deps.shuns, snapEntity = deps.snapEntity, snapPlayer = deps.snapPlayer,
    spawnBurst = deps.spawnBurst, spawnNear = deps.spawnNear, spawnProjectile = deps.spawnProjectile,
    spawnStreak = deps.spawnStreak, startHunting = deps.startHunting, stepMonsterTo = deps.stepMonsterTo, tileProp = deps.tileProp,
    updateHUD = deps.updateHUD, normalAct = deps.normalAct;

  // ---- The Pied Piper (forest boss) ---------------------------------------
  function piperAct(m) {
    if (m.beam) { piperFireBeam(m); return; }        // fire the line telegraphed last turn
    const see = canSee(m);
    if (see) startHunting(m);
    // Entrance: the first time it sees you, it calls vermin to your side.
    if (see && !m.summoned) {
      m.summoned = true;
      spawnNear("rat", player.x, player.y, 3, 2);
      spawnNear("snake", player.x, player.y, 3, 1);
      flashScreen("#7a1e1e", 320);
      sayMonster(m, "Friends, friends everywhere", "#e07aa0");
      log("The Piper's shrill tune summons vermin around you!", "hurt");
      return;
    }
    // Halfway: vanish (up to 10 tiles) and leave a brood behind.
    if (!m.phased && m.hp <= m.maxHp * 0.5) { m.phased = true; piperPhaseShift(m); return; }
    const d = cheb(m.x, m.y, player.x, player.y);
    // Signature attack: telegraph a straight line, then send an exploding rat down it.
    if ((m.beamCd | 0) <= 0 && see && d >= 2 && lineOfSight(m.x, m.y, player.x, player.y)) {
      piperCastBeam(m); m.beamCd = 7; return;
    }
    if (m.beamCd > 0) m.beamCd--;
    if (d === 1) { attack(m, player); return; }
    if (see) { stepMonsterTo(m, player.x, player.y); return; }
    if (m.target) { chaseLastSeen(m); return; }
    patrolStep(m);
  }
  function piperPhaseShift(m) {
    const ox = m.x, oy = m.y;
    let best = null, bestScore = -1;
    for (let t = 0; t < 300; t++) {
      const x = m.x + randInt(-10, 10), y = m.y + randInt(-10, 10);
      if (!inBounds(x, y) || tileProp(x, y, "solid") || shuns(x, y)) continue;
      const dd = cheb(x, y, m.x, m.y);
      if (dd < 3 || dd > 10) continue;
      if (monsterAt(x, y) || (x === player.x && y === player.y)) continue;
      const score = cheb(x, y, player.x, player.y);   // prefer landing far from the player
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    spawnBurst(ox, oy, "#c79bff");
    if (best) { m.x = best.x; m.y = best.y; snapEntity(m); }
    spawnBurst(m.x, m.y, "#c79bff"); flashScreen("#7a4fb0", 380);
    spawnNear("rat", ox, oy, 2, 3);
    spawnNear("snake", ox, oy, 2, 2);
    startHunting(m);
    log("The Piper vanishes in a swirl, leaving its brood behind!", "hurt");
  }
  // Build a straight line through the player's tile (wall to wall) and mark it red.
  function piperCastBeam(m) {
    const dx = player.x - m.x, dy = player.y - m.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    let dir;
    if (adx === 0 && ady === 0) dir = [1, 0];
    else if (adx >= 2 * ady) dir = [Math.sign(dx), 0];
    else if (ady >= 2 * adx) dir = [0, Math.sign(dy)];
    else dir = [Math.sign(dx) || 1, Math.sign(dy) || 1];
    const map = getMap();
    const pass = (x, y) => inBounds(x, y) && map[y][x] !== WALL;
    let sx = player.x, sy = player.y;                 // back up to the piper-side wall
    while (pass(sx - dir[0], sy - dir[1])) { sx -= dir[0]; sy -= dir[1]; }
    const tiles = [];
    for (let x = sx, y = sy; pass(x, y); x += dir[0], y += dir[1]) tiles.push([x, y]);
    m.beam = { dir, tiles };
    flashScreen("#c02020", 300);                      // a sharp red pulse — impossible to miss
    floatText(player.x, player.y, "⚠", "#ff5a5a");
    sayMonster(m, "Dance for me", "#ff6a6a");
    log("The Piper marks a line of death — MOVE off it!", "hurt");
  }
  function piperFireBeam(m) {
    const line = m.beam.tiles; m.beam = null;         // the red line clears as the rat launches
    const start = line[0];
    let hitIdx = -1;
    for (let i = 0; i < line.length; i++) if (line[i][0] === player.x && line[i][1] === player.y) { hitIdx = i; break; }
    const end = line[hitIdx >= 0 ? hitIdx : line.length - 1];
    spawnProjectile(start[0], start[1], end[0], end[1], "#e0685a");
    spawnBurst(end[0], end[1], "#ff6a4a");
    if (hitIdx >= 0) {
      const dmg = 30;
      player.hp -= dmg; flash(player); floatText(player.x, player.y, "-" + dmg, "#ff5a5a");
      log("The exploding rat slams into you! (-" + dmg + ")", "hurt");
      updateHUD();
      if (player.hp <= 0) { die(); return; }
    } else {
      spawnNear("rat", end[0], end[1], 1, 2);         // bursts on the wall, two rats spill out
      log("You dodge! The rat bursts on the wall — two more scurry out.", "hit");
    }
  }

  // ---- The Stone Golem (boss) ------------------------------------------------
  // Live Healing Nodes shield the golem: -10 incoming damage per node (wrapped
  // as golemDamageIn below for the registry; golemShield itself keeps this bare
  // signature because the dev hook calls it directly — grep `golemShield:`).
  // Killing a node arms a delayed 5x5 blast at its spot — pendingNodeBlasts,
  // ticked in worldTurn like the bomb trap's fuse.
  const golemShield = (g) => 10 * getMonsters().filter((x) => x.type === "healing_node" && x.hp > 0).length;
  function golemDamageIn(target, dmg) { return Math.max(1, dmg - golemShield(target)); }
  let pendingNodeBlasts = [];
  function golemAct(m) {
    if (m.windup) { golemResolveWindup(m); return; }
    const see = canSee(m);
    if (see) startHunting(m);
    if (m.slamCd > 0) m.slamCd--;
    // Healing-node respawn timer — only once the golem has phased below 50%.
    if (m.phased) {
      m.nodeCd = (m.nodeCd == null) ? randInt(20, 30) : m.nodeCd - 1;
      if (m.nodeCd <= 0) {
        m.nodeCd = randInt(20, 30);
        const live = getMonsters().filter((x) => x.type === "healing_node" && x.hp > 0).length;
        if (live < 2 && spawnNear("healing_node", m.x, m.y, 6, 1)) {
          log("The Golem calls forth another stone guardian.", "hurt");
        }
      }
    }
    // Phase shift at 50% HP: knockback, maybe stun, and a pair of healing nodes — once.
    if (!m.phased && m.hp <= m.maxHp * 0.5) { m.phased = true; golemPhaseShift(m); return; }
    const d = cheb(m.x, m.y, player.x, player.y);
    if (see && (m.slamCd | 0) <= 0 && d >= 2 && d <= 5) { golemBeginSlam(m); return; }
    if (see && d >= 3 && lineOfSight(m.x, m.y, player.x, player.y) && Math.random() < 0.5) { golemBeginBoulder(m); return; }
    if (d === 1) { attack(m, player); return; }
    if (see) { stepMonsterTo(m, player.x, player.y); return; }
    if (m.target) { chaseLastSeen(m); return; }
    patrolStep(m);
  }
  function golemResolveWindup(m) {
    const w = m.windup;
    w.turns--;
    if (w.turns > 0) return;   // still telegraphing this turn — the golem takes no other action
    m.windup = null;
    if (w.kind === "boulder") golemFireBoulder(m, w); else golemFireSlam(m, w);
  }
  // Boulder Throw: 1-turn telegraph, then a straight rolling boulder to the
  // first wall or the player, exploding in a 3×3 for 15–30.
  function golemBeginBoulder(m) {
    const dx = Math.sign(player.x - m.x) || 1, dy = Math.sign(player.y - m.y) || 0;
    m.windup = { kind: "boulder", turns: 1, dx, dy };
    floatText(m.x, m.y, "⚠", "#c9a24a");
    sayMonster(m, "Grrrhh...", "#c9a24a");
    log("The Golem hefts a boulder overhead!", "hurt");
  }
  function golemFireBoulder(m, w) {
    const map = getMap();
    const pass = (x, y) => inBounds(x, y) && map[y][x] !== WALL;
    let x = m.x, y = m.y;
    for (let i = 0; i < 24; i++) {
      const nx = x + w.dx, ny = y + w.dy;
      if (!pass(nx, ny)) break;
      x = nx; y = ny;
      if (x === player.x && y === player.y) break;   // collides with the player early
    }
    spawnProjectile(m.x, m.y, x, y, "#9a8264");
    spawnStreak(m.x, m.y, x, y, "#9a8264", 260);
    spawnBurst(x, y, "#c9a24a");
    let hit = false;
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
      if (!inBounds(xx, yy)) continue;
      floatText(xx, yy, "✸", "#c9a24a");
      if (xx === player.x && yy === player.y) hit = true;
    }
    if (hit) {
      const dmg = randInt(15, 30);
      player.hp -= dmg; flash(player); floatText(player.x, player.y, "-" + dmg, "#ff8f84");
      log("The boulder slams down — you're caught in the blast! (-" + dmg + ")", "hurt");
      updateHUD();
      if (player.hp <= 0) die();
    } else {
      log("The boulder crashes into the ground nearby.");
    }
  }
  // Ground Slam: a 2-turn telegraph (the golem stays fully attackable meanwhile),
  // then a forward cone 3→5→7 tiles wide over 3 rows, 20–60 damage, 10-turn CD.
  function golemConeTiles(gx, gy, dx, dy) {
    const tiles = [];
    for (let r = 1; r <= 3; r++) {
      const half = r;                          // width 2r+1 → 3, 5, 7
      const fx = gx + dx * r, fy = gy + dy * r;
      for (let w = -half; w <= half; w++) {
        const tx = dx !== 0 ? fx : fx + w;
        const ty = dx !== 0 ? fy + w : fy;
        if (inBounds(tx, ty)) tiles.push([tx, ty]);
      }
    }
    return tiles;
  }
  function golemBeginSlam(m) {
    let dx = Math.sign(player.x - m.x), dy = Math.sign(player.y - m.y);
    if (Math.abs(player.x - m.x) >= Math.abs(player.y - m.y)) { dx = dx || 1; dy = 0; } else { dy = dy || 1; dx = 0; }
    const tiles = golemConeTiles(m.x, m.y, dx, dy);
    m.windup = { kind: "slam", turns: 2, dx, dy, tiles };
    flashScreen("#7a5a2e", 260);
    sayMonster(m, "BRACE!", "#e0a848");
    log("The Golem plants its feet and winds up a ground slam!", "hurt");
  }
  function golemFireSlam(m, w) {
    for (const [x, y] of w.tiles) floatText(x, y, "▨", "#e0a848");
    flashScreen("#5a3e1e", 300);
    m.slamCd = 10;
    const hit = w.tiles.some(([x, y]) => x === player.x && y === player.y);
    if (hit) {
      const dmg = randInt(20, 60);
      player.hp -= dmg; flash(player); floatText(player.x, player.y, "-" + dmg, "#ff5a5a");
      log("The ground slam catches you! (-" + dmg + ")", "hurt");
      updateHUD();
      if (player.hp <= 0) die();
    } else {
      log("You dodge clear of the ground slam.", "hit");
    }
  }
  // Phase shift at 50% HP: knock the player back (up to 5 tiles, stopping at a
  // wall — a wall stop stuns 1–3 turns), then call two Healing Nodes to its side.
  function golemPhaseShift(m) {
    const map = getMap();
    const dx = Math.sign(player.x - m.x) || 1, dy = Math.sign(player.y - m.y) || 0;
    let x = player.x, y = player.y, moved = 0, hitWall = false;
    for (let i = 0; i < 5; i++) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny) || map[ny][nx] === WALL) { hitWall = true; break; }
      x = nx; y = ny; moved++;
    }
    if (moved > 0) { player.x = x; player.y = y; computeFOV(); snapPlayer(); }
    spawnBurst(player.x, player.y, "#9a8a6a"); flashScreen("#4a3a20", 300);
    if (hitWall) {
      const stun = randInt(1, 3);
      player.stun = (player.stun || 0) + stun;
      floatText(player.x, player.y, "STUNNED", "#e0a848");
      log("You're slammed into the wall and stunned for " + stun + " turns!", "hurt");
    } else {
      log("The Golem's backhand sends you reeling!", "hurt");
    }
    sayMonster(m, "RRAAAGH!", "#e0685a");
    spawnNear("healing_node", m.x, m.y, 6, 2);
    log("Cracks split the Golem's hide — it calls stone guardians to its side!", "hurt");
    updateHUD();
  }
  // A Healing Node's death arms a 1-turn-telegraphed 5×5 blast at its spot:
  // 0–20 damage to the player if they're caught in it, healing the golem by
  // exactly the damage actually dealt (0 if the player dodges clear).
  function golemNodeDeath(node) {
    // turns:2 so it survives the tickNodeBlasts() call inside THIS same action
    // (2→1) and only resolves on the player's next action (1→0) — a genuine
    // 1-turn warning, not an instant same-action blast.
    pendingNodeBlasts.push({ x: node.x, y: node.y, turns: 2 });
    floatText(node.x, node.y, "⚠", "#ff8f4a");
    log("The Healing Node cracks — it's about to burst!", "hurt");
  }
  function tickNodeBlasts() {
    if (!pendingNodeBlasts.length) return;
    for (const b of pendingNodeBlasts.slice()) {
      if (--b.turns > 0) continue;
      pendingNodeBlasts = pendingNodeBlasts.filter((x) => x !== b);
      spawnBurst(b.x, b.y, "#ff8f4a"); flashScreen("#7a2e1e", 220);
      for (let yy = b.y - 2; yy <= b.y + 2; yy++) for (let xx = b.x - 2; xx <= b.x + 2; xx++) {
        if (inBounds(xx, yy)) floatText(xx, yy, "✸", "#ffb26a");
      }
      const inBlast = cheb(player.x, player.y, b.x, b.y) <= 2;
      const dmg = inBlast ? randInt(0, 20) : 0;
      if (dmg > 0) {
        player.hp -= dmg; flash(player); floatText(player.x, player.y, "-" + dmg, "#ff8f84");
        log("The node explodes — you're caught in it! (-" + dmg + ")", "hurt");
        updateHUD();
      } else if (inBlast) {
        log("The node bursts, but you're clear of the worst of it.");
      }
      const golem = getMonsters().find((x) => x.type === "golem" && x.hp > 0);
      if (golem && dmg > 0) {
        const heal = Math.min(golem.maxHp - golem.hp, dmg);
        if (heal > 0) { golem.hp += heal; floatText(golem.x, golem.y, "+" + heal, "#8ed69a"); }
      }
      if (isDead()) return;
    }
  }

  // ---- Placeholder bosses: no bespoke behaviour yet, just proving the wiring —
  // a data.js row + this one line is all a new boss needs. See docs/BOSSES.md.
  function mummyAct(m) { normalAct(m); }

  // ---- The registry --------------------------------------------------------
  // Keyed by the data.js boss key. Every field is optional; game.js calls the
  // four generic hooks below (playbookFor/damageIn/onKill/tick, plus onSpawn)
  // and never checks m.type itself. See docs/BOSSES.md for the full interface.
  const PLAYBOOKS = {
    piper: { act: piperAct },
    golem: { act: golemAct, onKill: golemNodeDeath, damageIn: golemDamageIn, tick: tickNodeBlasts },
    mummy: { act: mummyAct },
  };
  function playbookFor(type) { return PLAYBOOKS[type] || null; }
  // attack(): returns dmg unchanged when the target's boss (if any) has no shield.
  function damageIn(target, dmg) {
    const pb = playbookFor(target.type);
    return (pb && pb.damageIn) ? pb.damageIn(target, dmg) : dmg;
  }
  // killMonster(): called for every death, not just a boss's own. Dispatches to
  // whichever live boss on the floor wants to react (e.g. the Golem to a node).
  function onKill(target) {
    for (const m of getMonsters()) {
      if (!m.boss) continue;
      const pb = playbookFor(m.type);
      if (pb && pb.onKill) pb.onKill(target);
    }
  }
  // spawnBoss(): fires once, right after a boss is placed on its floor.
  function onSpawn(m) {
    const pb = playbookFor(m.type);
    if (pb && pb.onSpawn) pb.onSpawn(m);
  }
  // worldTurn(): every registered tick runs every turn — cheap no-ops (like
  // tickNodeBlasts on a floor with no nodes) are fine to call unconditionally.
  function tick() {
    for (const key in PLAYBOOKS) { const pb = PLAYBOOKS[key]; if (pb.tick) pb.tick(); }
  }
  // Place a monster near (x, y) as a boss's add, flagged `summoned` for
  // peek().mlist and anything else that cares. Reuses spawnNear's placement —
  // it doesn't set the flag itself, so mark whatever it actually placed.
  function summon(type, x, y, opts) {
    opts = opts || {};
    const radius = opts.radius != null ? opts.radius : 3;
    const count = opts.count != null ? opts.count : 1;
    const before = getMonsters().length;
    const placed = spawnNear(type, x, y, radius, count);
    if (placed > 0) {
      const list = getMonsters();
      for (let i = before; i < list.length; i++) list[i].summoned = true;
    }
    return placed;
  }
  function reset() { pendingNodeBlasts = []; }
  function nodeBlasts() { return pendingNodeBlasts.map((b) => Object.assign({}, b)); }

  return {
    playbookFor, damageIn, onKill, onSpawn, tick, summon, reset, nodeBlasts,
    golemShield, golemNodeDeath, piperAct, golemAct, tickNodeBlasts,
  };
};
