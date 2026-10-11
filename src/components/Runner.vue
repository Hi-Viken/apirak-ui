<template>
  <section class="tool-view runner">
    <header class="section-heading">
      <h1>{{ $t('runner.title') }}</h1>
      <div class="actions">
        <IconButton :label="$t('runner.importCollection')" :disabled="running" @click="triggerImport">
          <Upload :size="17" />
        </IconButton>
        <IconButton :label="$t('runner.exportCollection')" :disabled="!collection" @click="exportCollection">
          <Download :size="17" />
        </IconButton>
      </div>
    </header>
    <input ref="importInput" hidden type="file" accept=".json" @change="onImportFile" />
    <div class="collection-controls">
      <label>
        {{ $t('runner.collection') }}
        <select :disabled="running" :value="collection?.id || ''" @change="selected = ($event.target as HTMLSelectElement).value">
          <option value="" disabled>{{ $t('runner.selectCollection') }}</option>
          <option v-for="item in collections" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
      </label>
      <label>
        {{ $t('runner.newCollection') }}
        <input v-model="name" />
      </label>
      <IconButton :label="$t('runner.createCollection')" :disabled="!name.trim() || running" @click="createCollection">
        <Plus :size="19" />
      </IconButton>
    </div>
    <template v-if="collection">
      <div class="runner-toolbar">
        <label>
          {{ $t('runner.delay') }}
          <input type="number" min="0" max="60000" step="100" :disabled="running" :value="collection.delay || 0" @input="updateDelay" />
        </label>
        <label class="check-label">
          <input type="checkbox" v-model="stopOnError" />
          {{ $t('runner.stopOnError') }}
        </label>
        <IconButton :label="$t('runner.deleteCollection')" :disabled="running" @click="deleteCollection">
          <Trash2 :size="17" />
        </IconButton>
        <IconButton :label="$t('runner.addInterface')" :disabled="running" @click="showAddModal = true">
          <Plus :size="19" />
        </IconButton>
        <IconButton :label="$t('runner.editCollectionSettings')" :disabled="running" @click="showSettings = true">
          <Settings :size="17" />
        </IconButton>
        <button v-if="running" class="primary" @click="controller?.abort()">
          <Square :size="15" />
          {{ $t('runner.stop') }}
        </button>
        <button v-else class="primary" :disabled="!collection.requests.some((item) => item.enabled !== false)" @click="run">
          <PlayIcon :size="16" />
          {{ $t('runner.run') }}
        </button>
      </div>
      <div class="runner-requests">
        <div v-for="(request, index) in collection.requests" :key="request.id" class="runner-row">
          <input
            type="checkbox"
            :aria-label="$t('runner.enableRequest', { n: index + 1 })"
            :disabled="running"
            :checked="request.enabled !== false"
            @change="toggleRequest(request.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="muted">{{ index + 1 }}</span>
          <button
            class="runner-request"
            :disabled="!getOperation(request.operationId) || running"
            @click="editRequest(request)"
          >
            <Method :method="getOperation(request.operationId)?.method || 'get'" />
            <span>{{ getOperation(request.operationId)?.summary || request.operationId }}</span>
          </button>
          <IconButton :label="$t('runner.moveUp', { n: index + 1 })" :disabled="running || index === 0" @click="move(index, -1)">
            <ArrowUp :size="15" />
          </IconButton>
          <IconButton :label="$t('runner.moveDown', { n: index + 1 })" :disabled="running || index === collection.requests.length - 1" @click="move(index, 1)">
            <ArrowDown :size="15" />
          </IconButton>
          <IconButton :label="$t('runner.removeRequest', { n: index + 1 })" :disabled="running" @click="removeRequest(request.id)">
            <Trash2 :size="15" />
          </IconButton>
        </div>
      </div>
      <p v-if="!collection.requests.length" class="empty">{{ $t('runner.noRequests') }}</p>
      <section v-if="results.length > 0">
        <h2>{{ $t('runner.results') }} <span class="count">{{ results.length }}</span></h2>
        <details v-for="(result, index) in results" :key="`${result.id}:${index}`">
          <summary>
            <ChevronRight class="expand-chevron" :size="14" />
            <strong :class="result.ok ? 'success' : 'error-text'">{{ result.status || $t('runner.error') }}</strong>
            <span>{{ result.name }}</span>
            <span>{{ result.duration }} ms</span>
          </summary>
          <div class="result-detail">
            <div v-if="result.url" class="result-url">
              <span class="result-url-label">{{ $t('runner.requestUrl') }}</span>
              <code>{{ result.method }} {{ result.url }}</code>
            </div>
            <details class="result-section">
              <summary>
                <ChevronRight class="expand-chevron" :size="13" />
                {{ $t('runner.requestHeaders') }}
              </summary>
              <pre v-if="result.requestHeaders && Object.keys(result.requestHeaders).length">{{ formatHeaders(result.requestHeaders) }}</pre>
              <p v-else class="none">{{ $t('runner.none') }}</p>
            </details>
            <details class="result-section" open>
              <summary>
                <ChevronRight class="expand-chevron" :size="13" />
                {{ $t('runner.requestBody') }}
              </summary>
              <pre v-if="result.requestBody">{{ result.requestBody }}</pre>
              <p v-else class="none">{{ $t('runner.none') }}</p>
            </details>
            <details class="result-section">
              <summary>
                <ChevronRight class="expand-chevron" :size="13" />
                {{ $t('runner.responseHeaders') }}
              </summary>
              <pre v-if="result.headers && Object.keys(result.headers).length">{{ formatHeaders(result.headers) }}</pre>
              <p v-else class="none">{{ $t('runner.none') }}</p>
            </details>
            <details class="result-section" open>
              <summary>
                <ChevronRight class="expand-chevron" :size="13" />
                {{ $t('runner.responseBody') }}
              </summary>
              <pre v-if="result.body">{{ result.body }}</pre>
              <p v-else class="none">{{ $t('runner.none') }}</p>
            </details>
          </div>
        </details>
        <button class="text-button" @click="exportResults">
          <Download :size="16" />
          {{ $t('runner.exportResults') }}
        </button>
      </section>
      <AddToRunnerModal
        v-if="showAddModal"
        mode="select-operations"
        :operations="operations"
        :existing-ids="collection.requests.map((item) => item.operationId)"
        :collection-name="collection.name"
        :spec="spec"
        @close="showAddModal = false"
        @add-operations="addOperations"
      />

      <RunnerRequestEditor
        v-if="editingRequest && getOperation(editingRequest.operationId)"
        :request="editingRequest"
        :operation="getOperation(editingRequest.operationId)!"
        :spec="spec"
        :variables="variables"
        :output-definitions="outputDefinitions"
        @change="(draft) => onEditDraft(editingRequest!.id, draft)"
        @close="editingRequest = null"
      />

      <CollectionSettingsModal
        v-if="showSettings && collection"
        :settings="collection.settings"
        :variables="variables"
        :output-definitions="outputDefinitions"
        :requests="requestOptions"
        @change="onCollectionSettings"
        @close="showSettings = false"
      />
    </template>
    <p v-else class="empty">{{ $t('runner.noCollections') }}</p>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ChevronRight, Download, Plus, Settings, Square, Trash2, Upload } from 'lucide-vue-next'
import IconButton from './ui/IconButton.vue'
import Method from './ui/Method.vue'
import PlayIcon from './ui/PlayIcon.vue'
import AddToRunnerModal from './ui/AddToRunnerModal.vue'
import RunnerRequestEditor from './ui/RunnerRequestEditor.vue'
import CollectionSettingsModal from './ui/CollectionSettingsModal.vue'
import { applyCollectionSettings, downloadBlob, makeDraft } from '@/lib/api'
import type { Draft, KeyValueRow, Notify, Operation, OpenApiDocument, RequestCollection, ResponseData, Variables } from '@/types'

const { t } = useI18n()

interface RunnerResult extends ResponseData {
  id: string
  name: string
}

const props = defineProps<{
  collections: RequestCollection[]
  operations: Operation[]
  spec: OpenApiDocument
  execute: (operation: Operation, draft: Draft, variables: Variables, signal: AbortSignal) => Promise<{ response: ResponseData; variables: Variables }>
  variables: Variables
  notify: Notify
}>()

const emit = defineEmits<{
  change: [collections: RequestCollection[]]
}>()

const selected = ref(props.collections[0]?.id || '')
const name = ref(t('runner.newCollection'))
const running = ref(false)
const results = ref<RunnerResult[]>([])
const stopOnError = ref(false)
const controller = ref<AbortController | null>(null)
const importInput = ref<HTMLInputElement>()
const showAddModal = ref(false)
const showSettings = ref(false)
const editingRequest = ref<{ id: string; operationId: string; draft: Draft; enabled?: boolean } | null>(null)

// 输出变量定义（来自所有集合请求），供编辑器内 {{@name}} 引用解析
const outputDefinitions = computed(() =>
  props.collections.flatMap((collection) => collection.requests.flatMap((request) => request.draft.outputs || []))
)

const collection = computed(() => props.collections.find((item) => item.id === selected.value) || props.collections[0])

// 传给集合配置弹窗的接口清单（id + 展示名），用于「指定接口」勾选
const requestOptions = computed(() =>
  (collection.value?.requests || []).map((request) => ({
    id: request.id,
    label: getOperation(request.operationId)?.summary || request.operationId,
  }))
)

onUnmounted(() => controller.value?.abort())

function getOperation(id: string): Operation | undefined {
  return props.operations.find((item) => item.id === id)
}

function update(patch: Partial<RequestCollection>) {
  if (!collection.value) return
  emit('change', props.collections.map((item) => item.id === collection.value!.id ? { ...item, ...patch } : item))
}

function move(index: number, offset: number) {
  const requests = [...collection.value!.requests]
  const target = index + offset
  if (target < 0 || target >= requests.length) return
  ;[requests[index], requests[target]] = [requests[target], requests[index]]
  update({ requests })
}

async function run() {
  const abort = new AbortController()
  controller.value = abort
  running.value = true
  results.value = []
  let currentVariables = props.variables
  try {
    for (const request of collection.value!.requests.filter((item) => item.enabled !== false)) {
      if (abort.signal.aborted) break
      const operation = getOperation(request.operationId)
      if (!operation) { props.notify(t('notify.operationRemoved'), true); continue }
      // 把集合的「多组共享配置」叠加合并进该请求（按组勾选的目标接口 + 组间同名后者覆盖 + 请求自身最优先），不改动已存储的 draft。
      const mergedDraft = applyCollectionSettings(request.id, collection.value!.settings, request.draft)
      const result = await props.execute(operation, mergedDraft, currentVariables, abort.signal)
      if (abort.signal.aborted) break
      currentVariables = result.variables
      results.value = [...results.value, { ...result.response, id: request.id, name: operation.summary || operation.path }]
      if (stopOnError.value && !result.response.ok) break
      if ((collection.value!.delay || 0) > 0) {
        await new Promise<void>((resolve) => {
          const finish = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', finish); resolve() }
          const timer = setTimeout(finish, Math.min(collection.value!.delay || 0, 60000))
          abort.signal.addEventListener('abort', finish, { once: true })
        })
      }
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError'))
      props.notify(error instanceof Error ? error.message : String(error), true)
  } finally {
    running.value = false
    controller.value = null
  }
}

function triggerImport() { importInput.value?.click() }

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  try {
    const file = input.files?.[0]
    if (!file) return
    let text: string
    try {
      text = await file.text()
    } catch {
      throw new Error(t('runner.import.readFailed'))
    }
    let imported: any
    try {
      imported = JSON.parse(text)
    } catch {
      throw new Error(t('runner.import.notJson'))
    }
    if (typeof imported !== 'object' || imported === null || Array.isArray(imported))
      throw new Error(t('runner.import.invalidFormat'))
    if (!imported.name || typeof imported.name !== 'string' || !imported.name.trim())
      throw new Error(t('runner.import.missingName'))
    if (!Array.isArray(imported.requests))
      throw new Error(t('runner.import.requestsNotArray'))
    const missingIndex = imported.requests.findIndex((item: any) => !item || !item.draft)
    if (missingIndex >= 0)
      throw new Error(t('runner.import.requestMissingDraft', { index: missingIndex + 1 }))
    const badCount = imported.requests.filter(
      (item: any) => !props.operations.some((op: any) => op.id === item?.operationId)
    ).length
    if (badCount > 0)
      throw new Error(t('runner.import.operationsNotInSpec', { count: badCount }))
    if (props.collections.some((item) => item.name.trim().toLowerCase() === imported.name.trim().toLowerCase()))
      throw new Error(t('runner.duplicateCollectionName', { name: imported.name.trim() }))
    const entry = { ...imported, id: crypto.randomUUID() }
    emit('change', [...props.collections, entry])
    selected.value = entry.id
  } catch (error) {
    props.notify(error instanceof Error ? error.message : String(error), true)
  } finally {
    input.value = ''
  }
}

function exportCollection() {
  if (!collection.value) return
  downloadBlob(new Blob([JSON.stringify(collection.value, null, 2)], { type: 'application/json' }), `${collection.value.name}.json`)
}

function createCollection() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  if (props.collections.some((item) => item.name.trim().toLowerCase() === trimmed.toLowerCase())) {
    props.notify(t('runner.duplicateCollectionName', { name: trimmed }), true)
    return
  }
  const entry = { id: crypto.randomUUID(), name: trimmed, requests: [], delay: 0 }
  emit('change', [...props.collections, entry])
  selected.value = entry.id
}

function deleteCollection() {
  emit('change', props.collections.filter((item) => item.id !== collection.value!.id))
}

function updateDelay(event: Event) {
  update({ delay: Math.max(0, Math.min(Number((event.target as HTMLInputElement).value), 60000)) })
}

function toggleRequest(id: string, enabled: boolean) {
  update({ requests: collection.value!.requests.map((item) => item.id === id ? { ...item, enabled } : item) })
}

function editRequest(request: any) {
  const operation = getOperation(request.operationId)
  if (!operation) {
    props.notify(t('notify.operationRemoved'), true)
    return
  }
  editingRequest.value = request
}

function onEditDraft(id: string, draft: Draft) {
  if (!collection.value) return
  const requests = collection.value.requests.map((request) =>
    request.id === id ? { ...request, draft: JSON.parse(JSON.stringify(draft)) } : request
  )
  update({ requests })
}

function onCollectionSettings(settings: { id: string; name: string; headers?: KeyValueRow[]; parameters?: KeyValueRow[]; targets?: string[] }[]) {
  update({ settings })
}

function removeRequest(id: string) {
  update({ requests: collection.value!.requests.filter((item) => item.id !== id) })
}

function addOperations(operationIds: string[]) {
  if (!collection.value) return
  const requests = [...collection.value.requests]
  for (const id of operationIds) {
    const operation = props.operations.find((item) => item.id === id)
    if (!operation) continue
    requests.push({
      id: crypto.randomUUID(),
      operationId: operation.id,
      draft: makeDraft(operation, props.spec),
      enabled: true,
    })
  }
  update({ requests })
  showAddModal.value = false
  props.notify(t('notify.addedToCollection', { name: collection.value.name }))
}

function exportResults() {
  downloadBlob(
    new Blob([JSON.stringify(results.value.map(({ blob, ...r }) => r), null, 2)], { type: 'application/json' }),
    'runner-results.json'
  )
}

function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
}
</script>
