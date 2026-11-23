/* Wind-ring markers and the gust animation in world coordinates. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;

  function draw(ctx, rings, time) {
    for (const ring of rings) {
      const { x, y, r, heading, used, flash } = ring;
      const pulse = 0.5 + Math.sin(time * 3 + x) * 0.5;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(heading);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = used ? 0.42 + flash * 0.58 : 1;

      ctx.fillStyle = 'rgba(7, 50, 52, .49)';
      ctx.strokeStyle = 'rgba(6, 63, 62, .87)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.83, 0, TAU);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = used ? '#b8d9bb' : '#a6ffe3';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = '#f7ffef';
      ctx.lineWidth = 5;
      if (used) {
        ctx.save();
        ctx.rotate(-heading);
        ctx.beginPath();
        ctx.moveTo(-r * 0.28, r * 0.01);
        ctx.lineTo(-r * 0.09, r * 0.23);
        ctx.lineTo(r * 0.29, -r * 0.24);
        ctx.stroke();
        ctx.restore();
      } else {
        for (let i = 0; i < 3; i++) {
          const angle = time * 0.9 + i * TAU / 3;
          ctx.strokeStyle = i === 0 ? '#fff6b5' : '#83ffe1';
          ctx.lineWidth = 4 + pulse * 2;
          ctx.beginPath();
          ctx.arc(0, 0, r, angle, angle + 0.67);
          ctx.stroke();
        }
        ctx.strokeStyle = '#f7ffef';
        ctx.lineWidth = 5;
        for (const offset of [-1, 1]) {
          const length = r * 0.37;
          ctx.beginPath();
          ctx.moveTo(offset * r * 0.18 - length * 0.4, -length * 0.65);
          ctx.lineTo(offset * r * 0.18 + length * 0.4, 0);
          ctx.lineTo(offset * r * 0.18 - length * 0.4, length * 0.65);
          ctx.stroke();
        }
      }

      if (flash > 0) {
        ctx.globalAlpha = flash * 0.75;
        ctx.strokeStyle = '#e9ffe0';
        ctx.lineWidth = 5 * flash;
        ctx.beginPath();
        ctx.arc(0, 0, r * (1.05 + (1 - flash) * 1.3), 0, TAU);
        ctx.stroke();
        const travel = (1 - flash) * r * 3;
        for (let lane = -2; lane <= 2; lane++) {
          const row = lane * r * 0.2;
          const offset = Math.abs(lane) * r * 0.18;
          ctx.beginPath();
          ctx.moveTo(travel - offset, row * 0.7);
          ctx.quadraticCurveTo(travel + r * 0.35 - offset, row, travel + r * 0.76 - offset, row * 1.4);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  root.YB = Object.assign(root.YB || {}, { Wind: { draw } });
})(window);
