export type GameSound = 'move' | 'capture' | 'check' | 'low-time'

const notes: Record<GameSound, number[]> = {
  move: [440],
  capture: [330, 220],
  check: [660, 880],
  'low-time': [880, 660, 880],
}

// Synthesized locally: no audio downloads, services or autoplay while muted.
export class GameAudio {
  private context: AudioContext | null = null

  unlock() {
    try {
      this.context ??= new AudioContext()
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {})
    } catch {
      // Audio is optional on browsers/devices without Web Audio support.
    }
  }

  play(sound: GameSound) {
    const context = this.context
    if (!context || context.state !== 'running') return
    try {
      notes[sound].forEach((frequency, index) => {
        const start = context.currentTime + index * 0.11
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.value = frequency
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(0.09, start + 0.008)
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.09)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.onended = () => {
          oscillator.disconnect()
          gain.disconnect()
        }
        oscillator.start(start)
        oscillator.stop(start + 0.1)
      })
    } catch {
      // A suspended or closed audio device must not interrupt a game.
    }
  }

  close() {
    if (this.context) void this.context.close().catch(() => {})
    this.context = null
  }
}
