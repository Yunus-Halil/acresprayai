import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Grid, Html, Line } from "@react-three/drei";
import * as THREE from "three";

export type FieldLayout = "rows" | "orchard" | "pivot" | "terraced";

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

type CropInstance = {
  x: number; z: number; h: number; r: number;
  color: string; health: number; stage: string;
};

function generateCrops(layout: FieldLayout, cropType: string): CropInstance[] {
  const a: CropInstance[] = [];
  const stages = ["Tillering", "Stem elongation", "Heading", "Flowering", "Grain fill", "Ripening"];
  const pick = (n: number) => stages[Math.floor((n + 1) * 0.5 * stages.length) % stages.length];

  const push = (x: number, z: number, h: number, r: number, healthBias = 0) => {
    const n = Math.sin(x * 0.7) * Math.cos(z * 0.5) * 0.5 + (Math.random() - 0.5) * 0.4 + healthBias;
    const health = Math.max(20, Math.min(99, Math.round(70 + n * 35)));
    const healthy = health > 65;
    const color = healthy
      ? `hsl(${95 + n * 25}, 55%, ${32 + (n + 0.5) * 14}%)`
      : `hsl(${48 + n * 18}, 50%, 46%)`;
    a.push({ x, z, h, r, color, health, stage: pick(n) });
  };

  if (layout === "rows") {
    for (let x = -FIELD_W / 2 + 0.5; x < FIELD_W / 2; x += 0.6) {
      for (let z = -FIELD_D / 2 + 0.5; z < FIELD_D / 2; z += 0.6) {
        push(x, z, 0.28 + Math.random() * 0.15, 0.22);
      }
    }
  } else if (layout === "orchard") {
    for (let x = -FIELD_W / 2 + 1.2; x < FIELD_W / 2; x += 1.6) {
      for (let z = -FIELD_D / 2 + 1.2; z < FIELD_D / 2; z += 1.6) {
        push(x + (Math.random() - 0.5) * 0.1, z + (Math.random() - 0.5) * 0.1,
          0.9 + Math.random() * 0.4, 0.55);
      }
    }
  } else if (layout === "pivot") {
    const cx = 0, cz = 0, maxR = Math.min(FIELD_W, FIELD_D) / 2 - 0.5;
    for (let r = 0.8; r < maxR; r += 0.7) {
      const count = Math.max(6, Math.floor(r * 6));
      for (let i = 0; i < count; i++) {
        const a2 = (i / count) * Math.PI * 2;
        push(cx + Math.cos(a2) * r, cz + Math.sin(a2) * r,
          0.3 + Math.random() * 0.12, 0.22);
      }
    }
  } else if (layout === "terraced") {
    const bands = 5;
    for (let b = 0; b < bands; b++) {
      const z0 = -FIELD_D / 2 + (b * FIELD_D) / bands + 0.4;
      const z1 = z0 + FIELD_D / bands - 0.5;
      const elev = b * 0.18;
      for (let x = -FIELD_W / 2 + 0.5; x < FIELD_W / 2; x += 0.55) {
        for (let z = z0; z < z1; z += 0.55) {
          const inst: CropInstance = {
            x, z, h: 0.25 + Math.random() * 0.12, r: 0.22,
            color: "", health: 0, stage: "",
          };
          push(x, z, inst.h + elev, 0.22, b * 0.05);
          a[a.length - 1].h += elev; // sit on terrace
        }
      }
    }
  }
  return a;
}

function Crops({ layout, cropType, onHoverCrop }: {
  layout: FieldLayout; cropType: string;
  onHoverCrop: (c: (CropInstance & { type: string }) | null) => void;
}) {
  const items = useMemo(() => generateCrops(layout, cropType), [layout, cropType]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const isOrchard = layout === "orchard";

  useEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.h / 2, it.z);
      const sx = it.r / (isOrchard ? 0.4 : 0.225);
      const sy = it.h / (isOrchard ? 1.0 : 0.3);
      dummy.scale.set(sx, sy, sx);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      color.set(it.color);
      m.setColorAt(i, color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [items, isOrchard]);

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const id = e.instanceId;
    if (id == null) return;
    const it = items[id];
    if (it) onHoverCrop({ ...it, type: cropType });
  };

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FIELD_W, FIELD_D]} />
        <meshStandardMaterial color={layout === "pivot" ? "#2f2110" : "#3a2817"} />
      </mesh>
      {layout === "pivot" && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
          <circleGeometry args={[Math.min(FIELD_W, FIELD_D) / 2 - 0.2, 64]} />
          <meshStandardMaterial color="#4a3322" />
        </mesh>
      )}
      <instancedMesh
        ref={meshRef}
        args={[undefined as any, undefined as any, Math.max(1, items.length)]}
        onPointerMove={handleMove}
        onPointerOut={() => onHoverCrop(null)}
        castShadow
      >
        {isOrchard ? (
          <sphereGeometry args={[0.4, 10, 8]} />
        ) : (
          <boxGeometry args={[0.45, 0.3, 0.45]} />
        )}
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
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
    if (path.length < 1) return;
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
  if (path.length < 2) return null;
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
  editable = false,
  onWaypointsChange,
  layout = "rows",
  cropType = "Crop",
}: {
  zones: SprayZone[];
  waypoints?: [number, number][];
  height?: number;
  editable?: boolean;
  onWaypointsChange?: (wp: [number, number][]) => void;
  layout?: FieldLayout;
  cropType?: string;
}) {
  const path = waypoints ?? [
    [-10, -6], [10, -6], [10, -2], [-10, -2], [-10, 2], [10, 2], [10, 6], [-10, 6],
  ];
  const [hoverCrop, setHoverCrop] = useState<(CropInstance & { type: string }) | null>(null);

  return (
    <div style={{ height }} className="relative rounded-lg overflow-hidden bg-gradient-to-b from-sky-900 to-slate-900 border">
      <Canvas shadows camera={{ position: [16, 14, 16], fov: 38 }}>
        <Suspense fallback={null}>
          <fog attach="fog" args={["#0f172a", 25, 60]} />
          <ambientLight intensity={0.4} />
          <directionalLight position={[10, 18, 8]} intensity={1.2} castShadow
            shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
          <Crops layout={layout} cropType={cropType} onHoverCrop={setHoverCrop} />
          <Grid args={[FIELD_W, FIELD_D]} position={[0, 0.01, 0]}
            cellColor="#ffffff" cellThickness={0.4} sectionColor="#ffffff"
            sectionThickness={0.8} fadeDistance={40} fadeStrength={1} infiniteGrid={false} />
          {hoverCrop && (
            <Html position={[hoverCrop.x, hoverCrop.h + 0.6, hoverCrop.z]} center distanceFactor={10} zIndexRange={[100, 0]}>
              <div className="pointer-events-none px-2.5 py-1.5 rounded-md text-[10px] font-mono whitespace-nowrap text-white bg-black/85 border border-white/15 shadow-xl">
                <div className="font-semibold text-[11px]">{hoverCrop.type}</div>
                <div className="opacity-80">Health <span className={hoverCrop.health >= 70 ? "text-emerald-300" : hoverCrop.health >= 50 ? "text-amber-300" : "text-red-300"}>{hoverCrop.health}%</span></div>
                <div className="opacity-60">{hoverCrop.stage}</div>
              </div>
            </Html>
          )}
          {editable && (
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0.03, 0]}
              onClick={(e) => {
                e.stopPropagation();
                const x = Math.max(-FIELD_W / 2, Math.min(FIELD_W / 2, e.point.x));
                const z = Math.max(-FIELD_D / 2, Math.min(FIELD_D / 2, e.point.z));
                onWaypointsChange?.([...(path as [number, number][]), [x, z]]);
              }}
            >
              <planeGeometry args={[FIELD_W, FIELD_D]} />
              <meshBasicMaterial transparent opacity={0} />
            </mesh>
          )}
          <WaypointPath path={path} />
          {zones.map((z, i) => <SprayBox key={i} zone={z} />)}
          <Drone path={path} />
          <OrbitControls
            enablePan={false}
            minDistance={6}
            maxDistance={40}
            maxPolarAngle={Math.PI / 2.2}
            autoRotate={!editable}
            autoRotateSpeed={0.4}
          />
        </Suspense>
      </Canvas>
      <div className="absolute top-2 left-2 px-2 py-1 rounded bg-black/55 text-white/85 text-[10px] font-mono uppercase tracking-wider pointer-events-none backdrop-blur-sm">
        {layout} · zoom in to inspect crops
      </div>
    </div>
  );
}
