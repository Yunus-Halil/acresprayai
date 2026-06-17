import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Center } from "@react-three/drei";
import { OBJLoader } from "three-stdlib";
import JSZip from "jszip";
import * as THREE from "three";
import { Loader2 } from "lucide-react";

export function Model3DViewer({ zipUrl, height = 420 }: { zipUrl: string; height?: number }) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setErr(null); setGroup(null);
      try {
        const res = await fetch(zipUrl);
        if (!res.ok) throw new Error("Failed to fetch model archive");
        const buf = await res.arrayBuffer();
        const zip = await JSZip.loadAsync(buf);
        // Find first .obj in the archive (ODM puts it at odm_texturing/odm_textured_model_geo.obj)
        const objEntry = Object.values(zip.files).find(
          (f) => !f.dir && f.name.toLowerCase().endsWith(".obj"),
        );
        if (!objEntry) throw new Error("No .obj file found inside archive");
        const text = await objEntry.async("string");
        const loader = new OBJLoader();
        const obj = loader.parse(text);
        // Apply a neutral material so it renders without textures
        obj.traverse((c: any) => {
          if (c.isMesh) {
            c.material = new THREE.MeshStandardMaterial({
              color: 0x6a9955, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide,
            });
          }
        });
        if (!cancel) setGroup(obj);
      } catch (e: any) {
        if (!cancel) setErr(e?.message ?? "Failed to load model");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [zipUrl]);

  return (
    <div className="relative rounded-lg overflow-hidden border bg-[hsl(var(--field))]" style={{ height }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm gap-2 z-10">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading 3D model...
        </div>
      )}
      {err && (
        <div className="absolute inset-0 flex items-center justify-center text-red-300 text-sm z-10 p-4 text-center">{err}</div>
      )}
      <Canvas camera={{ position: [8, 6, 8], fov: 45 }} dpr={[1, 2]}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 5]} intensity={1.1} />
        <directionalLight position={[-5, 5, -5]} intensity={0.4} />
        <Grid args={[30, 30]} cellColor="#333" sectionColor="#555" infiniteGrid fadeDistance={50} />
        <Suspense fallback={null}>
          {group && (
            <Center>
              <primitive object={group} />
            </Center>
          )}
        </Suspense>
        <OrbitControls makeDefault enableDamping />
      </Canvas>
    </div>
  );
}