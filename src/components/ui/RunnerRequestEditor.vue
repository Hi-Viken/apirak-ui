<template>
  <Modal :title="title" @close="$emit('close')">
    <div class="runner-editor">
      <div class="editor-head">
        <Method :method="operation.method" />
        <code class="editor-path">{{ operation.path }}</code>
        <span class="editor-summary">{{ operation.summary || operation.operationId }}</span>
      </div>

      <div class="subtabs" role="tablist" :aria-label="$t('request.requestDetails')">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          role="tab"
          :aria-selected="current === tab.key"
          @click="current = tab.key"
        >
          {{ tab.label }}
          <span v-if="tab.key === 'Parameters' && draft.parameters?.length" class="count">{{ draft.parameters.length }}</span>
        </button>
      </div>

      <div class="editor-details">
        <KeyValueEditor
          v-if="current === 'Parameters'"
          :rows="draft.parameters"
          :variables="variables"
          :output-definitions="outputDefinitions"
          @change="onRows('parameters', $event)"
          locations
          :add-label="$t('request.addParameter')"
        />
        <KeyValueEditor
          v-else-if="current === 'Headers'"
          :rows="draft.headers"
          :variables="variables"
          :output-definitions="outputDefinitions"
          @change="onRows('headers', $event)"
          :add-label="$t('request.addHeader')"
        />
        <template v-else-if="current === 'Body'">
          <div class="body-toolbar">
            <label>
              {{ $t('request.contentType') }}
              <select :value="draft.contentType || ''" @change="onContentTypeChange">
                <option value="">{{ $t('request.none') }}</option>
                <option v-for="type in allContentTypes" :key="type">{{ type }}</option>
              </select>
            </label>
            <button type="button" class="text-button" @click="resetBody">{{ $t('request.resetExample') }}</button>
          </div>
          <KeyValueEditor
            v-if="isForm"
            :rows="draft.form"
            :variables="variables"
            :output-definitions="outputDefinitions"
            @change="onRows('form', $event)"
            :add-label="$t('request.addField')"
          />
          <CodeEditor
            v-else
            :label="$t('request.requestBody')"
            :variables="variables"
            :output-definitions="outputDefinitions"
            :value="draft.body"
            @change="onBody"
            :language="bodyLanguage"
          />
        </template>
        <KeyValueEditor
          v-else-if="current === 'Output variables'"
          :rows="draft.outputs"
          :output-definitions="outputDefinitions"
          @change="onRows('outputs', $event)"
          outputs
          :value-label="$t('request.jsonpath')"
          :add-label="$t('request.addOutputVariable')"
        />
      </div>

      <div class="editor-actions">
        <button type="button" class="primary" @click="$emit('close')">{{ $t('runner.done') }}</button>
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from './Modal.vue'
import Method from './Method.vue'
import KeyValueEditor from './KeyValueEditor.vue'
import CodeEditor from './CodeEditor.vue'
import { bodyExample, resolveRef } from '@/lib/api'
import type { Draft, KeyValueRow, OpenApiDocument, Operation, Variables } from '@/types'

const props = defineProps<{
  request: { id: string; operationId: string; draft: Draft; enabled?: boolean }
  operation: Operation
  spec: OpenApiDocument
  variables?: Variables
  outputDefinitions?: KeyValueRow[]
}>()

const emit = defineEmits<{
  change: [draft: Draft]
  close: []
}>()

const { t } = useI18n()

const title = computed(() => t('runner.editRequest', { name: props.operation.summary || props.operation.path }))

// 本地副本：编辑只动这份，避免直接改 props（响应式 draft 存进集合会带 Proxy，落盘前需脱敏）。
// draft 里只有 JSON 安全类型（参数/请求头/Body/form/输出变量），JSON 往返即可得到纯对象。
const draft = ref<Draft>(JSON.parse(JSON.stringify(props.request.draft || {})))

const current = ref('Parameters')

const tabs = computed(() => [
  { key: 'Parameters', label: t('request.parameters') },
  { key: 'Headers', label: t('request.headers') },
  { key: 'Body', label: t('request.body') },
  { key: 'Output variables', label: t('request.outputVariables') },
])

const contentTypes = computed(() => Object.keys(props.operation.requestBody?.content || {}))
const allContentTypes = computed(() => [
  ...new Set([
    ...contentTypes.value,
    'application/json',
    'text/plain',
    'application/xml',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
  ]),
])

const isForm = computed(() =>
  ['multipart/form-data', 'application/x-www-form-urlencoded'].includes(draft.value.contentType)
)

const bodyLanguage = computed(() => {
  if (draft.value.contentType?.includes('json')) return 'json'
  if (draft.value.contentType?.includes('xml')) return 'xml'
  return 'plaintext'
})

function patch(p: Partial<Draft>) {
  draft.value = { ...draft.value, ...p }
  emitChange()
}

function emitChange() {
  emit('change', JSON.parse(JSON.stringify(draft.value)))
}

function onRows(key: 'parameters' | 'headers' | 'form' | 'outputs', rows: KeyValueRow[]) {
  patch({ [key]: rows } as Partial<Draft>)
}

function onBody(value: string) {
  patch({ body: value })
}

function onContentTypeChange(event: Event) {
  const contentType = (event.target as HTMLSelectElement).value
  const schema = resolveRef(props.operation.requestBody?.content?.[contentType]?.schema, props.spec)
  patch({
    contentType,
    body: bodyExample(props.operation, props.spec, contentType),
    form: Object.entries(schema.properties || {}).map(([name, value]: [string, any]) => ({
      name,
      value: value.default ?? '',
      enabled: true,
      file: value.format === 'binary' || value.type === 'file',
    })),
  })
}

function resetBody() {
  patch({ body: bodyExample(props.operation, props.spec, draft.value.contentType) })
}
</script>

<style scoped>
.runner-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.editor-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.editor-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--muted);
}
.editor-summary {
  font-size: 13px;
  color: var(--text);
}
.subtabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}
.subtabs button {
  padding: 8px 12px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 13px;
}
.subtabs button[aria-selected='true'] {
  color: var(--text);
  border-bottom-color: var(--accent);
}
.subtabs .count {
  font-size: 11px;
  color: var(--muted);
  background: var(--surface-hover);
  border-radius: 10px;
  padding: 0 6px;
  margin-left: 4px;
}
.editor-details {
  max-height: 60vh;
  overflow: auto;
  padding-right: 4px;
}
.body-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.body-toolbar label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.body-toolbar select {
  padding: 6px 8px;
}
.editor-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
