'use client';
/** Interactive 3D segmentation scatter (R3F). Lazy-loaded; a 2D view is offered alongside. */
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

export default function Scatter3D({ points, colors, labels, reduced, axes }: { points: number[][]; colors: string[]; labels: number[]; reduced: boolean; axes: [string, string, string] }) {
  return (
    <Canvas camera={{ position: [1.25, 0.95, 1.25], fov: 45 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.9} />
      <Cloud points={points} colors={colors} labels={labels} reduced={reduced} />
      <AxesBox axes={axes} />
      <OrbitControls enablePan={false} autoRotate={!reduced} autoRotateSpeed={0.6} minDistance={1.1} maxDistance={4.5} enableDamping />
    </Canvas>
  );
}

function Cloud({ points, colors, labels, reduced }: { points: number[][]; colors: string[]; labels: number[]; reduced: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const t = useRef(0);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(points.length * 3);
    const col = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      pos.set([p[0] - 0.5, p[1] - 0.5, p[2] - 0.5], i * 3);
      const c = new THREE.Color(colors[labels[i]]);
      col.set([c.r, c.g, c.b], i * 3);
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, [points, colors, labels]);
  useFrame((_, dt) => {
    if (!ref.current) return;
    t.current = Math.min(1, t.current + (reduced ? 1 : dt * 0.8));
    const e = 1 - Math.pow(1 - t.current, 3);
    ref.current.scale.setScalar(0.2 + e * 0.8);
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial size={0.028} vertexColors transparent opacity={0.9} sizeAttenuation depthWrite={false} />
    </points>
  );
}

function AxesBox({ axes }: { axes: [string, string, string] }) {
  const c = 'rgba(140,160,220,0.35)';
  const o = -0.5;
  return (
    <group>
      <Line points={[[o, o, o], [0.5, o, o]]} color="#18D7F2" lineWidth={1.4} />
      <Line points={[[o, o, o], [o, 0.5, o]]} color="#713BFF" lineWidth={1.4} />
      <Line points={[[o, o, o], [o, o, 0.5]]} color="#13C996" lineWidth={1.4} />
      <gridHelper args={[1, 8, c, c]} position={[0, o, 0]} />
      <Html position={[0.58, o, o]} center><span className="whitespace-nowrap text-[10px] font-semibold text-cyan">{axes[0]}</span></Html>
      <Html position={[o, 0.58, o]} center><span className="whitespace-nowrap text-[10px] font-semibold text-purple">{axes[1]}</span></Html>
      <Html position={[o, o, 0.58]} center><span className="whitespace-nowrap text-[10px] font-semibold text-emerald">{axes[2]}</span></Html>
    </group>
  );
}
