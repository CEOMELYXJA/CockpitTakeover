"use strict";

(() => {
  const WIDTH = 320, HEIGHT = 480, BALL_RADIUS = 6;
  const BUMPERS = [[110, 140, 22], [210, 140, 22], [160, 215, 22], [70, 262, 14], [250, 262, 14]];
  const HIGH_SCORE_KEY = "cockpit-takeover-pinball-v1";

  function mount(container, options = {}) {
    if (!container) throw new Error("Missing pinball mount target.");
    container.replaceChildren();
    const root = document.createElement("section");
    root.className = "pinball-root";
    root.innerHTML = `
      <div class="pinball-top">
        <div class="pinball-title">ORBITAL PINBALL<small>ARCADE DE LA PLANÈTE MYSTÈRE</small></div>
        <button class="pinball-close" type="button" aria-label="Fermer le mini pinball">×</button>
      </div>
      <div class="pinball-scoreboard" aria-live="polite">
        <div class="pinball-score">Score<strong data-score>000000</strong></div>
        <div class="pinball-score">Billes<strong data-balls>● ● ●</strong></div>
        <div class="pinball-score">Record<strong data-high>000000</strong></div>
      </div>
      <div class="pinball-canvas-wrap"><canvas class="pinball-canvas" width="320" height="480" aria-label="Table de mini pinball. Utilisez les flèches gauche et droite pour actionner les palettes."></canvas></div>
      <div class="pinball-bottom"><span class="pinball-hint" data-hint>Flèches ← → ou boutons · Espace pour lancer</span><button class="pinball-launch" type="button" data-launch>Lancer</button></div>
      <div class="pinball-flippers"><button class="pinball-flipper" type="button" data-flipper="left">◀ GAUCHE</button><button class="pinball-flipper" type="button" data-flipper="right">DROITE ▶</button></div>`;
    container.append(root);

    const canvas = root.querySelector("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    const scoreLabel = root.querySelector("[data-score]");
    const ballsLabel = root.querySelector("[data-balls]");
    const highLabel = root.querySelector("[data-high]");
    const hintLabel = root.querySelector("[data-hint]");
    const leftButton = root.querySelector('[data-flipper="left"]');
    const rightButton = root.querySelector('[data-flipper="right"]');
    let highScore = 0;
    try { highScore = Math.max(0, Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0); } catch (_) {}
    const game = {
      score: 0, balls: 3, ball: null, status: "ready", leftHeld: false, rightHeld: false,
      flash: BUMPERS.map(() => 0), lastTime: 0, raf: 0, disposed: false, lostAt: 0,
      particles: [], seed: (Date.now() ^ 0x51f15e) >>> 0
    };
    highLabel.textContent = String(highScore).padStart(6, "0");

    function rand() {
      game.seed = (Math.imul(game.seed, 1664525) + 1013904223) >>> 0;
      return game.seed / 0x100000000;
    }

    function spawnBall() {
      game.ball = { x: 145 + rand() * 30, y: 34, vx: (rand() - .5) * 2.8, vy: 1.8, r: BALL_RADIUS };
      game.status = "playing";
      hintLabel.textContent = "Garde la bille en jeu !";
      updateLabels();
    }

    function launch() {
      if (game.disposed) return;
      if (game.status === "over") {
        game.score = 0; game.balls = 3; game.ball = null; game.flash.fill(0); game.status = "ready";
      }
      if (game.status === "ready" || game.status === "waiting") spawnBall();
    }

    function updateLabels() {
      scoreLabel.textContent = String(game.score).padStart(6, "0");
      highLabel.textContent = String(highScore).padStart(6, "0");
      ballsLabel.textContent = game.balls > 0 ? `${"● ".repeat(game.balls).trim()}${game.balls < 3 ? ` ${"○ ".repeat(3 - game.balls).trim()}` : ""}` : "○ ○ ○";
    }

    function addScore(points, x, y, color = "#a5f2ff") {
      game.score += points;
      if (game.score > highScore) {
        highScore = game.score;
        try { localStorage.setItem(HIGH_SCORE_KEY, String(highScore)); } catch (_) {}
      }
      game.particles.push({ x, y, vx: (rand() - .5) * .6, vy: -1.1, born: performance.now(), text: `+${points}`, color });
      updateLabels();
    }

    function flipper(side) {
      const left = side === "left", held = left ? game.leftHeld : game.rightHeld;
      const pivot = left ? { x: 126, y: 416 } : { x: 194, y: 416 };
      const tip = left ? (held ? { x: 188, y: 382 } : { x: 72, y: 421 }) : (held ? { x: 132, y: 382 } : { x: 248, y: 421 });
      return { pivot, tip };
    }

    function hitSegment(ball, start, end, strength = 1) {
      const vx = end.x - start.x, vy = end.y - start.y;
      const lengthSq = vx * vx + vy * vy;
      const t = Math.max(0, Math.min(1, ((ball.x - start.x) * vx + (ball.y - start.y) * vy) / lengthSq));
      const px = start.x + vx * t, py = start.y + vy * t;
      let nx = ball.x - px, ny = ball.y - py;
      const distance = Math.hypot(nx, ny) || 1;
      const overlap = ball.r + 3.5 - distance;
      if (overlap <= 0) return;
      nx /= distance; ny /= distance;
      ball.x += nx * overlap; ball.y += ny * overlap;
      const approach = ball.vx * nx + ball.vy * ny;
      if (approach < 0) { ball.vx -= (1 + .9) * approach * nx; ball.vy -= (1 + .9) * approach * ny; }
      if (strength > 1) { ball.vx += nx * 1.3 * strength; ball.vy -= .75 * strength; }
    }

    function stepBall(dt, timestamp) {
      const ball = game.ball;
      if (!ball || game.status !== "playing") return;
      const substeps = 4, subDt = dt / substeps;
      for (let step = 0; step < substeps; step++) {
        ball.vy += .095 * subDt;
        ball.x += ball.vx * subDt;
        ball.y += ball.vy * subDt;
        ball.vx *= .9995;
        if (ball.x < 17 + ball.r) { ball.x = 17 + ball.r; ball.vx = Math.abs(ball.vx) * .84; }
        if (ball.x > WIDTH - 17 - ball.r) { ball.x = WIDTH - 17 - ball.r; ball.vx = -Math.abs(ball.vx) * .84; }
        if (ball.y < 18 + ball.r) { ball.y = 18 + ball.r; ball.vy = Math.abs(ball.vy) * .82; }

        BUMPERS.forEach(([x, y, radius], index) => {
          let dx = ball.x - x, dy = ball.y - y;
          const distance = Math.hypot(dx, dy) || 1;
          const reach = ball.r + radius;
          if (distance >= reach) return;
          const nx = dx / distance, ny = dy / distance;
          ball.x = x + nx * (reach + .25); ball.y = y + ny * (reach + .25);
          const approach = ball.vx * nx + ball.vy * ny;
          if (approach < 0) { ball.vx -= 1.82 * approach * nx; ball.vy -= 1.82 * approach * ny; }
          const kick = radius > 20 ? 3.4 : 2.7;
          ball.vx += nx * kick; ball.vy += ny * kick;
          const speed = Math.hypot(ball.vx, ball.vy);
          if (speed > 15) { ball.vx *= 15 / speed; ball.vy *= 15 / speed; }
          game.flash[index] = timestamp + 150;
          addScore(radius > 20 ? 100 : 50, x, y, index % 2 ? "#f4a7ff" : "#83f1ff");
        });

        const left = flipper("left"), right = flipper("right");
        hitSegment(ball, left.pivot, left.tip, game.leftHeld ? 1.75 : 1);
        hitSegment(ball, right.pivot, right.tip, game.rightHeld ? 1.75 : 1);
        hitSegment(ball, { x: 20, y: 330 }, { x: 75, y: 370 });
        hitSegment(ball, { x: 300, y: 330 }, { x: 245, y: 370 });
        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed > 16) { ball.vx *= 16 / speed; ball.vy *= 16 / speed; }
        if (ball.y > HEIGHT + 22) {
          game.ball = null;
          game.balls -= 1;
          updateLabels();
          if (game.balls <= 0) {
            game.status = "over"; hintLabel.textContent = "Partie terminée · Lancer pour recommencer";
          } else {
            game.status = "waiting"; game.lostAt = timestamp; hintLabel.textContent = "Une autre bille arrive…";
          }
          break;
        }
      }
    }

    function drawTable(timestamp) {
      ctx.fillStyle = "#060b16"; ctx.fillRect(0, 0, WIDTH, HEIGHT);
      const background = ctx.createRadialGradient(160, 210, 20, 160, 235, 290);
      background.addColorStop(0, "rgba(30,55,99,.34)"); background.addColorStop(.62, "rgba(11,17,34,.22)"); background.addColorStop(1, "rgba(2,5,12,.05)");
      ctx.fillStyle = background; ctx.fillRect(0, 0, WIDTH, HEIGHT);
      for (let i = 0; i < 34; i++) {
        const x = (i * 97 + 11) % WIDTH, y = (i * 173 + 21) % HEIGHT;
        ctx.globalAlpha = .16 + ((i * 7) % 7) * .025; ctx.fillStyle = i % 5 ? "#d9efff" : "#b78dff";
        ctx.fillRect(x, y, i % 8 === 0 ? 1.4 : .8, i % 8 === 0 ? 1.4 : .8);
      }
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.strokeStyle = "rgba(66,220,255,.56)"; ctx.lineWidth = 2.1; ctx.shadowColor = "rgba(66,220,255,.45)"; ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.moveTo(18, 465); ctx.lineTo(18, 26); ctx.quadraticCurveTo(18, 14, 31, 14); ctx.lineTo(289, 14); ctx.quadraticCurveTo(302, 14, 302, 27); ctx.lineTo(302, 465); ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(139,121,255,.35)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(27, 457); ctx.lineTo(27, 34); ctx.quadraticCurveTo(27, 24, 38, 24); ctx.lineTo(282, 24); ctx.quadraticCurveTo(293, 24, 293, 35); ctx.lineTo(293, 457); ctx.stroke();
      ctx.restore();

      BUMPERS.forEach(([x, y, radius], index) => {
        const lit = timestamp < game.flash[index];
        const color = index === 1 || index === 4 ? "#ff4fc8" : index === 2 ? "#a77bff" : "#42dcff";
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * (lit ? 2.3 : 1.8));
        glow.addColorStop(0, `${color}${lit ? "75" : "32"}`); glow.addColorStop(1, `${color}00`);
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius * 2.3, 0, Math.PI * 2); ctx.fill();
        const face = ctx.createRadialGradient(x - radius * .35, y - radius * .38, 1, x, y, radius);
        face.addColorStop(0, lit ? "#ffffff" : "#e9f7ff"); face.addColorStop(.22, color); face.addColorStop(.82, "#273452"); face.addColorStop(1, "#090e1c");
        ctx.fillStyle = face; ctx.strokeStyle = `${color}${lit ? "ff" : "aa"}`; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.globalAlpha = .42; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x - radius * .13, y - radius * .12, radius * .63, Math.PI * 1.08, Math.PI * 1.78); ctx.stroke(); ctx.globalAlpha = 1;
      });

      ctx.strokeStyle = "rgba(255,79,200,.25)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(30, 317); ctx.lineTo(79, 356); ctx.lineTo(108, 366); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(290, 317); ctx.lineTo(241, 356); ctx.lineTo(212, 366); ctx.stroke();
      const left = flipper("left"), right = flipper("right");
      [left, right].forEach((flipperLine, index) => {
        const color = (index === 0 ? game.leftHeld : game.rightHeld) ? "#ff93de" : "#77eaff";
        ctx.save(); ctx.lineCap = "round"; ctx.lineWidth = 11; ctx.shadowColor = color; ctx.shadowBlur = 11; ctx.strokeStyle = "rgba(5,10,22,.9)";
        ctx.beginPath(); ctx.moveTo(flipperLine.pivot.x, flipperLine.pivot.y); ctx.lineTo(flipperLine.tip.x, flipperLine.tip.y); ctx.stroke();
        ctx.shadowBlur = 5; ctx.lineWidth = 4.2; ctx.strokeStyle = color;
        ctx.beginPath(); ctx.moveTo(flipperLine.pivot.x, flipperLine.pivot.y); ctx.lineTo(flipperLine.tip.x, flipperLine.tip.y); ctx.stroke();
        ctx.fillStyle = "#eaf8ff"; ctx.beginPath(); ctx.arc(flipperLine.pivot.x, flipperLine.pivot.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
      ctx.fillStyle = "rgba(152,188,218,.56)"; ctx.font = "700 8px monospace"; ctx.textAlign = "center";
      ctx.fillText("C O C K P I T   A R C A D E", 160, 450);

      if (game.ball) {
        const ballGlow = ctx.createRadialGradient(game.ball.x - 2, game.ball.y - 2, 1, game.ball.x, game.ball.y, game.ball.r * 2.8);
        ballGlow.addColorStop(0, "#ffffff"); ballGlow.addColorStop(.3, "#a5f2ff"); ballGlow.addColorStop(1, "rgba(66,220,255,0)");
        ctx.fillStyle = ballGlow; ctx.beginPath(); ctx.arc(game.ball.x, game.ball.y, game.ball.r * 2.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.shadowColor = "#8cf0ff"; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(game.ball.x, game.ball.y, game.ball.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
      game.particles = game.particles.filter((particle) => timestamp - particle.born < 720);
      game.particles.forEach((particle) => {
        const age = (timestamp - particle.born) / 720;
        ctx.globalAlpha = 1 - age; ctx.fillStyle = particle.color; ctx.font = "700 11px monospace"; ctx.textAlign = "center";
        ctx.fillText(particle.text, particle.x + particle.vx * age * 24, particle.y + particle.vy * age * 34);
      });
      ctx.globalAlpha = 1;

      if (game.status !== "playing") {
        ctx.fillStyle = "rgba(2,6,15,.56)"; ctx.fillRect(42, 293, 236, 44);
        ctx.strokeStyle = "rgba(139,121,255,.45)"; ctx.strokeRect(42, 293, 236, 44);
        ctx.textAlign = "center"; ctx.fillStyle = "#ecf9ff"; ctx.font = "700 12px monospace";
        ctx.fillText(game.status === "over" ? "PARTIE TERMINÉE" : game.status === "waiting" ? "BILLE EN APPROCHE" : "LANCE LA BILLE !", 160, 311);
        ctx.fillStyle = "#91dfff"; ctx.font = "9px monospace";
        ctx.fillText(game.status === "over" ? "APPUYER SUR LANCER POUR REJOUER" : "ESPACE · ENTRÉE · BOUTON LANCER", 160, 326);
      }
    }

    function frame(timestamp) {
      if (game.disposed) return;
      const dt = game.lastTime ? Math.max(.25, Math.min(2.2, (timestamp - game.lastTime) / (1000 / 60))) : 1;
      game.lastTime = timestamp;
      if (game.status === "waiting" && timestamp - game.lostAt > 850) spawnBall();
      if (game.status === "playing") stepBall(dt, timestamp);
      drawTable(timestamp);
      game.raf = requestAnimationFrame(frame);
    }

    function keyDown(event) {
      if (event.code === "ArrowLeft" || event.code === "KeyA") { game.leftHeld = true; leftButton.classList.add("is-held"); event.preventDefault(); }
      else if (event.code === "ArrowRight" || event.code === "KeyD") { game.rightHeld = true; rightButton.classList.add("is-held"); event.preventDefault(); }
      else if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        if (game.status !== "playing") launch();
        else { game.leftHeld = true; game.rightHeld = true; leftButton.classList.add("is-held"); rightButton.classList.add("is-held"); }
      }
    }
    function keyUp(event) {
      if (event.code === "ArrowLeft" || event.code === "KeyA" || event.code === "Space" || event.code === "Enter") { game.leftHeld = false; leftButton.classList.remove("is-held"); }
      if (event.code === "ArrowRight" || event.code === "KeyD" || event.code === "Space" || event.code === "Enter") { game.rightHeld = false; rightButton.classList.remove("is-held"); }
    }
    function bindFlipper(button, side) {
      const press = (event) => { event.preventDefault(); if (side === "left") game.leftHeld = true; else game.rightHeld = true; button.classList.add("is-held"); };
      const release = () => { if (side === "left") game.leftHeld = false; else game.rightHeld = false; button.classList.remove("is-held"); };
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
      return () => { button.removeEventListener("pointerdown", press); button.removeEventListener("pointerup", release); button.removeEventListener("pointercancel", release); button.removeEventListener("pointerleave", release); };
    }
    const unbindLeft = bindFlipper(leftButton, "left"), unbindRight = bindFlipper(rightButton, "right");
    root.querySelector("[data-launch]").addEventListener("click", launch);
    canvas.addEventListener("pointerdown", () => { if (game.status !== "playing") launch(); });
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    const close = () => { options.onClose?.(); };
    root.querySelector(".pinball-close").addEventListener("click", close);
    updateLabels();
    game.raf = requestAnimationFrame(frame);

    return {
      destroy() {
        if (game.disposed) return;
        game.disposed = true; cancelAnimationFrame(game.raf);
        window.removeEventListener("keydown", keyDown); window.removeEventListener("keyup", keyUp);
        unbindLeft(); unbindRight();
        if (root.parentNode === container) container.removeChild(root);
      }
    };
  }

  window.CockpitPinball = Object.freeze({ mount });
})();
