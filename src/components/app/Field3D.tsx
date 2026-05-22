import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Html, Line } from "@react-three/drei";
import * as THREE from "three";

export type SprayZone = {
  x: number; // -10..10
  z: number;
  w: number;
  d: number;
  severity: "low" | "medium" | "high";
  label: string;
};

const FIELD_W = 24;
const FIELD_D = 16;

const sevColor = (s: SprayZone["severity"]) =>
  s === "high" ? "#ef4444" : s === "medium" ? "#f59e0b" : "#10b981";

function CropCarpet() {
  // grid of small "plant" boxes with subtle color variation
  const items = useMemo(() => {
    const a: { x: number; z: number; h: number; c: string }[] = [];
    const stepX = 0.6, stepZ = 0.6;
    for (let x = -FIELD_W / 2 + 0.5; x < FIELD_W / 2; x += stepX) {
      for (let z = -FIELD_D / 2 + 0.5; z < FIELD_D / 2; z += stepZ) {
        const n = Math.sin(x * 0.7) * Math.cos(z * 0.5) * 0.5 + Math.random() * 0.3;
        const healthy = n > 0.1;
        a.push({
          x, z,
          h: 0.25 + Math.random() * 0.15,
          c: healthy ? `hsl(${95 + n * 30}, 55%, ${35 + n * 15}%)` : `hsl(${50 + n * 20}, 45%, 45%)`,
        });
      }
    }
    return a;
  }, []);

  return (
    <group>
      {/* soil base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FIELD_W, FIELD_D]} />
        <meshStandardMaterial color="#3a2817" />
      </mesh>
      {/* crop tiles via instanced mesh-ish (just many meshes — fine for demo) */}
      {items.map((it, i) => (
        <mesh key={i} position={[it.x, it.h / 2, it.z]} castShadow>
          <boxGeometry args={[0.45, it.h, 0.45]} />
          <meshStandardMaterial color={it.c} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function SprayBox({ zone }: { zone: SprayZone }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const t = clock.getElapsedTime();
      const m = ref.current.material as THREE.MeshStandardMaterial;
      m.opacity = 0.25 + Math.sin(t * 2 + zone.x) * 0.15;
    }
  });
  const color = sevColor(zone.severity);
  return (
    <group position={[zone.x, 0, zone.z]}>
      {/* translucent volume */}
      <mesh ref={ref} position={[0, 0.9, 0]}>
        <boxGeometry args={[zone.w, 1.8, zone.d]} />
        <meshStandardMaterial color={color} transparent opacity={0.3} emissive={color} emissiveIntensity={0.4} />
      </mesh>
      {/* outline */}
      <lineSegments position={[0, 0.9, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(zone.w, 1.8, zone.d)]} />
        <lineBasicMaterial color={color} />
      </lineSegments>
      {/* ground footprint */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <planeGeometry args={[zone.w, zone.d]} />
        <meshBasicMaterial color={color} transparent opacity={0.25} />
      </mesh>
      <Html position={[0, 2.2, 0]} center distanceFactor={14}>
        <div className="px-2 py-1 rounded text-[10px] font-mono whitespace-nowrap text-white shadow-lg"
          style={{ background: color }}>
          {zone.label}
        </div>
      </Html>
    </group>
  );
}

function Drone({ path }: { path: [number, number][] }) {
  const ref = useRef<THREE.Group>(null);
  const propA = useRef<THREE.Mesh>(null);
  const propB = useRef<THREE.Mesh>(null);
  const propC = useRef<THREE.Mesh>(null);
  const propD = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = (clock.getElapsedTime() * 0.08) % 1;
    const seg = t * (path.length - 1);
    const i = Math.floor(seg);
    const f = seg - i;
    const [x1, z1] = path[i];
    const [x2, z2] = path[Math.min(i + 1, path.length - 1)];
    if (ref.current) {
      ref.current.position.set(x1 + (x2 - x1) * f, 4, z1 + (z2 - z1) * f);
      ref.current.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    }
    const s = clock.getElapsedTime() * 40;
    [propA, propB, propC, propD].forEach(p => { if (p.current) p.current.rotation.y = s; });
  });

  return (
    <group ref={ref}>
      {/* body */}
      <mesh castShadow>
        <boxGeometry args={[0.6, 0.18, 0.6]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* arms + props */}
      {[[0.5,0.5],[-0.5,0.5],[0.5,-0.5],[-0.5,-0.5]].map(([x,z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 0.1, 8]} />
            <meshStandardMaterial color="#333" />
          </mesh>
          <mesh ref={[propA,propB,propC,propD][i]} position={[0, 0.2, 0]}>
            <boxGeometry args={[0.8, 0.02, 0.08]} />
            <meshStandardMaterial color="#666" transparent opacity={0.6} />
          </mesh>
        </group>
      ))}
      {/* status light */}
      <pointLight color="#3ee37a" intensity={1.5} distance={3} />
      <mesh position={[0, -0.12, 0]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color="#3ee37a" emissive="#3ee37a" emissiveIntensity={2} />
      </mesh>
    </group>
  );
}

function WaypointPath({ path }: { path: [number, number][] }) {
  const points = path.map(([x, z]) => new THREE.Vector3(x, 0.05, z));
  return (
    <>
      <Line points={points} color="#38bdf8" lineWidth={2} dashed dashSize={0.4} gapSize={0.2} />
      {path.map(([x, z], i) => (
        <group key={i} position={[x, 0.1, z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.25, 0.4, 24]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
          <Html position={[0, 0.2, 0]} center distanceFactor={18}>
            <div className="text-[9px] font-mono text-sky-300 bg-black/60 px-1.5 rounded">WP{i + 1}</div>
          </Html>
        </group>
      ))}
    </>
  );
}

export default function Field3D({
  zones,
  waypoints,
  height = 360,
}: {
  zones: SprayZone[];
  waypoints?: [number, number][];
  height?: number;
}) {
  const path = waypoints ?? [
    [-10, -6], [10, -6], [10, -2], [-10, -2], [-10, 2], [10, 2], [10, 6], [-10, 6],
  ];

  return (
    <div style={{ height }} className="rounded-lg overflow-hidden bg-gradient-to-b from-sky-900 to-slate-900 border">
      <Canvas shadows camera={{ position: [16, 14, 16], fov: 38 }}>
        <Suspense fallback={null}>
          <fog attach="fog" args={["#0f172a", 25, 60]} />
          <ambientLight intensity={0.4} />
          <directionalLight position={[10, 18, 8]} intensity={1.2} castShadow
            shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
          <CropCarpet />
          <Grid args={[FIELD_W, FIELD_D]} position={[0, 0.01, 0]}
            cellColor="#ffffff" cellThickness={0.4} sectionColor="#ffffff"
            sectionThickness={0.8} fadeDistance={40} fadeStrength={1} infiniteGrid={false} />
          <WaypointPath path={path} />
          {zones.map((z, i) => <SprayBox key={i} zone={z} />)}
          <Drone path={path} />
          <OrbitControls
            enablePan={false}
            minDistance={12}
            maxDistance={40}
            maxPolarAngle={Math.PI / 2.2}
            autoRotate
            autoRotateSpeed={0.4}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
