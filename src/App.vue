<template>
  <div>
    <!-- 登录为可选项：仅当访问路径以 /login 结尾时渲染登录页，其余（含 /）仍走当前首页 -->
    <LoginView v-if="isLoginRoute" />

    <template v-else>
      <template v-if="loaded">
      <Workspace
        :key="`${workspaceKey(loaded.source, loaded.spec)}:${loaded.revision || 0}`"
        :spec="loaded.spec"
        :source="loaded.source"
        :storage="storage"
        :theme="theme"
        @update:theme="theme = $event"
        :notify="notify"
        @import="importing = true"
      />
    </template>
    <template v-else>
      <main class="startup">
        <PanelsTopLeft :size="36" />
        <h1>{{ $t('app.title') }}</h1>
        <template v-if="error">
          <p role="alert">{{ error }}</p>
          <button class="primary" @click="importing = true">
            <Upload :size="16" />
            {{ $t('app.importCollection') }}
          </button>
          <button @click="retryImport">{{ $t('app.retrySource') }}</button>
        </template>
        <template v-else>
          <p role="status">{{ $t('app.loadingCollection') }}</p>
        </template>
      </main>
    </template>

    <ImportSpec
      v-if="importing"
      @close="importing = false"
      :notify="notify"
      @import="handleImport"
    />

    <div
      v-if="toast"
      :class="['toast', { 'toast-error': toast.failure }]"
      :role="toast.failure ? 'alert' : 'status'"
      @mouseenter="pauseToast"
      @mouseleave="resumeToast"
      @focusin="pauseToast"
      @focusout="resumeToast"
    >
      {{ toast.message }}
      <IconButton :label="$t('app.dismissNotification')" @click="toast = null">
        <X :size="16" />
      </IconButton>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PanelsTopLeft, Upload, X } from 'lucide-vue-next'
import Workspace from './components/Workspace.vue'
import ImportSpec from './components/ImportSpec.vue'
import LoginView from './components/LoginView.vue'
import IconButton from './components/ui/IconButton.vue'
import { parseSpec } from './lib/api'
import { workspaceKey } from './lib/workspace'
import { browserStorage, initialTheme, readJson } from './lib/platform'
import type { OpenApiDocument, StorageLike } from './types'

interface LoadedSpec {
  spec: OpenApiDocument
  source: string
  revision?: number
}

interface Toast {
  message: string
  failure: boolean
}

const props = withDefaults(
  defineProps<{
    initialSpec?: OpenApiDocument
    initialSource?: string
    specName?: string
    storage?: StorageLike
  }>(),
  {
    initialSource: 'swagger.json',
    specName: '',
    storage: () => browserStorage(),
  }
)

const { t } = useI18n()

const loaded = ref<LoadedSpec | null>(
  props.initialSpec ? { spec: props.initialSpec, source: props.initialSource } : null
)
const error = ref('')
const importing = ref(false)
const theme = ref(initialTheme(props.storage))
// 首屏立即落盘主题，否则会闪成 :root 的浅色默认值（之前 initialTheme 的默认值从未真正生效）
document.body.dataset.theme = theme.value
const toast = ref<Toast | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined

// 登录页路由：路径以 /login 结尾（如 /login、/docs/login）即渲染登录页，其余走当前首页
const isLoginRoute = ref(
  location.pathname.replace(/\/+$/, '').toLowerCase().endsWith('/login')
)

const importKey = `apirak:last-import:${location.pathname}`

function notify(message: string, failure = false) {
  toast.value = { message, failure }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 8000)
}

// 鼠标悬停或焦点在提示框内时暂停自动消失，避免用户正在阅读/选中文字时提示被清掉
function pauseToast() {
  clearTimeout(toastTimer)
}

// 离开提示框后重新开始较短的倒计时
function resumeToast() {
  if (!toast.value) return
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 4000)
}

function retryImport() {
  props.storage.removeItem(importKey)
  location.reload()
}

function handleImport(spec: OpenApiDocument, source: string, text: string) {
  try {
    props.storage.setItem(importKey, JSON.stringify({ source, text }))
  } catch {
    notify(t('notify.importSaveFailed'), true)
  }
  if (props.specName && !spec.info?.title) spec.info = { ...spec.info, title: props.specName }
  loaded.value = {
    spec,
    source,
    revision: (loaded.value?.revision || 0) + 1,
  }
  error.value = ''
}

watch(theme, (newTheme) => {
  document.body.dataset.theme = newTheme
  try {
    props.storage.setItem('apirak:theme', newTheme)
  } catch {}
})

// 加载到 JSON 后（无论是 fetch 请求还是手动/缓存导入），把 spec 的大标题
// info.title 拼接到浏览器页面标题（标签页标题）上。title 为空时回落为 base。
function applyPageTitle(spec?: OpenApiDocument) {
  const base = 'Apirak'
  const title = spec?.info?.title
  document.title = title ? `${base} · ${title}` : base
}

watch(() => loaded.value?.spec, applyPageTitle, { immediate: true })

onMounted(async () => {
  if (isLoginRoute.value) return
  if (props.initialSpec) return

  const abort = new AbortController()
  try {
    const imported = !window.openapiHost && readJson(props.storage, importKey, null) as any
    if (imported?.text) {
      const spec = parseSpec(imported.text)
      if (props.specName && !spec.info?.title) spec.info = { ...spec.info, title: props.specName }
      loaded.value = {
        spec,
        source: imported.source,
      }
      return
    }
    const source = new URL(props.initialSource, location.href).href
    const response = await fetch(source, { signal: abort.signal })
    if (!response.ok) throw new Error(`Cannot load specification: HTTP ${response.status}`)
    const spec = parseSpec(await response.text())
    if (props.specName && !spec.info?.title) spec.info = { ...spec.info, title: props.specName }
    if (!abort.signal.aborted) loaded.value = { spec, source }
  } catch (failure) {
    if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
      error.value = failure instanceof Error ? failure.message : String(failure)
    }
  }
})

onUnmounted(() => {
  clearTimeout(toastTimer)
})
</script>
