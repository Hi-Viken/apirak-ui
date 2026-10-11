<template>
  <Modal :title="$t('import.title')" @close="$emit('close')">
    <div class="subtabs" role="tablist" :aria-label="$t('import.source')">
      <button
        v-for="item in importTabs"
        :key="item.key"
        role="tab"
        :aria-selected="tab === item.key"
        @click="tab = item.key; value = ''"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="import-content">
      <label v-if="tab === 'URL'">
        {{ $t('import.specUrl') }}
        <input
          type="url"
          v-model="value"
          :placeholder="$t('import.urlPlaceholder')"
        />
      </label>
      <label v-else-if="tab === 'File'" class="file-import">
        <Upload :size="26" />
        <span>{{ $t('import.fileFormat') }}</span>
        <input
          :aria-label="$t('import.specFile')"
          type="file"
          accept=".json,.yaml,.yml"
          @change="onFileSelect"
        />
      </label>
      <CodeEditor
        v-else-if="tab === 'Paste'"
        :label="$t('import.specContent')"
        :value="value"
        @change="value = $event"
      />
      <div v-else-if="tab === 'Examples'" class="example-list">
        <button
          v-for="[url, name] in examples"
          :key="url"
          :disabled="busy"
          @click="importValue(url)"
        >
          <FileCode2 :size="20" />
          {{ name }}
        </button>
      </div>
      <button
        v-if="['URL', 'Paste'].includes(tab)"
        class="primary"
        :disabled="busy || !value.trim()"
        @click="importValue(tab === 'URL' ? value.trim() : 'pasted-spec', tab === 'Paste' ? value : undefined)"
      >
        <Upload :size="16" />
        {{ busy ? $t('import.importing') : $t('import.import') }}
      </button>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Upload, FileCode2 } from 'lucide-vue-next'
import Modal from './ui/Modal.vue'
import CodeEditor from './ui/CodeEditor.vue'
import { parseSpec, fetchOpenApiFromUrl, SpecFetchError } from '@/lib/api'
import type { Notify, OpenApiDocument } from '@/types'

const { t } = useI18n()

const props = defineProps<{ notify: Notify }>()

/** 应用是否配置了同源代理（.env 的 VITE_API_BASE_URL）。配了才能在 CORS 失败时改走 /api-proxy。 */
const PROXY_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined
/** 本次导入是否已经实际尝试过走 /api-proxy 重试（用于决定提示措辞）。 */
const proxyAttempted = ref(false)
const emit = defineEmits<{
  close: []
  import: [spec: OpenApiDocument, source: string, text: string]
}>()

const importTabs = computed(() => [
  { key: 'URL', label: t('import.url') },
  { key: 'File', label: t('import.file') },
  { key: 'Paste', label: t('import.paste') },
  { key: 'Examples', label: t('import.examples') },
])

const tab = ref('URL')
const value = ref('')
const busy = ref(false)

const examples = computed(() => [
  ['swagger.json', t('import.sampleApi')],
  ['sample-specs/interactive-api.json', t('import.interactiveApi')],
  ['sample-specs/test-security-swagger.json', t('import.authSchemes')],
])

async function importValue(source: string, text?: string) {
  busy.value = true
  try {
    let specText = text
    let resolvedSource = source
    if (specText === undefined) {
      const result = await fetchSpecWithProxyFallback(source)
      specText = result.text
      resolvedSource = result.url
    }
    emit('import', parseSpec(specText), resolvedSource, specText)
    emit('close')
  } catch (error) {
    props.notify(buildImportErrorMessage(error), true)
  } finally {
    busy.value = false
  }
}

/**
 * 直连 fetch 失败（通常是跨域 CORS）且配置了同源代理时，自动改走 /api-proxy 再试一次。
 * 这样用户导入「自己本地后端」的 spec 时，哪怕后端没开 CORS 也能直接成功，
 * 而不是只弹一句 "Failed to fetch"。
 */
async function fetchSpecWithProxyFallback(input: string): Promise<{ text: string; url: string }> {
  try {
    return await fetchOpenApiFromUrl(input)
  } catch (error) {
    if (error instanceof SpecFetchError && error.code === 'network' && PROXY_BASE) {
      const via = proxiedPath(input)
      if (via) {
        proxyAttempted.value = true
        try {
          return await fetchOpenApiFromUrl(via)
        } catch {
          // 代理也失败：回退到原始的 network 报错，其提示里已说明代理方案
        }
      }
    }
    throw error
  }
}

/** 若导入地址与目标代理后端同源，返回走 /api-proxy 的同源路径；否则返回 null。 */
function proxiedPath(input: string): string | null {
  try {
    const target = new URL(PROXY_BASE as string)
    const url = new URL(input, location.href)
    if (url.origin === target.origin) return `/api-proxy${url.pathname}${url.search}${url.hash}`
  } catch {
    // 解析失败就不过代理，交给上层按 network 报错处理
  }
  return null
}

/** 把结构化错误翻译成针对该失败类型的人话提示。 */
function buildImportErrorMessage(error: unknown): string {
  if (!(error instanceof SpecFetchError)) {
    return error instanceof Error ? error.message : String(error)
  }
  const e = error
  const seconds = 20
  switch (e.code) {
    case 'invalidUrl':
      return t('import.errors.invalidUrl', { input: e.detail || '' })
    case 'unsupportedProtocol':
      return t('import.errors.unsupportedProtocol')
    case 'timeout':
      return t('import.errors.timeout', { seconds })
    case 'http': {
      const status = e.status ?? 0
      let hint = t('import.errors.httpHintGeneric')
      if (status === 404 || status === 410) hint = t('import.errors.httpHint404')
      else if (status === 401 || status === 403 || status === 407)
        hint = t('import.errors.httpHintAuth', { status })
      else if (status === 405) hint = t('import.errors.httpHintMethod', { status, statusText: e.statusText || '' })
      else if (status >= 500 && status < 600)
        hint = t('import.errors.httpHintServer', { status })
      return `${t('import.errors.http', { status, statusText: e.statusText || '' })} ${hint}`
    }
    case 'network': {
      const crossOrigin = e.url ? isCrossOrigin(e.url) : true
      // 浏览器不会透露真实原因，所以只中性的把「可能的原因」逐条列出（每条换行），不下"极可能 CORS"这类断言。
      const lines = [t('import.errors.network')]
      if (crossOrigin) lines.push(`· ${t('import.errors.networkCauseCors')}`)
      lines.push(`· ${t('import.errors.networkCauseOther')}`)
      let message = lines.join('\n')
      // CORS 的修复办法仅在「跨域」时才相关，且措辞是"若确认是 CORS"，不替用户下结论。
      if (crossOrigin) message += `\n${t('import.errors.networkFix')}`
      if (PROXY_BASE)
        message += `\n${
          proxyAttempted.value
            ? t('import.errors.networkHintProxyTried')
            : t('import.errors.networkHintProxy')
        }`
      return message
    }
    case 'empty':
      return t('import.errors.empty')
    default:
      return e.message
  }
}

function isCrossOrigin(url: string): boolean {
  try {
    return new URL(url).origin !== location.origin
  } catch {
    return true
  }
}

async function onFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) await importValue(`file:${file.name}`, await file.text())
}
</script>
