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
          <pre>{{ result.body }}</pre>
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
    </template>
    <p v-else class="empty">{{ $t('runner.noCollections') }}</p>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ChevronRight, Download, Plus, Square, Trash2, Upload } from 'lucide-vue-next'
import IconButton from './ui/IconButton.vue'
import Method from './ui/Method.vue'
import PlayIcon from './ui/PlayIcon.vue'
import AddToRunnerModal from './ui/AddToRunnerModal.vue'
import RunnerRequestEditor from './ui/RunnerRequestEditor.vue'
import { downloadBlob, makeDraft } from '@/lib/api'
import type { Draft, Notify, Operation, OpenApiDocument, RequestCollection, ResponseData, Variables } from '@/types'

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
const editingRequest = ref<{ id: string; operationId: string; draft: Draft; enabled?: boolean } | null>(null)

// 输出变量定义（来自所有集合请求），供编辑器内 {{@name}} 引用解析
const outputDefinitions = computed(() =>
  props.collections.flatMap((collection) => collection.requests.flatMap((request) => request.draft.outputs || []))
)

const collection = computed(() => props.collections.find((item) => item.id === selected.value) || props.collections[0])

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
      const result = await props.execute(operation, request.draft, currentVariables, abort.signal)
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
  try {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    const imported = JSON.parse(await file.text())
    if (!imported.name || !Array.isArray(imported.requests) || imported.requests.some((item: any) => !item?.draft || !props.operations.some((op) => op.id === item.operationId)))
      throw new Error('Invalid collection or operations not present in this specification.')
    const entry = { ...imported, id: crypto.randomUUID() }
    emit('change', [...props.collections, entry])
    selected.value = entry.id
  } catch (error) {
    props.notify(error instanceof Error ? error.message : String(error), true)
  }
}

function exportCollection() {
  if (!collection.value) return
  downloadBlob(new Blob([JSON.stringify(collection.value, null, 2)], { type: 'application/json' }), `${collection.value.name}.json`)
}

function createCollection() {
  const entry = { id: crypto.randomUUID(), name: name.value.trim(), requests: [], delay: 0 }
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
</script>
