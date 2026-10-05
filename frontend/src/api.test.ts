import { describe, expect, it } from 'vitest'
import { readSse } from './api'

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(encoder.encode(c)))
      controller.close()
    },
  })
}

describe('readSse', () => {
  it('keeps a multi-byte character split across chunks intact', async () => {
    const bytes = new TextEncoder().encode('event: delta\ndata: {"text":"將軍"}\n\n')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 29)) // byte 28 starts 將 (3 bytes): cut inside it
        controller.enqueue(bytes.slice(29))
        controller.close()
      },
    })
    const events: unknown[] = []
    await readSse(stream, (_event, data) => events.push(data))
    expect(events).toEqual([{ text: '將軍' }])
  })

  it('parses events split across arbitrary chunk boundaries', async () => {
    const events: [string, unknown][] = []
    await readSse(
      body(['event: meta\ndata: {"a":', '1}\n\nevent: delta\ndata: {"text":"甲', '乙"}\n\n', 'event: done\ndata: {"ok":true}\n\n']),
      (event, data) => events.push([event, data]),
    )
    expect(events).toEqual([
      ['meta', { a: 1 }],
      ['delta', { text: '甲乙' }],
      ['done', { ok: true }],
    ])
  })
})
