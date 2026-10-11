// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import i18n from '@/i18n'
import Workspace from './Workspace.vue'
import Runner from './Runner.vue'

/**
 * 回归测试：集合（Runner）里的请求改为「独立弹窗编辑」后，编辑结果必须**即时**回写集合并落盘，
 * 不存在「还要再点一次保存才生效」的中间态。
 *
 * 旧逻辑（已废弃）：集合请求的 draft 借道标签页编辑，只有点「保存到集合」才回写；
 * 编辑后不点保存就切换/刷新/运行，改动会丢，重新从 Runner 打开还会被集合里那份旧 draft 覆盖
 * （表现为「集合中配置的参数/请求头/请求体没有保存」）。
 */

// jsdom 不实现 <dialog>.showModal()，而集合请求的编辑弹窗基于原生 dialog；
// 不补这个方法，弹窗一挂载就抛 "showModal is not a function"。
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open')
  }
}

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

const spec: any = {
  openapi: '3.0.3',
  info: { title: 'Demo', version: '1.0.0' },
  paths: {
    '/thing': {
      post: {
        operationId: 'createThing',
        summary: 'Create Thing',
        parameters: [{ name: 'id', in: 'query', schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'ok' } },
      },
    },
  },
}

const operations: any[] = [
  {
    id: 'createThing',
    method: 'post',
    path: '/thing',
    summary: 'Create Thing',
    parameters: [{ name: 'id', in: 'query', schema: { type: 'string' } }],
    security: [],
  },
]

function makeDraft(overrides: Record<string, any> = {}) {
  return {
    path: '/thing',
    parameters: [{ name: 'id', location: 'query', value: '1', enabled: true }],
    headers: [{ name: 'X-Test', value: '', enabled: true }],
    body: '{}',
    contentType: 'application/json',
    form: [],
    outputs: [],
    authEnabled: true,
    ...overrides,
  }
}

const editedDraft = makeDraft({
  body: '{"name":"forged"}',
  headers: [{ name: 'X-Test', value: 'secret', enabled: true }],
  parameters: [{ name: 'id', location: 'query', value: '999', enabled: true }],
})

describe('集合请求编辑的即时持久化', () => {
  let mounted: ReturnType<typeof mount> | null = null
  afterEach(() => mounted?.unmount())

  it('运行器内编辑集合请求后即时回写集合（无额外保存动作）', async () => {
    const collections: any[] = [
      {
        id: 'col-1',
        name: 'My Collection',
        requests: [{ id: 'req-1', operationId: 'createThing', draft: makeDraft(), enabled: true }],
        delay: 0,
      },
    ]
    const wrapper = mount(Runner, {
      props: {
        collections,
        operations,
        spec,
        execute: async () => ({ response: { ok: true, status: 200 }, variables: [] }),
        variables: [],
        notify: () => {},
      },
      global: { plugins: [i18n] },
    })
    mounted = wrapper
    const vm = wrapper.vm as any

    // 点集合里的请求 -> 打开独立编辑弹窗（不再借道标签页）
    vm.editRequest(collections[0].requests[0])
    await nextTick()
    expect(vm.editingRequest?.id).toBe('req-1')

    // 弹窗里同时改 请求体 / 请求头 / 参数 -> 直接回写集合
    vm.onEditDraft('req-1', editedDraft)
    await nextTick()

    const emitted = wrapper.emitted('change')
    expect(emitted).toBeTruthy()
    const next = (emitted!.at(-1) as any)[0] as any[]
    expect(next[0].requests[0].draft.body).toBe('{"name":"forged"}')
    expect(next[0].requests[0].draft.headers[0].value).toBe('secret')
    expect(next[0].requests[0].draft.parameters[0].value).toBe('999')
  })

  it('集合变更经 Workspace 落盘，重新打开仍是编辑后的值', async () => {
    const storage = memoryStorage()
    const wrapper = mount(Workspace, {
      props: { spec, source: 'test', storage, theme: 'system', notify: () => {} },
      global: { plugins: [i18n] },
    })
    mounted = wrapper
    const vm = wrapper.vm as any

    vm.state.collections = [
      {
        id: 'col-2',
        name: 'C2',
        requests: [{ id: 'req-2', operationId: 'createThing', draft: makeDraft(), enabled: true }],
        delay: 0,
      },
    ]
    await nextTick()

    // 运行器把编辑结果抛上来 -> 走 dispatch，同步落盘
    vm.onCollectionsChange([
      {
        id: 'col-2',
        name: 'C2',
        requests: [{ id: 'req-2', operationId: 'createThing', draft: editedDraft, enabled: true }],
        delay: 0,
      },
    ])
    await nextTick()

    const persisted = JSON.parse(storage.getItem(vm.key)!)
    const req = persisted.collections[0].requests.find((item: any) => item.id === 'req-2')
    expect(req.draft.body).toBe('{"name":"forged"}')
    expect(req.draft.headers[0].value).toBe('secret')
    expect(req.draft.parameters[0].value).toBe('999')
  })
})
