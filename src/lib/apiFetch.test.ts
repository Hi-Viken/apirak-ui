import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOpenApiFromUrl, SpecFetchError } from './api'

// 纯 node 环境下没有 location，补一个最小实现，保证 new URL(input, location.href) 能跑
if (typeof (globalThis as any).location === 'undefined') {
  ;(globalThis as any).location = { href: 'http://localhost/', origin: 'http://localhost' }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchOpenApiFromUrl', () => {
  it('把非法 URL 归类成 invalidUrl', async () => {
    // 'http://' 缺 host，无论是否带 base 都是无效 URL
    await expect(fetchOpenApiFromUrl('http://')).rejects.toMatchObject({ code: 'invalidUrl' })
  })

  it('拒绝非 http/https 协议', async () => {
    const err = await fetchOpenApiFromUrl('ftp://example.com/spec.json').catch((e) => e)
    expect(err).toBeInstanceOf(SpecFetchError)
    expect((err as SpecFetchError).code).toBe('unsupportedProtocol')
  })

  it('把 HTTP 错误状态码归类成 http 并带上 status / statusText', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404, statusText: 'Not Found' }))
    )
    const err = await fetchOpenApiFromUrl('http://localhost/missing.json').catch((e) => e)
    expect((err as SpecFetchError).code).toBe('http')
    expect((err as SpecFetchError).status).toBe(404)
    expect((err as SpecFetchError).statusText).toBe('Not Found')
  })

  it('fetch 抛错（CORS / 网络不通）统一归类成 network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )
    const err = await fetchOpenApiFromUrl('http://other-host/spec.json').catch((e) => e)
    expect((err as SpecFetchError).code).toBe('network')
  })

  it('AbortController 超时归类成 timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, opts: { signal?: AbortSignal }) =>
          new Promise((_, reject) => {
            opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          })
      )
    )
    const err = await fetchOpenApiFromUrl('http://localhost/slow.json', { timeout: 1 }).catch((e) => e)
    expect((err as SpecFetchError).code).toBe('timeout')
  })

  it('成功时返回文本与绝对 URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"openapi":"3.0"}', { status: 200 }))
    )
    const result = await fetchOpenApiFromUrl('http://localhost/ok.json')
    expect(result.text).toBe('{"openapi":"3.0"}')
    expect(result.url).toBe('http://localhost/ok.json')
  })

  it('空响应体归类成 empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('   ', { status: 200 }))
    )
    const err = await fetchOpenApiFromUrl('http://localhost/empty.json').catch((e) => e)
    expect((err as SpecFetchError).code).toBe('empty')
  })
})
