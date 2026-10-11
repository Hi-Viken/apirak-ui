<template>
  <Modal :title="t('runner.settingsGroups')" @close="$emit('close')">
    <p class="modal-intro">{{ t('runner.settingsGroupsHint') }}</p>

    <p v-if="!groups.length" class="empty-hint">{{ t('runner.noGroups') }}</p>

    <div v-for="group in groups" :key="group.id" class="group-card">
      <div class="group-head">
        <input
          class="group-name"
          :value="group.name"
          :placeholder="t('runner.groupName')"
          @input="renameGroup(group.id, ($event.target as HTMLInputElement).value)"
        />
        <IconButton :label="t('runner.removeGroup')" @click="removeGroup(group.id)">
          <Trash2 :size="15" />
        </IconButton>
      </div>

      <section class="targets-section">
        <div class="targets-head">
          <h4>{{ $t('runner.selectTargets') }}</h4>
          <div class="targets-actions">
            <button type="button" class="link" @click="selectAll(group.id)">{{ $t('runner.selectAll') }}</button>
            <button type="button" class="link" @click="selectNone(group.id)">{{ $t('runner.selectNone') }}</button>
            <button type="button" class="link" @click="invert(group.id)">{{ $t('runner.invertSelection') }}</button>
          </div>
        </div>
        <p class="selected-count">{{ $t('runner.selectedCount', { count: group.targets?.length || 0 }) }}</p>
        <ul class="targets-list">
          <li v-for="item in requests" :key="item.id">
            <label>
              <input type="checkbox" :checked="(group.targets || []).includes(item.id)" @change="toggleTarget(group.id, item.id)" />
              <span>{{ item.label }}</span>
            </label>
          </li>
        </ul>
      </section>

      <section>
        <h4>{{ $t('request.headers') }}</h4>
        <KeyValueEditor
          :rows="group.headers || []"
          :variables="variables"
          :output-definitions="outputDefinitions"
          :add-label="$t('request.addHeader')"
          @change="(rows) => setHeaders(group.id, rows)"
        />
      </section>
      <section>
        <h4>{{ $t('request.parameters') }}</h4>
        <KeyValueEditor
          :rows="group.parameters || []"
          :variables="variables"
          :output-definitions="outputDefinitions"
          locations
          :add-label="$t('request.addParameter')"
          @change="(rows) => setParameters(group.id, rows)"
        />
      </section>
    </div>

    <div class="group-actions">
      <button type="button" class="primary" @click="addGroup">+ {{ $t('runner.addGroup') }}</button>
    </div>

    <div class="modal-actions">
      <button type="button" class="primary" @click="$emit('close')">{{ $t('runner.done') }}</button>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trash2 } from 'lucide-vue-next'
import Modal from './Modal.vue'
import KeyValueEditor from './KeyValueEditor.vue'
import IconButton from './IconButton.vue'
import type { KeyValueRow, Variables } from '@/types'

interface GroupModel {
  id: string
  name: string
  headers?: KeyValueRow[]
  parameters?: KeyValueRow[]
  targets?: string[]
}

const props = defineProps<{
  settings?: GroupModel[]
  variables?: Variables
  outputDefinitions?: KeyValueRow[]
  requests?: { id: string; label: string }[]
}>()

const emit = defineEmits<{
  change: [settings: GroupModel[]]
  close: []
}>()

const { t } = useI18n()

// 本地副本：编辑只动这份，持续 emit 干净（JSON 安全）的对象，由父级落盘。
const groups = ref<GroupModel[]>(JSON.parse(JSON.stringify(props.settings || [])))

function emitChange() {
  emit('change', JSON.parse(JSON.stringify(groups.value)))
}

function addGroup() {
  groups.value = [
    ...groups.value,
    { id: crypto.randomUUID(), name: '', headers: [], parameters: [], targets: [] },
  ]
  emitChange()
}

function removeGroup(id: string) {
  groups.value = groups.value.filter((g) => g.id !== id)
  emitChange()
}

function renameGroup(id: string, name: string) {
  groups.value = groups.value.map((g) => (g.id === id ? { ...g, name } : g))
  emitChange()
}

function setHeaders(id: string, rows: KeyValueRow[]) {
  groups.value = groups.value.map((g) => (g.id === id ? { ...g, headers: rows } : g))
  emitChange()
}

function setParameters(id: string, rows: KeyValueRow[]) {
  groups.value = groups.value.map((g) => (g.id === id ? { ...g, parameters: rows } : g))
  emitChange()
}

function toggleTarget(groupId: string, requestId: string) {
  groups.value = groups.value.map((g) => {
    if (g.id !== groupId) return g
    const targets = g.targets || []
    return {
      ...g,
      targets: targets.includes(requestId)
        ? targets.filter((x) => x !== requestId)
        : [...targets, requestId],
    }
  })
  emitChange()
}

function selectAll(groupId: string) {
  const ids = (props.requests || []).map((r) => r.id)
  groups.value = groups.value.map((g) => (g.id === groupId ? { ...g, targets: ids } : g))
  emitChange()
}

function selectNone(groupId: string) {
  groups.value = groups.value.map((g) => (g.id === groupId ? { ...g, targets: [] } : g))
  emitChange()
}

function invert(groupId: string) {
  const all = (props.requests || []).map((r) => r.id)
  groups.value = groups.value.map((g) => {
    if (g.id !== groupId) return g
    const targets = g.targets || []
    return { ...g, targets: all.filter((id) => !targets.includes(id)) }
  })
  emitChange()
}
</script>

<style scoped>
.modal-intro {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
.empty-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--muted);
}
.group-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.group-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
  color: var(--text);
}
.targets-section {
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 10px;
}
.targets-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.targets-head h4,
.group-card > section h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.targets-actions {
  display: flex;
  gap: 10px;
}
.link {
  border: 0;
  background: transparent;
  color: var(--accent, #3b82f6);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.selected-count {
  margin: 6px 0 8px;
  font-size: 12px;
  color: var(--muted);
}
.targets-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 22vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.targets-list li label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
  padding: 3px 4px;
  border-radius: 4px;
}
.targets-list li label:hover {
  background: var(--surface-alt);
}
.group-actions {
  margin-bottom: 8px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
