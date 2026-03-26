import React, { useEffect, useRef, useState } from "react"

interface ThinkingProps {
  "aria-label"?: string
  className?: string
  initialDots?: number
  interval?: number
  maxDots?: number
  startTime?: string | number
}

export const Thinking: React.FC<ThinkingProps> = ({
  "aria-label": ariaLabel = "Loading",
  className = "",
  initialDots = 1,
  interval = 500,
  maxDots = 3,
  startTime,
}) => {
  const [dots, setDots] = useState(initialDots)
  const timerRef = useRef<HTMLSpanElement>(null)
  const rafRef = useRef<number>()

  useEffect(() => {
    const i = setInterval(() => {
      setDots((prevDots) => (prevDots % maxDots) + 1)
    }, interval)

    return () => clearInterval(i)
  }, [interval, maxDots])

  useEffect(() => {
    if (!startTime) return
    const start = typeof startTime === "string" ? new Date(startTime).getTime() : startTime

    const tick = () => {
      if (timerRef.current) {
        const elapsed = (Date.now() - start) / 1000
        timerRef.current.textContent = `${elapsed.toFixed(1)}s`
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [startTime])

  const renderDots = () => {
    return ".".repeat(dots)
  }

  return (
    <span className={className} aria-label={ariaLabel}>
      {renderDots()}
      {startTime && <span ref={timerRef} className="ml-1 opacity-50 tabular-nums" />}
    </span>
  )
}

export default Thinking
