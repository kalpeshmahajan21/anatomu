import { useEffect } from 'react'
import { Scene } from './viewer/Scene'
import { HoverLabel } from './ui/HoverLabel'
import { Hint } from './ui/Hint'
import { InfoPanel } from './ui/InfoPanel'
import { LayerBar } from './ui/LayerBar'
import { LoadingScreen } from './ui/LoadingScreen'
import { SearchBar } from './ui/SearchBar'
import { SexSwitch } from './ui/SexSwitch'
import { Toolbar } from './ui/Toolbar'
import { useKeyboard } from './ui/useKeyboard'
import { useStore } from './store'

export default function App() {
  const loadIndex = useStore((s) => s.loadIndex)
  useKeyboard()

  useEffect(() => {
    void loadIndex()
  }, [loadIndex])

  return (
    <div className="studio-bg fixed inset-0 overflow-hidden">
      <div className="absolute inset-0">
        <Scene />
      </div>

      <LoadingScreen />
      <HoverLabel />

      {/* UI overlay. pointer-events-none on wrappers so empty areas still reach the 3D view. */}
      {/* md:pl leaves room for the Male/Female switch on tablet-width windows. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 px-4 pt-[max(12px,env(safe-area-inset-top))] md:pt-4 md:pl-[232px] lg:pl-4">
        <div className="mx-auto max-w-md pr-12 md:pr-0">
          <SearchBar />
        </div>
      </div>

      {/* Male / Female switch: top-left (desktop) / under the search bar (phone). */}
      <div className="pointer-events-none absolute top-[calc(max(12px,env(safe-area-inset-top))+56px)] left-4 w-[200px] md:top-4 md:left-4">
        <SexSwitch />
      </div>

      {/* Camera toolbar: right edge, vertically centred (desktop) / top-right (phone). */}
      <div className="pointer-events-none absolute top-[max(12px,env(safe-area-inset-top))] right-3 md:top-1/2 md:right-4 md:-translate-y-1/2">
        <div className="origin-top-right scale-[0.88] md:scale-100">
          <Toolbar />
        </div>
      </div>

      {/* Info panel: right side next to the toolbar (desktop) / bottom sheet (phone). */}
      <div className="pointer-events-none absolute inset-x-3 bottom-[calc(84px+env(safe-area-inset-bottom))] flex justify-center md:inset-x-auto md:top-4 md:right-[76px] md:bottom-auto">
        <InfoPanel />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-[max(8px,env(safe-area-inset-bottom))]">
        <div className="mb-3 flex justify-center">
          <Hint />
        </div>
        <LayerBar />
        <p className="mt-1.5 text-center text-[10px] text-white/30">
          3D models:{' '}
          <a className="pointer-events-auto underline-offset-2 hover:underline" href="https://www.z-anatomy.com/" target="_blank" rel="noreferrer">
            Z-Anatomy
          </a>{' '}
          &amp;{' '}
          <a className="pointer-events-auto underline-offset-2 hover:underline" href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/" target="_blank" rel="noreferrer">
            BodyParts3D (DBCLS)
          </a>
          ,{' '}
          <a className="pointer-events-auto underline-offset-2 hover:underline" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
            CC BY-SA 4.0
          </a>
          <span className="hidden sm:inline">
            {' · '}Female anatomy:{' '}
            <a className="pointer-events-auto underline-offset-2 hover:underline" href="https://humanatlas.io/3d-reference-library" target="_blank" rel="noreferrer">
              NIH Human Reference Atlas
            </a>
            , CC BY 4.0
          </span>
        </p>
      </div>
    </div>
  )
}
