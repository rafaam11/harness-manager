import type { Color } from 'claude-code'

// 터미널 셀 단위로 줄을 정확히 맞추기 위한 조각(span)과 너비 계산.

export type Span = { text: string; color?: Color; dim?: boolean; bold?: boolean }

export type Line = Span[]

// 한 조각 묶음과 그 우선순위(숫자가 작을수록 중요). 넘치면 큰 숫자부터 버린다.
export type Chunk = { spans: Span[]; prio: number }

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

function isZeroWidth(code: number): boolean {
  return (code >= 0x0300 && code <= 0x036f) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)
}

export function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0

  return isZeroWidth(code) ? 0 : isWide(code) ? 2 : 1
}

export function textWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += charWidth(char)
  }

  return width
}

export function lineWidth(spans: readonly Span[]): number {
  return spans.reduce((sum, span) => sum + textWidth(span.text), 0)
}

// 셀 너비 `width`에 정확히 맞춘다: 넘치면 `…`로 자르고 모자라면 공백으로 채운다.
export function fit(spans: readonly Span[], width: number): Span[] {
  if (width <= 0) {
    return []
  }
  const total = lineWidth(spans)
  if (total <= width) {
    return total === width ? [...spans] : [...spans, { text: ' '.repeat(width - total) }]
  }
  const out: Span[] = []
  let used = 0
  const budget = width - 1
  for (const span of spans) {
    let text = ''
    for (const char of span.text) {
      const w = charWidth(char)
      if (used + w > budget) {
        break
      }
      text += char
      used += w
    }
    if (text !== '') {
      out.push({ ...span, text })
    }
    if (used >= budget || text.length < span.text.length) {
      break
    }
  }
  out.push({ text: '…', dim: true })
  used += 1

  return used < width ? [...out, { text: ' '.repeat(width - used) }] : out
}

// 조각들을 구분자로 이어 `width`에 맞춘다. 넘치면 우선순위가 낮은 조각부터 버린다.
export function pack(chunks: readonly Chunk[], width: number, sep: Span = { text: '  ' }): Span[] {
  let kept = chunks.filter(chunk => chunk.spans.length > 0)
  const joined = () => kept.flatMap((chunk, i) => (i === 0 ? chunk.spans : [sep, ...chunk.spans]))
  while (kept.length > 1 && lineWidth(joined()) > width) {
    const worst = kept.reduce((a, b) => (b.prio >= a.prio ? b : a))
    kept = kept.filter(chunk => chunk !== worst)
  }

  return fit(joined(), width)
}
