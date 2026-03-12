import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/primitives/Button"
import useAudioStore from "@/stores/audio"
import useGameStore from "@/stores/game"

import { BaseDialog } from "./BaseDialog"

const TUTORIAL_VIDEO_URL =
  "https://api.gradient-bang.com/storage/v1/object/public/GB%20Public/tutorial.mp4"

export const IntroTutorial = ({ onContinue }: { onContinue: () => void }) => {
  const setActiveModal = useGameStore.use.setActiveModal()
  const activeModal = useGameStore.use.activeModal?.()
  const isOpen = activeModal?.modal === "intro_tutorial"
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (isOpen) {
      useAudioStore.getState().fadeOut("theme", { duration: 1500 })
    }
  }, [isOpen])

  const handleSkip = () => {
    setActiveModal(undefined)
    onContinue()
  }

  const handleEnded = () => {
    setActiveModal(undefined)
    onContinue()
  }

  return (
    <BaseDialog
      modalName="intro_tutorial"
      title="Welcome"
      size="full"
      overlayVariant="none"
      noPadding
      dismissOnClickOutside={false}
      showCloseButton={false}
      contentClassName="h-screen z-[100]"
      overlayClassName="z-[100]"
    >
      <div
        className="relative w-full h-full flex items-center justify-center bg-black"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <video
          ref={videoRef}
          src={TUTORIAL_VIDEO_URL}
          className="max-w-480 max-h-270 w-full h-full object-contain"
          autoPlay
          playsInline
          preload="auto"
          controls={hovered}
          onEnded={handleEnded}
        />
        <div className="fixed top-ui-md right-ui-md z-10">
          <Button variant="ghost" size="sm" onClick={handleSkip}>
            Skip
          </Button>
        </div>
      </div>
    </BaseDialog>
  )
}
