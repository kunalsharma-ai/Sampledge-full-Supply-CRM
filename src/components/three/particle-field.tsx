'use client';
import { useEffect, useRef } from 'react';
import { useOS } from '@/lib/store';

/**
 * Lightweight 2D-canvas particle field with depth layers and pointer parallax.
 * Pauses when offscreen or tab hidden; static frame under reduced motion.
 */
export function ParticleField({ className, density = 70 }: { className?: string; density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useOS((s) => s.motion === 'reduced');
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    let w = 0, h = 0, raf = 0, visible = true;
    const mouse = { x: 0.5, y: 0.5 };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cols = ['24,215,242', '36,107,253', '113,59,255', '218,78,255'];
    const P = Array.from({ length: density }, () => ({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8, vx: (Math.random() - 0.5) * 0.00012, vy: (Math.random() - 0.5) * 0.00012, c: cols[Math.floor(Math.random() * cols.length)] }));
    const resize = () => { const r = c.getBoundingClientRect(); w = r.width; h = r.height; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const pts = P.map((p) => ({ ...p, sx: (p.x + (mouse.x - 0.5) * 0.04 * p.z) * w, sy: (p.y + (mouse.y - 0.5) * 0.04 * p.z) * h }));
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
        if (d < 110) { ctx.strokeStyle = `rgba(${a.c},${(1 - d / 110) * 0.16 * a.z})`; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); }
      }
      for (const p of pts) { ctx.fillStyle = `rgba(${p.c},${0.25 + p.z * 0.6})`; ctx.beginPath(); ctx.arc(p.sx, p.sy, 0.6 + p.z * 1.6, 0, Math.PI * 2); ctx.fill(); }
    };
    const tick = () => {
      for (const p of P) { p.x += p.vx * p.z * 16; p.y += p.vy * p.z * 16; if (p.x < 0 || p.x > 1) p.vx *= -1; if (p.y < 0 || p.y > 1) p.vy *= -1; }
      draw();
      if (visible && !reduced) raf = requestAnimationFrame(tick);
    };
    resize();
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; cancelAnimationFrame(raf); if (visible && !reduced) raf = requestAnimationFrame(tick); });
    io.observe(c);
    const onMove = (e: PointerEvent) => { const r = c.getBoundingClientRect(); mouse.x = (e.clientX - r.left) / r.width; mouse.y = (e.clientY - r.top) / r.height; if (reduced) draw(); };
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove);
    draw();
    if (!reduced) raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener('resize', resize); window.removeEventListener('pointermove', onMove); };
  }, [reduced, density]);
  return <canvas ref={ref} className={className} aria-hidden />;
}
