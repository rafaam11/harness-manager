import type { Color } from 'claude-code'

// 막대·스파크라인·시간 포맷·색 고르기. 색은 테마 키라 밝은/어두운 테마 모두 맞는다.

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function heat(percent: number): Color {
  return percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'success'
}

function clampPercent(percent: number): number {
  return Math.min(100, Math.max(0, percent))
}

// [채운 부분, 빈 부분] — 색을 따로 입히려고 나눠 돌려준다.
export function bar(percent: number, cells: number, full = '█', empty = '░'): [string, string] {
  const filled = Math.round((clampPercent(percent) / 100) * cells)

  return [full.repeat(filled), empty.repeat(Math.max(0, cells - filled))]
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

export function sparkline(values: readonly number[], cells: number): string {
  const tail = values.slice(-cells)

  return tail.map(value => SPARK[Math.min(7, Math.floor((clampPercent(value) / 100) * 8))] ?? '▁').join('')
}

export function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) {
    return `${seconds}초`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return seconds % 60 === 0 || minutes >= 10 ? `${minutes}분` : `${minutes}분 ${seconds % 60}초`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return minutes % 60 === 0 ? `${hours}시간` : `${hours}시간 ${minutes % 60}분`
  }

  return hours % 24 === 0 ? `${Math.floor(hours / 24)}일` : `${Math.floor(hours / 24)}일 ${hours % 24}시간`
}

export function effortLabel(effort: string): string {
  return `effort ${effort}`
}

export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  if (seconds >= 3600) {
    return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  }

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function clockTime(ms: number): string {
  const date = new Date(ms)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function tokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  }

  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)
}

// "claude-opus-5-5[1m]" → "Opus 5.5"; 이미 사람이 읽는 이름이면 그대로.
export function prettyModel(model: string): string {
  const match = model.match(/claude-([a-z]+)-(\d+)(?:-(\d+))?/i)
  if (!match?.[1]) {
    return model.replace(/\[1m\]$/i, '')
  }
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1)

  return match[3] ? `${family} ${match[2]}.${match[3]}` : `${family} ${match[2]}`
}

// "claude-haiku-5-5" → "haiku"
export function modelFamily(model: string): string {
  return model.match(/(opus|sonnet|haiku|fable)/i)?.[1]?.toLowerCase() ?? model
}

export function modeColor(mode: string): Color {
  return mode === 'plan' ? 'planMode' : mode === 'acceptEdits' || mode === 'auto' ? 'autoAccept' : mode === 'bypassPermissions' ? 'error' : 'permission'
}

export function modeLabel(mode: string): string {
  return mode === 'acceptEdits'
    ? '⏵⏵ 편집 자동 승인'
    : mode === 'bypassPermissions'
      ? '⏵⏵ 권한 확인 생략'
      : mode === 'plan'
        ? '⏸ 계획 모드'
        : mode === 'auto'
          ? '⏵⏵ 자동 모드'
          : mode === 'dontAsk'
            ? '⏵⏵ 묻지 않음'
            : mode
}
