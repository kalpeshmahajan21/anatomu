import { Canvas } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { BuildDirector } from './BuildDirector'
import { CameraRig } from './CameraRig'
import { Floor } from './Floor'
import { Layers } from './LayerModel'
import { Picker } from './Picker'

export function Scene() {
  return (
    <Canvas
      // Only render when something changes (camera moves, hover, etc.). Saves battery
      // and keeps phones cool; camera-controls requests frames while it's moving.
      frameloop="demand"
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
      camera={{ fov: 35, position: [0, 0, 5] }}
      style={{ touchAction: 'none' }}
    >
      {/* Soft studio lighting: a tiny generated environment (no HDR download) + key/rim lights. */}
      <Environment resolution={64} frames={1}>
        <Lightformer intensity={1.6} position={[0, 4, 4]} scale={[8, 3, 1]} />
        <Lightformer intensity={0.8} position={[-5, 1, -2]} rotation-y={Math.PI / 2} scale={[6, 6, 1]} />
        <Lightformer intensity={0.5} position={[5, 0, 1]} rotation-y={-Math.PI / 2} scale={[6, 6, 1]} />
      </Environment>
      <hemisphereLight args={['#dfe6ff', '#2a2420', 0.6]} />
      <directionalLight position={[2, 4, 5]} intensity={1.4} />
      <directionalLight position={[-3, 2, -4]} intensity={0.7} color="#bcd2ff" />

      <Floor />
      <Layers />
      <Picker />
      <CameraRig />
      <BuildDirector />
    </Canvas>
  )
}
