import { ShaderGradient, ShaderGradientCanvas } from '@shadergradient/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { MoneyBag02Icon } from '@hugeicons/core-free-icons'

export function Logo() {
  return (
    <div className="relative flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sidebar-primary-foreground">
      <ShaderGradientCanvas style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <ShaderGradient
          animate="on"
          brightness={3}
          cAzimuthAngle={269}
          cDistance={1.5}
          cPolarAngle={146}
          cameraZoom={18.61}
          color1="#315f48"
          color2="#00d9ff"
          color3="#3700ff"
          envPreset="city"
          grain="off"
          lightType="3d"
          positionX={0}
          positionY={0}
          positionZ={0}
          range="disabled"
          rangeEnd={40}
          rangeStart={0}
          reflection={0.6}
          rotationX={0}
          rotationY={0}
          rotationZ={140}
          shader="defaults"
          type="sphere"
          uAmplitude={1}
          uDensity={5}
          uFrequency={5.5}
          uSpeed={0.03}
          uStrength={0.2}
          uTime={0}
          wireframe={false}
        />
      </ShaderGradientCanvas>
      <HugeiconsIcon icon={MoneyBag02Icon} size={16} className="relative" />
    </div>
  )
}
