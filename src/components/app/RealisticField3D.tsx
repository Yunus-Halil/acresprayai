import { Suspense, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  OrbitControls, Sky, Stars, Cloud, Clouds, ContactShadows, Html, Line, Sparkles as DreiSparkles,
} from "@react-three/drei";
import * as THREE from "three";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sun, Moon, Plane, Wifi, Battery, Activity, Layers, Eye, EyeOff } from "lucide-react";

// ---------- field dims ----------
const W = 80;
const D = 56;
const SEG_X = 240;
const SEG_Z = 168;

// ---------- noise helpers ----------
function hash2(x: number, y: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t: number) { return t * t * (3 - 2 * t); }
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi),     b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x: number, y: number, oct = 4) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---------- terrain ----------
function Terrain() {
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(W, D, SEG_X, SEG_Z);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // gentle rolling height + ridges
      const h = fbm(x * 0.06 + 1.3, z * 0.06 + 4.1, 4) * 1.8
              + Math.sin(x * 0.15) * 0.15
              + fbm(x * 0.2, z * 0.2, 3) * 0.35;
      pos.setY(i, h - 0.4);

      // crop row striping along X
      const row = Math.sin(z * 6.0) * 0.5 + 0.5;
      // patchy health
      const health = fbm(x * 0.08 + 8.7, z * 0.08 + 2.3, 4);
      const dirtPatch = fbm(x * 0.18, z * 0.18, 3);

      let hue: number, sat: number, light: number;
      if (dirtPatch > 0.72) {
        // bare soil patch
        hue = 28 / 360; sat = 0.45; light = 0.20 + dirtPatch * 0.05;
      } else {
        // crop: lush green → yellow-stressed → brownish
        const greenness = THREE.MathUtils.clamp(health * 1.4 - 0.1, 0, 1);
        hue = THREE.MathUtils.lerp(40, 110, greenness) / 360;
        sat = 0.45 + greenness * 0.2;
        light = 0.18 + greenness * 0.18 + row * 0.04;
      }
      c.setHSL(hue, sat, light);
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, []);

  return (
    <mesh geometry={geom} receiveShadow castShadow>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0.0} />
    </mesh>
  );
}

// terrain height sampler (matches Terrain so drone can hover at altitude over ground)
function groundHeightAt(x: number, z: number) {
  return fbm(x * 0.06 + 1.3, z * 0.06 + 4.1, 4) * 1.8
       + Math.sin(x * 0.15) * 0.15
       + fbm(x * 0.2, z * 0.2, 3) * 0.35
       - 0.4;
}

// ---------- heatmap overlay ----------
type Mode = "ndvi" | "moisture" | "pest" | "yield" | "off";

const HEAT_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform int uMode;
  uniform float uOpacity;
  uniform float uTime;

  float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
  float noise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
    vec2 u=f*f*(3.-2.*f);
    return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;
  }
  float fbm(vec2 p){
    float v=0., a=0.5;
    for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.02; a*=0.5; }
    return v;
  }

  vec3 ramp(float t, int mode){
    t = clamp(t, 0., 1.);
    if (mode==0){ // NDVI red→yellow→green
      vec3 r=vec3(0.85,0.10,0.10);
      vec3 y=vec3(0.95,0.82,0.15);
      vec3 g=vec3(0.10,0.65,0.20);
      return t<0.5 ? mix(r,y,t*2.) : mix(y,g,(t-0.5)*2.);
    } else if (mode==1){ // moisture brown→cyan→blue
      vec3 br=vec3(0.45,0.30,0.15);
      vec3 cy=vec3(0.25,0.75,0.85);
      vec3 bl=vec3(0.10,0.30,0.85);
      return t<0.5 ? mix(br,cy,t*2.) : mix(cy,bl,(t-0.5)*2.);
    } else if (mode==2){ // pest pressure gray→orange→red
      vec3 gr=vec3(0.25,0.27,0.30);
      vec3 og=vec3(0.95,0.55,0.10);
      vec3 rd=vec3(0.90,0.10,0.10);
      return t<0.5 ? mix(gr,og,t*2.) : mix(og,rd,(t-0.5)*2.);
    } else { // yield blue→green→gold
      vec3 bl=vec3(0.10,0.25,0.65);
      vec3 gn=vec3(0.20,0.70,0.25);
      vec3 gd=vec3(0.95,0.80,0.15);
      return t<0.5 ? mix(bl,gn,t*2.) : mix(gn,gd,(t-0.5)*2.);
    }
  }

  void main(){
    vec2 p = vUv*vec2(8.,5.6);
    float v;
    if (uMode==0) {        // NDVI — high in most of field, patches of stress
      v = 0.55 + 0.45*fbm(p*1.3+vec2(2.,7.));
      v -= smoothstep(0.6,0.95,fbm(p*2.5))*0.6;
    } else if (uMode==1) { // moisture — wetter in valleys
      v = fbm(p*0.9 + vec2(uTime*0.02, 3.));
    } else if (uMode==2) { // pest — localized hotspots
      float h = pow(fbm(p*1.8+vec2(11.,4.)), 2.5);
      v = smoothstep(0.18,0.55,h);
    } else {               // yield prediction
      v = 0.4 + 0.6*fbm(p*1.1+vec2(20.,9.));
    }
    vec3 col = ramp(v, uMode);
    // subtle isobar contour lines
    float c = smoothstep(0.02,0.0, abs(fract(v*8.)-0.5)-0.45);
    col = mix(col, vec3(1.), c*0.12);
    gl_FragColor = vec4(col, uOpacity);
  }
`;
const HEAT_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }
`;

function HeatmapOverlay({ mode, opacity }: { mode: Mode; opacity: number }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(W, D, SEG_X, SEG_Z);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, groundHeightAt(x, z) + 0.04);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const modeInt = mode === "ndvi" ? 0 : mode === "moisture" ? 1 : mode === "pest" ? 2 : 3;
  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.getElapsedTime();
  });
  if (mode === "off") return null;
  return (
    <mesh geometry={geom} renderOrder={2}>
      <shaderMaterial
        ref={matRef}
        vertexShader={HEAT_VERT}
        fragmentShader={HEAT_FRAG}
        transparent
        depthWrite={false}
        uniforms={{
          uMode: { value: modeInt },
          uOpacity: { value: opacity },
          uTime: { value: 0 },
        }}
      />
    </mesh>
  );
}

// ---------- trees at borders ----------
function Trees() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(() => {
    const arr: { x: number; z: number; s: number; rot: number }[] = [];
    for (let i = 0; i < 90; i++) {
      const edge = Math.random();
      let x, z;
      if (edge < 0.5) {
        x = -W / 2 - 1 - Math.random() * 6;
        z = (Math.random() - 0.5) * (D + 12);
      } else {
        x = W / 2 + 1 + Math.random() * 6;
        z = (Math.random() - 0.5) * (D + 12);
      }
      arr.push({ x, z, s: 0.8 + Math.random() * 1.4, rot: Math.random() * Math.PI });
    }
    for (let i = 0; i < 40; i++) {
      arr.push({
        x: (Math.random() - 0.5) * (W + 14),
        z: Math.random() > 0.5 ? D / 2 + 2 + Math.random() * 5 : -D / 2 - 2 - Math.random() * 5,
        s: 0.8 + Math.random() * 1.4, rot: Math.random() * Math.PI,
      });
    }
    return arr;
  }, []);

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    data.forEach((t, i) => {
      const gh = groundHeightAt(t.x, t.z);
      dummy.position.set(t.x, gh + 1.4 * t.s, t.z);
      dummy.rotation.set(0, t.rot, 0);
      dummy.scale.set(t.s, t.s * (0.9 + Math.random() * 0.4), t.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      c.setHSL(0.28 + (Math.random() - 0.5) * 0.04, 0.55, 0.18 + Math.random() * 0.08);
      m.setColorAt(i, c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [data]);

  return (
    <>
      <instancedMesh ref={ref} args={[undefined as any, undefined as any, data.length]} castShadow>
        <coneGeometry args={[1.1, 3.0, 8]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      {/* trunks */}
      <group>
        {data.map((t, i) => {
          const gh = groundHeightAt(t.x, t.z);
          return (
            <mesh key={i} position={[t.x, gh + 0.4 * t.s, t.z]} castShadow>
              <cylinderGeometry args={[0.08 * t.s, 0.12 * t.s, 0.8 * t.s, 6]} />
              <meshStandardMaterial color="#3a2615" roughness={1} />
            </mesh>
          );
        })}
      </group>
    </>
  );
}

// ---------- drone ----------
function Drone({ path, scanOn, speed }: { path: [number, number][]; scanOn: boolean; speed: number }) {
  const group = useRef<THREE.Group>(null);
  const props = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  const spot = useRef<THREE.SpotLight>(null);
  const coneRef = useRef<THREE.Mesh>(null);
  const trail = useRef<{ x: number; z: number; t: number }[]>([]);
  const trailMesh = useRef<THREE.Line>(null);

  useFrame(({ clock }) => {
    if (path.length < 2) return;
    const t = (clock.getElapsedTime() * 0.02 * speed) % 1;
    const seg = t * (path.length - 1);
    const i = Math.floor(seg);
    const f = seg - i;
    const [x1, z1] = path[i];
    const [x2, z2] = path[Math.min(i + 1, path.length - 1)];
    const x = x1 + (x2 - x1) * f;
    const z = z1 + (z2 - z1) * f;
    const alt = 6.5 + Math.sin(clock.getElapsedTime() * 1.5) * 0.12;
    const y = groundHeightAt(x, z) + alt;

    if (group.current) {
      group.current.position.set(x, y, z);
      const yaw = Math.atan2(x2 - x1, z2 - z1);
      group.current.rotation.y = yaw;
      // slight pitch / roll
      group.current.rotation.x = -0.08;
      group.current.rotation.z = Math.sin(clock.getElapsedTime() * 1.2) * 0.04;
    }
    const ps = clock.getElapsedTime() * 80;
    props.forEach((p, idx) => { if (p.current) p.current.rotation.y = ps * (idx % 2 ? 1 : -1); });

    if (spot.current) {
      spot.current.position.set(x, y, z);
      spot.current.target.position.set(x, groundHeightAt(x, z), z);
      spot.current.target.updateMatrixWorld();
    }
    if (coneRef.current) {
      const gh = groundHeightAt(x, z);
      const h = y - gh;
      coneRef.current.position.set(x, gh + h / 2, z);
      coneRef.current.scale.set(h * 0.6, h, h * 0.6);
      const mat = coneRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = scanOn ? 0.14 + Math.sin(clock.getElapsedTime() * 4) * 0.05 : 0;
    }

    // trail
    const now = clock.getElapsedTime();
    trail.current.push({ x, z, t: now });
    trail.current = trail.current.filter(p => now - p.t < 6).slice(-120);
    if (trailMesh.current) {
      const pts = trail.current.map(p => new THREE.Vector3(p.x, groundHeightAt(p.x, p.z) + 0.08, p.z));
      (trailMesh.current.geometry as THREE.BufferGeometry).setFromPoints(pts);
    }
  });

  return (
    <>
      <group ref={group}>
        {/* main body */}
        <mesh castShadow>
          <boxGeometry args={[0.7, 0.18, 0.45]} />
          <meshStandardMaterial color="#15171b" metalness={0.85} roughness={0.25} />
        </mesh>
        {/* top hump */}
        <mesh position={[0, 0.13, 0]} castShadow>
          <boxGeometry args={[0.5, 0.1, 0.3]} />
          <meshStandardMaterial color="#0b0c0f" metalness={0.6} roughness={0.4} />
        </mesh>
        {/* gimbal */}
        <group position={[0, -0.13, 0.18]}>
          <mesh>
            <sphereGeometry args={[0.1, 16, 12]} />
            <meshStandardMaterial color="#0a0a0a" metalness={0.9} roughness={0.15} />
          </mesh>
          <mesh position={[0, 0, 0.07]}>
            <cylinderGeometry args={[0.045, 0.045, 0.05, 16]} rotateZ={Math.PI/2 as any} />
            <meshStandardMaterial color="#1a8bff" emissive="#1a8bff" emissiveIntensity={0.4} />
          </mesh>
        </group>
        {/* arms + motors + props */}
        {[[ 0.55, 0,  0.35],[-0.55, 0,  0.35],[ 0.55, 0, -0.35],[-0.55, 0, -0.35]].map((p, i) => (
          <group key={i} position={p as any}>
            <mesh rotation={[0, 0, 0]} castShadow>
              <cylinderGeometry args={[0.04, 0.04, 0.55, 8]} rotateZ={Math.PI/2 as any} />
              <meshStandardMaterial color="#2a2d33" metalness={0.6} roughness={0.4} />
            </mesh>
            <mesh position={[0, 0.06, 0]}>
              <cylinderGeometry args={[0.07, 0.07, 0.1, 12]} />
              <meshStandardMaterial color="#0e1014" metalness={0.7} roughness={0.3} />
            </mesh>
            <mesh ref={props[i]} position={[0, 0.13, 0]}>
              <boxGeometry args={[0.95, 0.012, 0.06]} />
              <meshStandardMaterial color="#cccccc" transparent opacity={0.45} />
            </mesh>
          </group>
        ))}
        {/* landing skids */}
        {[-0.25, 0.25].map((sx, i) => (
          <mesh key={i} position={[sx, -0.15, 0]}>
            <boxGeometry args={[0.03, 0.18, 0.45]} />
            <meshStandardMaterial color="#0a0a0a" />
          </mesh>
        ))}
        {/* LEDs */}
        <mesh position={[0, -0.05, 0.24]}><sphereGeometry args={[0.03,8,8]} /><meshStandardMaterial color="#33ff66" emissive="#33ff66" emissiveIntensity={3} /></mesh>
        <mesh position={[0, -0.05,-0.24]}><sphereGeometry args={[0.03,8,8]} /><meshStandardMaterial color="#ff3344" emissive="#ff3344" emissiveIntensity={3} /></mesh>
        <pointLight color="#33ff66" intensity={0.6} distance={4} />
      </group>

      {/* spotlight from drone */}
      <spotLight
        ref={spot}
        angle={0.45}
        penumbra={0.55}
        intensity={scanOn ? 110 : 30}
        distance={28}
        color={scanOn ? "#9ad8ff" : "#fff5d0"}
        castShadow={false}
      />

      {/* scan cone */}
      <mesh ref={coneRef} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[1, 1, 32, 1, true]} />
        <meshBasicMaterial color="#7dd3fc" transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* flight trail */}
      <line ref={trailMesh as any}>
        <bufferGeometry />
        <lineBasicMaterial color="#38bdf8" transparent opacity={0.7} />
      </line>
    </>
  );
}

// ---------- waypoint markers ----------
function Waypoints({ path }: { path: [number, number][] }) {
  return (
    <>
      {path.map(([x, z], i) => {
        const y = groundHeightAt(x, z) + 0.05;
        return (
          <mesh key={i} position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.55, 0.85, 28]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.7} />
          </mesh>
        );
      })}
    </>
  );
}

// ---------- sun / sky ----------
function SunRig({ timeOfDay }: { timeOfDay: number }) {
  // 0..1 maps to dawn..noon..dusk..night
  const angle = (timeOfDay - 0.25) * Math.PI * 2; // noon at 0.25
  const elev = Math.sin(angle);
  const azim = Math.cos(angle);
  const sunDir = new THREE.Vector3(azim * 60, Math.max(-20, elev * 60), 30).normalize();
  const sunPos: [number, number, number] = [sunDir.x * 80, sunDir.y * 80, sunDir.z * 80];
  const isNight = elev < -0.1;
  return (
    <>
      <Sky
        distance={4500}
        sunPosition={sunPos}
        turbidity={isNight ? 18 : 4}
        rayleigh={isNight ? 0.2 : 2.4}
        mieCoefficient={0.005}
        mieDirectionalG={0.85}
      />
      {isNight && <Stars radius={120} depth={50} count={4000} factor={4} fade speed={1} />}
      <ambientLight intensity={isNight ? 0.08 : 0.35} color={isNight ? "#1d2a44" : "#cfe7ff"} />
      <hemisphereLight args={[isNight ? "#1c2a44" : "#bcdcff", "#3a2a14", 0.6]} />
      <directionalLight
        position={sunPos}
        intensity={isNight ? 0.05 : Math.max(0.2, elev) * 2.4}
        color={elev < 0.15 && !isNight ? "#ffb070" : "#fff3d6"}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-near={1}
        shadow-camera-far={200}
      />
    </>
  );
}

// ---------- the scene ----------
export default function RealisticField3D({ height = 620 }: { height?: number }) {
  const [mode, setMode] = useState<Mode>("ndvi");
  const [heatOpacity, setHeatOpacity] = useState(0.62);
  const [scanOn, setScanOn] = useState(true);
  const [tod, setTod] = useState(0.28);
  const [speed, setSpeed] = useState(1);
  const [showClouds, setShowClouds] = useState(true);

  // lawnmower path
  const path = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    const rows = 8;
    const xMin = -W / 2 + 6, xMax = W / 2 - 6;
    for (let r = 0; r < rows; r++) {
      const z = -D / 2 + 6 + (r * (D - 12)) / (rows - 1);
      pts.push([r % 2 === 0 ? xMin : xMax, z]);
      pts.push([r % 2 === 0 ? xMax : xMin, z]);
    }
    return pts;
  }, []);

  const modes: { id: Mode; label: string; legend: [string, string, string] }[] = [
    { id: "ndvi",     label: "NDVI",        legend: ["Stress", "Mid", "Vigor"] },
    { id: "moisture", label: "Moisture",    legend: ["Dry",    "Mid", "Wet"]    },
    { id: "pest",     label: "Pest risk",   legend: ["Low",    "Mid", "High"]   },
    { id: "yield",    label: "Yield est.",  legend: ["Low",    "Mid", "Top"]    },
    { id: "off",      label: "Off",         legend: ["", "", ""] },
  ];

  return (
    <div style={{ height }} className="relative rounded-xl overflow-hidden border bg-gradient-to-b from-sky-950 to-slate-950">
      <Canvas shadows dpr={[1, 1.8]} camera={{ position: [38, 28, 38], fov: 38, near: 0.5, far: 400 }}>
        <Suspense fallback={null}>
          <fog attach="fog" args={[tod > 0.6 || tod < 0.05 ? "#0b1224" : "#cfe2ff", 90, 220]} />
          <SunRig timeOfDay={tod} />

          <Terrain />
          <HeatmapOverlay mode={mode} opacity={heatOpacity} />
          <Trees />

          {showClouds && (
            <Clouds material={THREE.MeshBasicMaterial}>
              <Cloud segments={20} bounds={[14, 2, 6]} volume={6} color="#ffffff" opacity={0.55} position={[-10, 22, -8]} />
              <Cloud segments={20} bounds={[18, 2, 6]} volume={8} color="#ffffff" opacity={0.45} position={[14, 26,  6]} />
              <Cloud segments={20} bounds={[12, 2, 6]} volume={6} color="#ffffff" opacity={0.5}  position={[ 2, 30, -22]} />
            </Clouds>
          )}

          <Waypoints path={path} />
          <Drone path={path} scanOn={scanOn} speed={speed} />

          {/* dust / pollen */}
          <DreiSparkles count={80} scale={[W, 6, D]} position={[0, 3, 0]} size={2} speed={0.2} opacity={0.4} color="#e8e0bf" />

          <ContactShadows position={[0, -0.45, 0]} opacity={0.35} scale={W + 10} blur={2.6} far={20} />

          <OrbitControls
            enablePan
            minDistance={10}
            maxDistance={110}
            maxPolarAngle={Math.PI / 2.1}
            target={[0, 0, 0]}
          />
        </Suspense>
      </Canvas>

      {/* top-left HUD */}
      <div className="absolute top-3 left-3 flex flex-col gap-2 pointer-events-none">
        <div className="px-2.5 py-1 rounded bg-black/60 backdrop-blur text-white/90 text-[10px] font-mono uppercase tracking-wider">
          B-04 North · 14.2 ha · 47.2184N 2.0411E
        </div>
        <div className="px-2.5 py-1 rounded bg-black/60 backdrop-blur text-emerald-300 text-[10px] font-mono flex items-center gap-2 w-fit">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> AGV-04 · LIVE TELEMETRY
        </div>
      </div>

      {/* top-right telemetry */}
      <div className="absolute top-3 right-3 grid grid-cols-2 gap-2 text-[10px] font-mono text-white/90 pointer-events-none">
        <div className="px-2 py-1 rounded bg-black/55 backdrop-blur flex items-center gap-1"><Battery className="h-3 w-3" /> 64%</div>
        <div className="px-2 py-1 rounded bg-black/55 backdrop-blur flex items-center gap-1"><Wifi className="h-3 w-3" /> 92%</div>
        <div className="px-2 py-1 rounded bg-black/55 backdrop-blur flex items-center gap-1"><Activity className="h-3 w-3" /> 14 m/s</div>
        <div className="px-2 py-1 rounded bg-black/55 backdrop-blur flex items-center gap-1"><Plane className="h-3 w-3" /> 6.5 m AGL</div>
      </div>

      {/* bottom control bar */}
      <Card className="absolute bottom-3 left-3 right-3 p-3 bg-background/85 backdrop-blur border-border/60">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Overlay</span>
            <div className="flex gap-1">
              {modes.map(m => (
                <Button
                  key={m.id}
                  size="sm"
                  variant={mode === m.id ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setMode(m.id)}
                >{m.label}</Button>
              ))}
            </div>
          </div>

          {mode !== "off" && (
            <div className="flex items-center gap-2 min-w-[180px]">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Opacity</Label>
              <Slider value={[heatOpacity * 100]} max={100} step={1} className="w-32"
                onValueChange={v => setHeatOpacity(v[0] / 100)} />
            </div>
          )}

          <div className="flex items-center gap-2 min-w-[220px]">
            {tod > 0.55 || tod < 0.05 ? <Moon className="h-4 w-4 text-sky-300" /> : <Sun className="h-4 w-4 text-amber-400" />}
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Time</Label>
            <Slider value={[tod * 100]} max={100} step={1} className="w-40"
              onValueChange={v => setTod(v[0] / 100)} />
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Drone speed</Label>
            <Slider value={[speed * 50]} max={150} step={5} className="w-28"
              onValueChange={v => setSpeed(Math.max(0.1, v[0] / 50))} />
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={scanOn} onCheckedChange={setScanOn} id="scan" />
            <Label htmlFor="scan" className="text-xs flex items-center gap-1">
              {scanOn ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />} Active scan
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={showClouds} onCheckedChange={setShowClouds} id="cl" />
            <Label htmlFor="cl" className="text-xs">Clouds</Label>
          </div>

          {mode !== "off" && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{modes.find(m => m.id === mode)?.label}</span>
              <div className="h-3 w-40 rounded-full" style={{
                background: mode === "ndvi"     ? "linear-gradient(90deg,#d91b1b,#f3d126,#1aa53a)" :
                            mode === "moisture" ? "linear-gradient(90deg,#73501f,#3fbed8,#1a4ed8)" :
                            mode === "pest"     ? "linear-gradient(90deg,#43474f,#f08a1a,#e51a1a)" :
                                                  "linear-gradient(90deg,#1a3fa3,#33b240,#f1ce26)",
              }} />
              <div className="flex flex-col text-[9px] leading-tight text-muted-foreground -ml-1">
                <span>{modes.find(m => m.id === mode)?.legend[0]} → {modes.find(m => m.id === mode)?.legend[2]}</span>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}