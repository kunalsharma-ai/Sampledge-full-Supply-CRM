'use client';
/**
 * Real-time 3D research activity globe (React Three Fiber + Drei).
 * - land as instanced dots from Natural Earth 110m
 * - per-country pillars sized by the chosen metric at the chosen week (time = 4th dimension)
 * - animated supply arcs from supplier HQs to live fieldwork markets
 * - click a pillar to fly the camera there and open the country panel
 * Loaded lazily via next/dynamic; never rendered on the server.
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import landDots from '@/lib/geo/land-dots.json';
import { palette } from '@/lib/tokens';

export type GlobePoint = { code: string; name: string; lat: number; lon: number; value: number; label: string; color?: string };
export type GlobeArc = { from: [number, number]; to: [number, number]; weight: number };

const R = 1;
export function ll(lat: number, lon: number, r = R) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

function Land({ dark }: { dark: boolean }) {
  const geo = useMemo(() => {
    const d = landDots as number[];
    const pos = new Float32Array((d.length / 2) * 3);
    for (let i = 0; i < d.length; i += 2) {
      const v = ll(d[i], d[i + 1], R * 1.001);
      pos.set([v.x, v.y, v.z], (i / 2) * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  return (
    <points geometry={geo}>
      <pointsMaterial size={0.0105} sizeAttenuation color={dark ? '#5D7BD6' : '#3A5BC4'} transparent opacity={dark ? 0.75 : 0.65} depthWrite={false} />
    </points>
  );
}

const atmosphere = {
  vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
  fragmentShader: `uniform vec3 c; uniform float k; varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(c, 1.0) * i * k; }`,
};

function Sphere({ dark }: { dark: boolean }) {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[R * 0.995, 64, 64]} />
        <meshPhongMaterial color={dark ? '#0B1330' : '#DCE4F7'} emissive={dark ? '#0A1638' : '#E8EEFB'} emissiveIntensity={0.6} shininess={8} transparent opacity={0.96} />
      </mesh>
      <mesh scale={1.18}>
        <sphereGeometry args={[R, 64, 64]} />
        <shaderMaterial args={[{ ...atmosphere, uniforms: { c: { value: new THREE.Color(palette.blue) }, k: { value: dark ? 1.25 : 0.7 } } }]} side={THREE.BackSide} blending={THREE.AdditiveBlending} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

function Pillar({ p, max, selected, onSelect, hovered, setHovered }: { p: GlobePoint; max: number; selected: boolean; onSelect: (c: string) => void; hovered: boolean; setHovered: (c: string | null) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const h = 0.02 + (p.value / (max || 1)) * 0.26;
  const base = useMemo(() => ll(p.lat, p.lon, R), [p.lat, p.lon]);
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), base.clone().normalize()), [base]);
  const cur = useRef(0.001);
  useFrame(() => {
    if (!ref.current) return;
    cur.current += (h - cur.current) * 0.09;
    ref.current.scale.set(1, cur.current, 1);
    ref.current.position.copy(base.clone().multiplyScalar(1 + cur.current / 2));
  });
  const color = selected ? palette.magenta : p.color ?? palette.cyan;
  return (
    <group>
      <mesh
        ref={ref}
        quaternion={q}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(p.code); }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(p.code); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHovered(null); document.body.style.cursor = ''; }}
      >
        <cylinderGeometry args={[0.009, 0.009, 1, 10]} />
        <meshBasicMaterial color={color} transparent opacity={hovered || selected ? 1 : 0.85} toneMapped={false} />
      </mesh>
      <mesh position={base.clone().multiplyScalar(1.002)} quaternion={q}>
        <ringGeometry args={[0.018, selected ? 0.04 : 0.028, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {(hovered || selected) && (
        <Html position={base.clone().multiplyScalar(1.02 + h)} center distanceFactor={3.2} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap rounded-lg border border-white/10 bg-[#0B1330]/90 px-2.5 py-1.5 text-[11px] text-white shadow-lg backdrop-blur">
            <div className="font-semibold">{p.name}</div>
            <div className="text-[10px] text-white/70">{p.label}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

function Arc({ a, reduced }: { a: GlobeArc; reduced: boolean }) {
  const pts = useMemo(() => {
    const s = ll(a.from[0], a.from[1]), e = ll(a.to[0], a.to[1]);
    const mid = s.clone().add(e).multiplyScalar(0.5);
    const lift = 1 + s.distanceTo(e) * 0.45;
    mid.normalize().multiplyScalar(lift);
    return new THREE.QuadraticBezierCurve3(s, mid, e).getPoints(48);
  }, [a]);
  const ref = useRef<{ material: THREE.Material & { dashOffset: number } } | null>(null);
  useFrame((_, dt) => { if (ref.current && !reduced) ref.current.material.dashOffset -= dt * 0.35; });
  return <Line ref={ref as never} points={pts} color={palette.purple} lineWidth={1 + a.weight * 1.4} dashed dashSize={0.06} gapSize={0.04} transparent opacity={0.75} />;
}

function Fly({ target, controls }: { target: THREE.Vector3 | null; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree();
  const flying = useRef(false);
  useEffect(() => { flying.current = !!target; }, [target]);
  useFrame(() => {
    if (!flying.current || !target) return;
    const dist = camera.position.length();
    const goal = target.clone().normalize().multiplyScalar(dist);
    camera.position.lerp(goal, 0.07);
    camera.position.setLength(dist);
    controls.current?.update();
    if (camera.position.distanceTo(goal) < 0.01) flying.current = false;
  });
  return null;
}

export default function GlobeScene({ points, arcs, selected, onSelect, dark, reduced, active }: {
  points: GlobePoint[]; arcs: GlobeArc[]; selected: string | null; onSelect: (c: string) => void; dark: boolean; reduced: boolean; active: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const max = Math.max(...points.map((p) => p.value), 1);
  const sel = points.find((p) => p.code === selected);
  const target = useMemo(() => (sel ? ll(sel.lat, sel.lon) : null), [sel]);
  return (
    <Canvas
      frameloop={active ? 'always' : 'demand'}
      dpr={[1, 1.75]}
      camera={{ position: ll(28, 10, 3.1).toArray(), fov: 42 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => setHovered(null)}
    >
      <ambientLight intensity={dark ? 0.6 : 1.1} />
      <directionalLight position={[3, 2, 4]} intensity={0.9} color={palette.cyan} />
      <directionalLight position={[-4, -1, -2]} intensity={0.5} color={palette.purple} />
      <Sphere dark={dark} />
      <Land dark={dark} />
      {points.map((p) => (
        <Pillar key={p.code} p={p} max={max} selected={p.code === selected} onSelect={onSelect} hovered={hovered === p.code} setHovered={setHovered} />
      ))}
      {arcs.map((a, i) => <Arc key={i} a={a} reduced={reduced} />)}
      <OrbitControls ref={controls} enablePan={false} minDistance={1.8} maxDistance={4.2} autoRotate={!reduced && !selected && !hovered} autoRotateSpeed={0.45} enableDamping dampingFactor={0.08} rotateSpeed={0.6} />
      <Fly target={target} controls={controls} />
    </Canvas>
  );
}
