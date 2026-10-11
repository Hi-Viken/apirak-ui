<template>
  <section class="tool-view">
    <header class="section-heading">
      <h1>{{ $t('history.title') }}</h1>
      <IconButton :label="$t('history.clear')" @click="$emit('clear')">
        <Trash2 :size="17" />
      </IconButton>
    </header>
    <p v-if="!history.length" class="empty">{{ $t('history.empty') }}</p>
    <div v-for="entry in history" :key="entry.id" class="history-item">
      <div class="history-head" @click="toggle(entry.id)">
        <ChevronRight class="expand-chevron" :size="14" :class="{ open: expanded.has(entry.id) }" />
        <Method :method="entry.method" />
        <div class="history-meta">
          <code>{{ entry.path }}</code>
          <span>{{ new Date(entry.at).toLocaleString() }}</span>
        </div>
        <span :class="entry.status >= 200 && entry.status < 400 ? 'success' : 'error-text'">
          {{ entry.status || $t('history.error') }}
        </span>
        <span class="muted">{{ entry.duration }} ms</span>
        <IconButton
          class="open-btn"
          :label="$t('history.openRequest')"
          @click.stop="$emit('open', entry.operationId)"
        >
          <ExternalLink :size="15" />
        </IconButton>
        <IconButton
          class="delete-btn"
          :label="$t('history.remove')"
          @click.stop="$emit('remove', entry.id)"
        >
          <Trash2 :size="15" />
        </IconButton>
      </div>
      <div v-if="expanded.has(entry.id)" class="result-detail">
        <div v-if="entry.url" class="result-url">
          <span class="result-url-label">{{ $t('history.url') }}</span>
          <code>{{ entry.method }} {{ entry.url }}</code>
        </div>
        <details class="result-section">
          <summary>
            <ChevronRight class="expand-chevron" :size="13" />
            {{ $t('history.requestHeaders') }}
          </summary>
          <pre v-if="entry.requestHeaders && Object.keys(entry.requestHeaders).length">{{ formatHeaders(entry.requestHeaders) }}</pre>
          <p v-else class="none">{{ $t('history.none') }}</p>
        </details>
        <details class="result-section" open>
          <summary>
            <ChevronRight class="expand-chevron" :size="13" />
            {{ $t('history.requestBody') }}
          </summary>
          <pre v-if="entry.requestBody">{{ entry.requestBody }}</pre>
          <p v-else class="none">{{ $t('history.none') }}</p>
        </details>
        <details class="result-section">
          <summary>
            <ChevronRight class="expand-chevron" :size="13" />
            {{ $t('history.responseHeaders') }}
          </summary>
          <pre v-if="entry.responseHeaders && Object.keys(entry.responseHeaders).length">{{ formatHeaders(entry.responseHeaders) }}</pre>
          <p v-else class="none">{{ $t('history.none') }}</p>
        </details>
        <details class="result-section" open>
          <summary>
            <ChevronRight class="expand-chevron" :size="13" />
            {{ $t('history.responseBody') }}
          </summary>
          <pre v-if="entry.responseBody">{{ entry.responseBody }}</pre>
          <p v-else class="none">{{ $t('history.none') }}</p>
        </details>
        <p v-if="entry.bodyTruncated" class="history-truncated">{{ $t('history.bodyTruncated') }}</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import IconButton from '../ui/IconButton.vue'
import Method from '../ui/Method.vue'
import { ChevronRight, ExternalLink, Trash2 } from 'lucide-vue-next'

defineProps<{ history: any[] }>()
defineEmits<{ open: [id: string]; clear: []; remove: [id: string] }>()

const expanded = ref<Set<string>>(new Set())
function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
}
</script>
