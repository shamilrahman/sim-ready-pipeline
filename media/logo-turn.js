/*!
 * logo-turn.js — v3 loading animation: the mark as a four-dial lock.
 *
 * "my logo.svg" is four tiles on a 2x2 grid, but only two shapes, twice each:
 *
 *   D       a square whose whole left side is a semicircle
 *   corner  a square with one corner cut by a quarter circle
 *
 * Every arc is struck at a radius of exactly half the tile, centred on that
 * tile's own centre. The two D's sit on the top-left / bottom-right diagonal
 * facing out, the two cut corners on the other diagonal pointing out, so the
 * mark reads as itself under a half turn and not under a quarter turn. That
 * 2-fold symmetry is the whole mechanism:
 *
 *   turn   one or two tiles quarter-turn in place, swinging the round round
 *   orbit  all four swing a HALF turn about the centre, staying upright — a
 *          quarter would land a D in a corner tile's slot, where no amount of
 *          turning could ever make it fit
 *
 * The scramble is a random walk of those moves away from the mark, so replaying
 * it backwards always solves — there is no solver to get stuck. The loop opens
 * and closes on the finished mark, so the wrap falls inside a still moment and
 * never reads as a cut.
 *
 *   <canvas id="loader" style="width:200px;height:200px"></canvas>
 *   <script src="logo-turn.js"></script>
 *   <script>LogoTurn.mount(document.getElementById('loader'));</script>
 *
 * mount(canvas, opts) -> { stop(), recolour(opts) }
 *   duration   ms per loop                       (default 5000)
 *   seed       which scramble to solve           (default SEED)
 *   theme      'ink' | 'chalk'                   (default 'ink')
 *   base       tile colour, overrides theme      (shadow/highlight derived)
 *   guide      draw the orbit ring and footprints(default true)
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------- geometry --
  // Ratios taken straight off the SVG: tile 22.04, gutter 4.95, every radius
  // 11.02. Normalised so one tile is 1 unit wide.
  var GUTTER = 0.2246;                       // 4.951 / 22.039
  var PITCH = 0.5 + GUTTER / 2;              // tile centre offset from origin
  var ORBIT_R = Math.SQRT2 * PITCH;          // radius the four centres sit on
  var QUARTER = Math.PI / 2;
  var SLOT_0 = Math.PI * 0.75;               // slot 0 (top-left) is at 135 deg
  var ARC_SEG = 10;                          // segments per quarter of arc

  // Slots run clockwise from the top-left: 0 TL, 1 TR, 2 BR, 3 BL.
  // Even slots take a D, odd slots take a cut corner — which is why an orbit
  // has to be a half turn, and why NEED_SPIN only ever holds 0 or 2.
  var TYPE      = ['d', 'c', 'd', 'c'];      // the shape tile i is
  var HOME_SPIN = [0, 0, 2, 2];              // and the way it faces at home
  var NEED_SPIN = [0, 0, 2, 2];              // what each SLOT needs to look right

  function slotAngle(k) { return SLOT_0 - k * QUARTER; }

  // ---------------------------------------------------------- timeline --
  var T_HOLD = 0.055, T_RISE = 0.140, T_JUMBLE = 0.265,
      T_SOLVE = 0.320, T_SOLVED = 0.865, T_FLAT = 0.945;

  var PHASES = [
    { a: 0.000,    b: T_HOLD,   kind: 'hold',      name: 'Hold — the mark',  what: 'The finished logo, flat and front-on — the loop point' },
    { a: T_HOLD,   b: T_RISE,   kind: 'transform', name: 'Extrude + tilt',   what: 'Tiles gain depth, camera tips in' },
    { a: T_RISE,   b: T_JUMBLE, kind: 'scatter',   name: 'Break',            what: 'The dials are set — both D’s, then both cut corners' },
    { a: T_JUMBLE, b: T_SOLVE,  kind: 'hold',      name: 'Hold — scrambled', what: 'The lock, before the first move' },
    { a: T_SOLVE,  b: T_SOLVED, kind: 'solve',     name: 'Solve',            what: 'Half turns and quarter turns, tiles locking as they come home' },
    { a: T_SOLVED, b: T_FLAT,   kind: 'transform', name: 'Flatten + untilt', what: 'Prisms collapse, camera returns to front' },
    { a: T_FLAT,   b: 1.000,    kind: 'hold',      name: 'Hold — the mark',  what: 'Runs straight into the opening frame' }
  ];

  var ROUNDS = 9, MAX_PARALLEL = 2, SEED = 36;
  var MOVE_FRAC = 0.72, MOVE_FRAC_ORBIT = 0.94;   // a half turn needs the room
  var YAW_AMP = 19 * Math.PI / 180, PITCH_AMP = 16 * Math.PI / 180,
      PITCH_WOB = 4 * Math.PI / 180;
  // Tiles extrude to a slab, not a cube: the mark is a flat thing, and depth
  // swung out by the yaw is what decides how much canvas the loop needs.
  var CAM_DIST = 20, FLAT_DEPTH = 0.030, DEPTH = 0.62, FOCAL = 0.315, ZOOM_3D = 0.83;
  var LIFT_TURN = 0.16, LIFT_ORBIT = 0.22, LIFT_SCATTER = 0.36;
  // The ring has to open before it can turn. Tiles orbit without spinning, so
  // wherever the ring sits an odd multiple of 45 degrees off the axes, two
  // upright squares foul unless the radius grows by at least 0.155. Tying the
  // bloom to that misalignment opens the ring exactly when it is needed and
  // closes it again as the ring passes through square.
  var BLOOM_ORBIT = 0.22, BLOOM_SCATTER = 0.10;
  var POP = 0.030, POP_SCALE = 0.10;

  // Near-black is the mark's own ink; chalk is the same loader for dark grounds.
  var THEMES = {
    ink:   { base: '#231F20', shadow: '#0B090A', highlight: '#6E6769' },
    chalk: { base: '#F4F2F7', shadow: '#8B8596', highlight: '#FFFFFF' }
  };

  // ------------------------------------------------------------ easing --
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function smoothstep(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
  function smootherstep(x) {
    x = clamp01(x); return x * x * x * (x * (6 * x - 15) + 10);
  }
  function easeInOutCubic(x) {
    x = clamp01(x);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
  function lerp(a, b, u) { return a + (b - a) * u; }

  /** Signed quarter turns from a to b, taking the short way round. */
  function shortestQ(a, b) {
    var d = (((b - a) % 4) + 4) % 4;
    return d === 3 ? -1 : d;
  }

  // --------------------------------------------------------------- rng --
  function Rng(seed) { this.s = (seed >>> 0) || 0x9E3779B9; }
  Rng.prototype.next = function () {                     // xorshift32
    var x = this.s >>> 0;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.s = x;
    return x;
  };
  Rng.prototype.below = function (n) { return this.next() % n; };
  Rng.prototype.shuffle = function (arr) {
    for (var k = arr.length - 1; k > 0; k--) {
      var j = this.below(k + 1), t = arr[k]; arr[k] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  // ----------------------------------------------------------- shapes ---
  /** The D: flat right half, semicircular left. Spin 0 faces the round west. */
  function dProfile(seg) {
    var p = [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], i, a;
    for (i = 1; i < seg * 2; i++) {                 // the arc, 90 to 270 deg
      a = QUARTER + Math.PI * (i / (seg * 2));
      p.push([0.5 * Math.cos(a), 0.5 * Math.sin(a)]);
    }
    return p;
  }

  /** The cut corner. Spin 0 puts the round at the north-east. */
  function cornerProfile(seg) {
    var p = [[-0.5, -0.5], [0.5, -0.5]], i, a;
    for (i = 0; i <= seg; i++) {                    // the arc, 0 to 90 deg
      a = QUARTER * (i / seg);
      p.push([0.5 * Math.cos(a), 0.5 * Math.sin(a)]);
    }
    p.push([-0.5, 0.5]);
    return p;
  }

  function outwardNormals(profile) {
    var n = [], i, j, dx, dy, L;
    for (i = 0; i < profile.length; i++) {
      j = (i + 1) % profile.length;
      dx = profile[j][0] - profile[i][0];
      dy = profile[j][1] - profile[i][1];
      L = Math.sqrt(dx * dx + dy * dy) || 1;
      n.push([dy / L, -dx / L]);                    // CCW winding, right of travel
    }
    return n;
  }

  var SHAPES = {
    d: { pts: dProfile(ARC_SEG) },
    c: { pts: cornerProfile(ARC_SEG) }
  };
  SHAPES.d.nrm = outwardNormals(SHAPES.d.pts);
  SHAPES.c.nrm = outwardNormals(SHAPES.c.pts);

  // ----------------------------------------------------------- scramble --
  /**
   * Walk away from the solved mark.
   *
   * The shape of the walk is fixed; only the seed's choices vary. Three single
   * turns come first — reversed, they become the solve's closing cascade, three
   * tiles locking one after another just before the mark reassembles. Two
   * orbits go in, the last of them closing the walk: reversed, that one opens
   * the solve on the whole ring swinging half round, and its partner swings it
   * back. Everything else is a turn.
   *
   * Two orbits is what lets the break be pure rotation — a half turn twice over
   * is no turn at all, so every tile stays in its own corner while the dials
   * are set, and nothing has to cross anything to reach the scramble.
   *
   * Nothing ever sweeps through anything. A tile turning in place sweeps a
   * half-diagonal of 0.707, and its stationary neighbour's near edge is 0.725
   * away, so a lone turn clears by a hair. Two at once do not clear — 0.707
   * twice over is more than the 1.2246 between adjacent centres — so a pair
   * turn is only ever dealt to tiles sitting diagonally, 1.732 apart.
   */
  function buildScramble(seed, rounds, maxPar) {
    var rng = new Rng(seed);
    var slot = [0, 1, 2, 3], spin = HOME_SPIN.slice(), steps = [], i, r;

    function turn(tiles, d) {
      tiles.forEach(function (t) { spin[t] = (spin[t] + d + 4) % 4; });
      steps.push({ orbit: 0, tiles: tiles, dir: d });
    }
    function orbit(d) {
      for (var k = 0; k < 4; k++) slot[k] = (slot[k] + 2) % 4;
      steps.push({ orbit: 1, tiles: [0, 1, 2, 3], dir: d });
    }
    function diagonalPair() {                 // the two tiles across from each other
      var byslot = [], k;
      for (k = 0; k < 4; k++) byslot[slot[k]] = k;
      var s = rng.below(2);
      return [byslot[s], byslot[s + 2]];
    }

    var order = rng.shuffle([0, 1, 2, 3]);
    for (i = 0; i < 3; i++) turn([order[i]], rng.below(2) ? 1 : -1);

    // the closing orbit, and its partner somewhere in the middle — far enough
    // back that a turn always sits between them
    var lastDir = rng.below(2) ? 1 : -1;
    var midOrbit = 3 + rng.below(Math.max(1, rounds - 5));

    for (r = 3; r < rounds; r++) {
      if (r === rounds - 1) { orbit(lastDir); continue; }
      if (r === midOrbit) { orbit(-lastDir); continue; }

      var prev = steps[steps.length - 1];
      var dir = rng.below(2) ? 1 : -1;
      var tiles = (maxPar > 1 && rng.below(10) < 4)
                ? diagonalPair() : [rng.below(4)];
      // The same tiles twice running reads as one slow move, whichever way
      // they go, so hand the beat to somebody else instead.
      if (!prev.orbit && prev.tiles.length === tiles.length &&
          prev.tiles.every(function (t) { return tiles.indexOf(t) >= 0; })) {
        tiles = tiles.length > 1
              // the complement of one diagonal pair is the other one
              ? [0, 1, 2, 3].filter(function (t) { return tiles.indexOf(t) < 0; })
              : [(tiles[0] + 1 + rng.below(3)) % 4];
      }
      turn(tiles, dir);
    }
    return { slot: slot, spin: spin, steps: steps };
  }

  // ------------------------------------------------------------- Turn ---
  function Turn(opts) {
    opts = opts || {};
    var rounds = opts.rounds || ROUNDS;
    var built = buildScramble(opts.seed === undefined ? SEED : opts.seed,
                              rounds, opts.maxParallel || MAX_PARALLEL);

    this.seed = opts.seed === undefined ? SEED : opts.seed;
    this.scrambled = { slot: built.slot.slice(), spin: built.spin.slice() };
    this.rounds = rounds;
    this.slotDur = (T_SOLVED - T_SOLVE) / rounds;

    // solving is the scramble run backwards, every move inverted
    this.solve = built.steps.slice().reverse().map(function (s) {
      return { orbit: s.orbit, tiles: s.tiles.slice(), dir: -s.dir };
    });

    // every board state the solve passes through, plus when each tile settles
    var st = { slot: built.slot.slice(), spin: built.spin.slice() };
    var lastTouch = {}, self = this;
    this.states = [st];
    this.solve.forEach(function (step, r) {
      var next = { slot: st.slot.slice(), spin: st.spin.slice() };
      if (step.orbit) {
        for (var i = 0; i < 4; i++) next.slot[i] = (next.slot[i] + 2) % 4;
      } else {
        step.tiles.forEach(function (t) {
          next.spin[t] = (next.spin[t] + step.dir + 4) % 4;
        });
      }
      step.tiles.forEach(function (t) { lastTouch[t] = r; });
      self.states.push(next);
      st = next;
    });

    this.lastMove = lastTouch;
    this.lockT = {};
    this.staticTiles = {};
    for (var i = 0; i < 4; i++) {
      if (lastTouch[i] === undefined) this.staticTiles[i] = 1;
      else {
        var frac = this.solve[lastTouch[i]].orbit ? MOVE_FRAC_ORBIT : MOVE_FRAC;
        this.lockT[i] = T_SOLVE + (lastTouch[i] + frac) * this.slotDur;
      }
    }

    // The break sets the dials in two beats, diagonal pairs together, because
    // that is the only pairing with room to turn at the same time — and on
    // this mark a diagonal pair is also a matching pair of shapes.
    this.wave = [0, 1, 2, 3].map(function (i) { return built.slot[i] % 2; });
  }

  /** Tile placements at loop time t: centre, height, own rotation. */
  Turn.prototype.frame = function (t) {
    var out = [], i, ang, rad, ui, e, sc = this.scrambled;

    function at(angle, radius, spin, z) {
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle),
               z: z, ang: spin };
    }

    // the mark, either side of the loop point
    if (t < T_RISE || t >= T_SOLVED) {
      for (i = 0; i < 4; i++) {
        out.push(at(slotAngle(i), ORBIT_R, -HOME_SPIN[i] * QUARTER, 0));
      }
      return out;
    }

    // the dials get set, both D's and then both cut corners
    if (t < T_JUMBLE) {
      var u = (t - T_RISE) / (T_JUMBLE - T_RISE);
      for (i = 0; i < 4; i++) {
        ui = clamp01(u * 2 - this.wave[i]);
        e = smootherstep(ui);
        rad = ORBIT_R * (1 + BLOOM_SCATTER * Math.sin(Math.PI * ui));
        out.push(at(slotAngle(sc.slot[i]), rad,
                    -(HOME_SPIN[i] + shortestQ(HOME_SPIN[i], sc.spin[i]) * e) * QUARTER,
                    LIFT_SCATTER * Math.pow(Math.sin(Math.PI * ui), 2)));
      }
      return out;
    }

    if (t < T_SOLVE) {
      for (i = 0; i < 4; i++) {
        out.push(at(slotAngle(sc.slot[i]), ORBIT_R, -sc.spin[i] * QUARTER, 0));
      }
      return out;
    }

    var r = Math.min(this.rounds - 1, Math.floor((t - T_SOLVE) / this.slotDur));
    var local = (t - T_SOLVE - r * this.slotDur) / this.slotDur;
    var state = this.states[r], step = this.solve[r];
    var uu = clamp01(local / (step.orbit ? MOVE_FRAC_ORBIT : MOVE_FRAC));
    var ee = easeInOutCubic(uu);

    for (i = 0; i < 4; i++) {
      out.push(at(slotAngle(state.slot[i]), ORBIT_R,
                  -state.spin[i] * QUARTER, 0));
    }
    if (step.orbit) {
      // a half turn, and the ring opens for the two moments it is off-square
      rad = ORBIT_R * (1 + BLOOM_ORBIT * Math.abs(Math.sin(2 * Math.PI * ee)));
      var lift = LIFT_ORBIT * Math.sin(Math.PI * uu);
      for (i = 0; i < 4; i++) {
        ang = slotAngle(state.slot[i]) - step.dir * Math.PI * ee;
        out[i] = at(ang, rad, -state.spin[i] * QUARTER, lift);
      }
    } else {
      var lt = LIFT_TURN * Math.sin(Math.PI * uu);
      step.tiles.forEach(function (ti) {
        out[ti].ang = -(state.spin[ti] + step.dir * ee) * QUARTER;
        out[ti].z = lt;
      });
    }
    return out;
  };

  Turn.prototype.pop = function (i, t) {
    if (this.staticTiles[i]) return 0;
    var tau = t - this.lockT[i];
    if (tau < 0 || tau > POP) return 0;
    return Math.sin(Math.PI * tau / POP);
  };

  Turn.prototype.solved = function (i, t) {
    if (t < T_RISE || t >= T_SOLVED) return true;   // opens and closes on the mark
    if (t < T_SOLVE) return false;                  // scrambled
    return !!this.staticTiles[i] || t >= this.lockT[i];
  };

  Turn.prototype.solvedCount = function (t) {
    var n = 0;
    for (var i = 0; i < 4; i++) if (this.solved(i, t)) n++;
    return n;
  };

  Turn.prototype.moveLabel = function (r) {
    var step = this.solve[r];
    if (step.orbit) return 'Half turn ' + (step.dir > 0 ? '↻' : '↺');
    return 'Turn ×' + step.tiles.length + ' ' +
           (step.dir > 0 ? '↻' : '↺');
  };

  // -------------------------------------------------------------- state --
  function flatness(t) {
    if (t < T_HOLD) return 1;
    if (t < T_RISE) return 1 - smoothstep((t - T_HOLD) / (T_RISE - T_HOLD));
    if (t < T_SOLVED) return 0;
    if (t < T_FLAT) return smoothstep((t - T_SOLVED) / (T_FLAT - T_SOLVED));
    return 1;
  }

  // Every camera term is either periodic over the loop or gated by depth,
  // which is zero at both ends — so the mark is dead-on front-facing at the wrap.
  function camera(t) {
    var depth = 1 - flatness(t);
    return {
      yaw: YAW_AMP * Math.sin(2 * Math.PI * t) * depth,
      pitch: (PITCH_AMP + PITCH_WOB * Math.sin(4 * Math.PI * t)) * depth,
      // pulling back while the tiles are up gives the loop room to travel
      // without ever shrinking the mark itself
      zoom: lerp(1.0, ZOOM_3D, depth)
    };
  }

  // -------------------------------------------------------------- light --
  var LIGHT = (function () {
    var l = [-0.42, 0.72, 0.55];
    var n = Math.sqrt(l[0] * l[0] + l[1] * l[1] + l[2] * l[2]);
    return [l[0] / n, l[1] / n, l[2] / n];
  })();

  function shade(ndotl, flat, cols) {
    var f = 0.28 + 0.72 * Math.max(0, ndotl), out = [0, 0, 0], k, u;
    for (k = 0; k < 3; k++) {
      if (f <= 0.62) { u = f / 0.62; out[k] = lerp(cols.shadow[k], cols.base[k], u); }
      else { u = (f - 0.62) / 0.38; out[k] = lerp(cols.base[k], cols.hilight[k], u); }
      out[k] = Math.round(lerp(out[k], cols.base[k], flat));   // flat = pure ink
    }
    return out;
  }
  function css(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  function hex(c) {
    if (Array.isArray(c)) return c.slice();
    var h = String(c).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16),
            parseInt(h.slice(4, 6), 16)];
  }
  function mix(a, b, u) {
    return [Math.round(lerp(a[0], b[0], u)), Math.round(lerp(a[1], b[1], u)),
            Math.round(lerp(a[2], b[2], u))];
  }

  function colours(opts) {
    var theme = THEMES[opts.theme] || THEMES.ink;
    var base = hex(opts.base || theme.base);
    var light = (base[0] * 299 + base[1] * 587 + base[2] * 114) / 1000 > 128;
    // A custom base gets its ramp derived; a light one needs less spread down
    // and more up than a near-black one, or the extrusion reads as mud.
    var shadow = opts.shadow ? hex(opts.shadow)
               : opts.base ? mix(base, [0, 0, 0], light ? 0.45 : 0.62)
               : hex(theme.shadow);
    var hilight = opts.highlight ? hex(opts.highlight)
                : opts.base ? mix(base, [255, 255, 255], light ? 0.55 : 0.42)
                : hex(theme.highlight);
    return { base: base, shadow: shadow, hilight: hilight };
  }

  // ---------------------------------------------------------- rendering --
  function draw(ctx, W, t, tn, cols, guide) {
    var flat = flatness(t), cam = camera(t), tiles = tn.frame(t);
    var depth = FLAT_DEPTH + (DEPTH - FLAT_DEPTH) * (1 - flat);
    var focal = FOCAL * W * CAM_DIST * cam.zoom;
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var lw = Math.max(0.6, W * 0.0022);
    var i, j, k;

    function toCam(p) {
      var x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy;
      return [x, p[1] * cp - z * sp, p[1] * sp + z * cp];
    }
    function project(p) {
      var d = Math.max(0.6, CAM_DIST - p[2]);
      return [W * 0.5 + focal * p[0] / d, W * 0.5 - focal * p[1] / d];
    }
    function trace(pts, close) {
      ctx.beginPath();
      for (var q = 0; q < pts.length; q++) {
        var s = project(pts[q]);
        if (q === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
      }
      if (close) ctx.closePath();
    }
    function placed(shape, ang, scale, ox, oy, z) {
      var ca = Math.cos(ang), sa = Math.sin(ang), o = [], q;
      for (q = 0; q < shape.length; q++) {
        o.push([(shape[q][0] * ca - shape[q][1] * sa) * scale + ox,
                (shape[q][0] * sa + shape[q][1] * ca) * scale + oy, z]);
      }
      return o;
    }

    ctx.clearRect(0, 0, W, W);
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;

    // The ring the tiles orbit on, and the shape each corner is waiting for.
    // Both fade out as the mark goes flat, so the hold stays clean.
    if (guide && flat < 0.995) {
      var gz = -0.5 * depth - 0.03, ring = [], a;
      for (i = 0; i <= 72; i++) {
        a = (i / 72) * Math.PI * 2;
        ring.push(toCam([ORBIT_R * Math.cos(a), ORBIT_R * Math.sin(a), gz]));
      }
      ctx.strokeStyle = 'rgba(' + cols.base.join(',') + ',' +
                        (0.26 * (1 - flat)).toFixed(3) + ')';
      trace(ring, false);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(' + cols.base.join(',') + ',' +
                        (0.15 * (1 - flat)).toFixed(3) + ')';
      for (i = 0; i < 4; i++) {
        trace(placed(SHAPES[TYPE[i]].pts, -NEED_SPIN[i] * QUARTER, 1,
                     ORBIT_R * Math.cos(slotAngle(i)),
                     ORBIT_R * Math.sin(slotAngle(i)), gz).map(toCam), true);
        ctx.stroke();
      }
    }

    // Each tile is a prism: its profile, extruded. Both profiles are convex,
    // so back-face culling plus a painter sort per prism is exact.
    var prisms = [];
    for (i = 0; i < 4; i++) {
      var shape = SHAPES[TYPE[i]];
      var s = 1 + POP_SCALE * tn.pop(i, t);
      var ca2 = Math.cos(tiles[i].ang), sa2 = Math.sin(tiles[i].ang);
      var hz = 0.5 * depth * s;
      var top = [], bot = [], nrm = [];
      for (j = 0; j < shape.pts.length; j++) {
        var px = (shape.pts[j][0] * ca2 - shape.pts[j][1] * sa2) * s + tiles[i].x;
        var py = (shape.pts[j][0] * sa2 + shape.pts[j][1] * ca2) * s + tiles[i].y;
        top.push(toCam([px, py, tiles[i].z + hz]));
        bot.push(toCam([px, py, tiles[i].z - hz]));
        nrm.push(toCam([shape.nrm[j][0] * ca2 - shape.nrm[j][1] * sa2,
                        shape.nrm[j][0] * sa2 + shape.nrm[j][1] * ca2, 0]));
      }
      prisms.push({ z: toCam([tiles[i].x, tiles[i].y, tiles[i].z])[2],
                    top: top, bot: bot, nrm: nrm });
    }
    prisms.sort(function (p, q) { return p.z - q.z; });

    prisms.forEach(function (pr) {
      var n = pr.top.length, faces = [], q;

      function addFace(pts, normal) {
        var c = [0, 0, 0], m = pts.length, a, b;
        for (a = 0; a < m; a++) for (b = 0; b < 3; b++) c[b] += pts[a][b] / m;
        if (normal[0] * c[0] + normal[1] * c[1] +
            normal[2] * (c[2] - CAM_DIST) >= 0) return;          // back-facing
        faces.push({ z: c[2], pts: pts,
                     nd: normal[0] * LIGHT[0] + normal[1] * LIGHT[1] +
                         normal[2] * LIGHT[2] });
      }

      addFace(pr.top, toCam([0, 0, 1]));
      addFace(pr.bot.slice().reverse(), toCam([0, 0, -1]));
      for (q = 0; q < n; q++) {
        var r2 = (q + 1) % n;
        addFace([pr.top[q], pr.top[r2], pr.bot[r2], pr.bot[q]], pr.nrm[q]);
      }
      faces.sort(function (p, o) { return p.z - o.z; });

      faces.forEach(function (f) {
        var col = shade(f.nd, flat, cols);
        trace(f.pts, true);
        ctx.fillStyle = css(col);
        ctx.fill();
        // stroking each face also hides the hairline seams canvas leaves
        // between adjacent antialiased polygons
        ctx.strokeStyle = css(col.map(function (c, q2) {
          return Math.round(lerp(c, cols.shadow[q2], 0.5 * (1 - flat)));
        }));
        ctx.stroke();
      });
    });
  }

  // ------------------------------------------------------------- mount --
  function fit(canvas) {
    var dpr = global.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || canvas.width || 200;
    var px = Math.round(cssW * dpr);
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    return px;
  }

  /** Draw one frozen frame at time t in [0, 1). */
  function still(canvas, t, opts) {
    opts = opts || {};
    draw(canvas.getContext('2d'), fit(canvas), t,
         opts.turn || new Turn(opts), colours(opts), opts.guide !== false);
  }

  function mount(canvas, opts) {
    opts = opts || {};
    var duration = opts.duration || 5000;
    var guide = opts.guide !== false;
    var cols = colours(opts);
    var tn = opts.turn || new Turn(opts);
    var ctx = canvas.getContext('2d');
    var raf = null, stopped = false, calm;

    calm = global.matchMedia &&
           global.matchMedia('(prefers-reduced-motion: reduce)').matches &&
           opts.respectReducedMotion !== false;

    function frame(now) {
      if (stopped) return;
      draw(ctx, fit(canvas), (now % duration) / duration, tn, cols, guide);
      raf = global.requestAnimationFrame(frame);
    }

    // Respect a reduced-motion preference: show the mark, don't animate.
    if (calm) draw(ctx, fit(canvas), 0, tn, cols, guide);
    else raf = global.requestAnimationFrame(frame);

    return {
      stop: function () {
        stopped = true;
        if (raf) global.cancelAnimationFrame(raf);
      },
      recolour: function (next) {
        cols = colours(next || {});
        if (calm) draw(ctx, fit(canvas), 0, tn, cols, guide);
      }
    };
  }

  // -------------------------------------------------------- seed search --
  /**
   * Score a scramble the way the eye does: every tile facing wrong, the ring
   * back where it started, the rounds not all off by the same amount (that
   * reads as the mark turned, not as a jumble), locks spread through the
   * solve, and both a pair turn and both directions somewhere in the walk.
   */
  function score(seed, rounds, maxPar) {
    var tn = new Turn({ seed: seed, rounds: rounds, maxParallel: maxPar });
    var i, offsets = {}, nOff = 0, orbits = 0, multi = 0, dirs = {};

    // an orbit shifts every slot alike, so slot 0 tells you the net travel —
    // it has to be nil, or the break would have to carry tiles between corners
    if (tn.scrambled.slot[0] !== 0) return -1;
    for (i = 0; i < 4; i++) {
      var off = (((tn.scrambled.spin[i] - NEED_SPIN[tn.scrambled.slot[i]]) % 4) + 4) % 4;
      if (off === 0) return -1;                       // a tile starts correct
      if (!offsets[off]) { offsets[off] = 1; nOff++; }
    }
    var orbitAt = [], turnsPer = [0, 0, 0, 0];
    tn.solve.forEach(function (s, r) {
      if (s.orbit) { orbits++; orbitAt.push(r); }
      else {
        if (s.tiles.length > 1) multi++;
        s.tiles.forEach(function (t) { turnsPer[t]++; });
      }
      dirs[s.dir] = 1;
    });
    if (orbits < 2 || multi < 1) return -1;
    // the ring should be out for a good stretch of the solve, not swing
    // straight back; and no one tile should hog the turns
    var orbitGap = orbitAt[orbitAt.length - 1] - orbitAt[0];
    var busiest = Math.max.apply(null, turnsPer);

    var locks = {}, nLock = 0, last = -1;
    for (i = 0; i < 4; i++) {
      if (tn.staticTiles[i]) return -1;               // a tile never moves
      var r = tn.lastMove[i];
      if (!locks[r]) { locks[r] = 1; nLock++; }
      if (r > last) last = r;
    }
    if (last !== rounds - 1) return -1;               // solve must end on a lock
    return nOff * 10 + nLock * 8 + Math.min(multi, 2) * 3 +
           orbitGap * 3 - (busiest > 2 ? (busiest - 2) * 6 : 0) +
           (dirs[1] && dirs[-1] ? 5 : 0);
  }

  function searchSeed(tries, rounds, maxPar) {
    rounds = rounds || ROUNDS; maxPar = maxPar || MAX_PARALLEL;
    var best = -1, bestSeed = SEED;
    for (var s = 1; s <= (tries || 4000); s++) {
      var v = score(s, rounds, maxPar);
      if (v > best) { best = v; bestSeed = s; }
    }
    return { seed: bestSeed, score: best };
  }

  var API = {
    mount: mount, still: still, draw: draw, Turn: Turn,
    flatness: flatness, camera: camera, slotAngle: slotAngle,
    searchSeed: searchSeed, score: score, shapes: SHAPES,
    PHASES: PHASES, SEED: SEED, ROUNDS: ROUNDS, ORBIT_R: ORBIT_R,
    TYPE: TYPE, HOME_SPIN: HOME_SPIN, NEED_SPIN: NEED_SPIN,
    T: { HOLD: T_HOLD, RISE: T_RISE, JUMBLE: T_JUMBLE,
         SOLVE: T_SOLVE, SOLVED: T_SOLVED, FLAT: T_FLAT }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.LogoTurn = API;
})(typeof window !== 'undefined' ? window : globalThis);
