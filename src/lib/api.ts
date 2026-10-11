import { load } from 'js-yaml'
import { JSONPath } from 'jsonpath-plus'
import type { AuthStatus, Draft, KeyValueRow } from '@/types'

export const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']

export function resolveRef(value: any, spec: any, visited = new Set<string>()): any {
  if (!value?.$ref) return value || {}
  if (!value.$ref.startsWith('#/')) throw new Error(`External reference is not supported: ${value.$ref}`)
  if (visited.has(value.$ref)) return {}
  visited.add(value.$ref)
  const target = value.$ref
    .slice(2)
    .split('/')
    .reduce(
      (current: any, key: string) =>
        current?.[decodeURIComponent(key).replace(/~1/g, '/').replace(/~0/g, '~')],
      spec
    )
  if (!target) throw new Error(`Reference not found: ${value.$ref}`)
  return {
    ...resolveRef(target, spec, visited),
    ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$ref')),
  }
}

export function parseSpec(text: string): any {
  const trimmed = text.trim()
  if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
    throw new Error(
      'Received an HTML response instead of an OpenAPI specification. ' +
      'Check that VITE_API_BASE_URL and VITE_SPEC_PATH in your .env file are correct.'
    )
  }
  let spec: any
  try {
    spec = load(text)
  } catch (e: any) {
    throw new Error(`Failed to parse specification: ${e.message}. Ensure VITE_SPEC_PATH points to a valid OpenAPI JSON/YAML endpoint.`)
  }
  if (
    !spec ||
    typeof spec !== 'object' ||
    (!spec.openapi && spec.swagger !== '2.0') ||
    !spec.paths ||
    typeof spec.paths !== 'object'
  ) {
    throw new Error('A valid OpenAPI 3.x or Swagger 2.0 document with paths is required.')
  }
  return spec
}

/**
 * 从远端 URL 取回 OpenAPI 规范文本时，把所有「取不到」的情况统一成带 code 的
 * SpecFetchError，让 UI 能给出针对性提示（CORS / 404 / 超时 / 网络不通 …），
 * 而不是只把浏览器那句含糊的 "Failed to fetch" 原样弹出来。
 *
 * 为什么需要它：浏览器出于安全，跨域被拦截（CORS）和 DNS/离线/服务未启动（网络不通）
 * 抛出的是同一个 TypeError("Failed to fetch")，fetch 拿不到状态码也拿不到响应头。
 * 所以 `network` 这一类只能靠「同源判断 + 提示各种可能性」来帮用户定位，
 * 真正的 CORS 修复要靠服务端加 `Access-Control-Allow-Origin`，或走本应用的 /api-proxy 代理。
 */
export type SpecFetchErrorCode =
  | 'invalidUrl'
  | 'unsupportedProtocol'
  | 'timeout'
  | 'http'
  | 'network'
  | 'empty'

export class SpecFetchError extends Error {
  code: SpecFetchErrorCode
  /** HTTP 错误状态码（code === 'http' 时） */
  status?: number
  statusText?: string
  /** 实际请求的地址（便于提示里点明是哪个 URL） */
  url?: string
  /** 额外原始信息，如非法输入串（code === 'invalidUrl' 时） */
  detail?: string
  constructor(
    code: SpecFetchErrorCode,
    message: string,
    extra: { status?: number; statusText?: string; url?: string; detail?: string } = {}
  ) {
    super(message)
    this.name = 'SpecFetchError'
    this.code = code
    this.status = extra.status
    this.statusText = extra.statusText
    this.url = extra.url
    this.detail = extra.detail
  }
}

export async function fetchOpenApiFromUrl(
  input: string,
  options: { timeout?: number; signal?: AbortSignal } = {}
): Promise<{ text: string; url: string }> {
  let url: URL
  try {
    url = new URL(input, location.href)
  } catch {
    throw new SpecFetchError('invalidUrl', `Invalid URL: ${input}`, { detail: input })
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new SpecFetchError('unsupportedProtocol', `Only HTTP/HTTPS URLs are supported (got ${url.protocol}).`, {
      url: url.href,
    })
  // 超时用 AbortController 兜住，避免服务无响应时界面一直转圈还报不出所以然。
  const controller = new AbortController()
  const timeoutMs = options.timeout ?? 20000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(url, { signal: options.signal ?? controller.signal })
  } catch (err: any) {
    clearTimeout(timer)
    if (err?.name === 'AbortError')
      throw new SpecFetchError('timeout', `Request timed out after ${Math.round(timeoutMs / 1000)}s.`, {
        url: url.href,
      })
    // TypeError: Failed to fetch —— 既可能是 CORS 拦截，也可能是 DNS/离线/服务未启动。
    // 浏览器不会透露具体原因，故 code 统一为 network，由 UI 给出 CORS 与其他可能性的区分提示。
    throw new SpecFetchError('network', `Failed to fetch ${url.href}.`, { url: url.href })
  }
  clearTimeout(timer)
  if (!response.ok)
    throw new SpecFetchError('http', `Server returned ${response.status} ${response.statusText || ''}.`, {
      status: response.status,
      statusText: response.statusText,
      url: url.href,
    })
  const text = await response.text()
  if (!text.trim())
    throw new SpecFetchError('empty', `Server returned an empty body for ${url.href}.`, { url: url.href })
  return { text, url: url.href }
}

/** OpenAPI Tag Object 的可选元数据（description / externalDocs）。 */
export interface TagMeta {
  description?: string
  externalDocs?: { description?: string; url: string }
}

/**
 * 从 spec.tags 构建 name → { description, externalDocs } 映射。
 * 这两个字段都是 OpenAPI Tag Object 的可选字段，规范不要求必有：
 * - 有 description → 在分组标题下呈现说明
 * - 有 externalDocs.url → 呈现「文档」外链
 * - 都没有 → 该 tag 在映射里仍有一条空记录，调用方按「无元数据」忽略即可
 */
export function tagMetaMap(spec: any): Map<string, TagMeta> {
  const map = new Map<string, TagMeta>()
  const tags = Array.isArray(spec?.tags) ? spec.tags : []
  for (const tag of tags) {
    if (!tag || typeof tag.name !== 'string') continue
    const externalDocs =
      tag.externalDocs && typeof tag.externalDocs.url === 'string'
        ? {
            description:
              typeof tag.externalDocs.description === 'string' && tag.externalDocs.description.trim()
                ? tag.externalDocs.description
                : undefined,
            url: tag.externalDocs.url,
          }
        : undefined
    map.set(tag.name, {
      description:
        typeof tag.description === 'string' && tag.description.trim() ? tag.description : undefined,
      externalDocs,
    })
  }
  return map
}

export function getOperations(spec: any): any[] {
  return Object.entries(spec.paths).flatMap(([path, rawItem]) => {
    const item = resolveRef(rawItem, spec)
    return METHODS.filter((method) => item[method]).map((method) => {
      const operation = resolveRef(item[method], spec)
      const params = [...(item.parameters || []), ...(operation.parameters || [])].map(
        (param) => resolveRef(param, spec)
      )
      const parameters = [
        ...new Map(params.map((param) => [`${param.in}:${param.name}`, param])).values(),
      ]
      let requestBody = operation.requestBody ? resolveRef(operation.requestBody, spec) : undefined
      if (spec.swagger === '2.0') {
        const body = parameters.find((param: any) => param.in === 'body')
        const form = parameters.filter((param: any) => param.in === 'formData')
        if (body || form.length) {
          const contentTypes =
            operation.consumes ||
            spec.consumes ||
            [form.length ? 'application/x-www-form-urlencoded' : 'application/json']
          requestBody = {
            required: body?.required,
            content: Object.fromEntries(
              contentTypes.map((type: string) => [
                type,
                {
                  schema: body?.schema || {
                    type: 'object',
                    properties: Object.fromEntries(form.map((param: any) => [param.name, param])),
                  },
                },
              ])
            ),
          }
        }
      }
      return {
        ...operation,
        id: `${method} ${path}`,
        path,
        method,
        parameters: parameters.filter((param: any) => !['body', 'formData'].includes(param.in)),
        requestBody,
        security: operation.security ?? spec.security ?? [],
        servers: operation.servers || item.servers || spec.servers,
      }
    })
  })
}

export function exampleFor(
  rawSchema: any,
  spec: any,
  depth = 0,
  visited = new Set<string>()
): any {
  if (depth > 6 || (rawSchema?.$ref && visited.has(rawSchema.$ref))) return null
  const next = new Set(visited)
  if (rawSchema?.$ref) next.add(rawSchema.$ref)
  const schema = resolveRef(rawSchema, spec)
  if (schema.example !== undefined) return schema.example
  if (schema.examples?.length) return schema.examples[0]
  if (schema.default !== undefined) return schema.default
  if (schema.enum?.length) return schema.enum[0]
  if (schema.allOf)
    return Object.assign(
      {},
      ...schema.allOf.map((item: any) => exampleFor(item, spec, depth + 1, next))
    )
  if (schema.oneOf || schema.anyOf)
    return exampleFor((schema.oneOf || schema.anyOf)[0], spec, depth + 1, next)
  const type = Array.isArray(schema.type)
    ? schema.type.find((item: string) => item !== 'null')
    : schema.type
  if (type === 'object' || schema.properties)
    return Object.fromEntries(
      Object.entries(schema.properties || {})
        .filter(([, value]) => !(value as any).readOnly)
        .map(([name, value]) => [name, exampleFor(value, spec, depth + 1, next)])
    )
  if (type === 'array')
    return Array.from({ length: Math.min(schema.minItems || 1, 5) }, () =>
      exampleFor(schema.items, spec, depth + 1, next)
    )
  if (type === 'boolean') return true
  if (type === 'integer' || type === 'number') return schema.minimum ?? 0
  if (schema.format === 'date-time') return new Date().toISOString()
  if (schema.format === 'date') return new Date().toISOString().slice(0, 10)
  if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000001'
  if (schema.format === 'email') return 'user@example.com'
  if (schema.format === 'binary' || type === 'file') return ''
  return 'string'
}

export function bodyExample(operation: any, spec: any, contentType: string): string {
  const media = operation.requestBody?.content?.[contentType]
  if (!media) return ''
  const example =
    media.example ?? resolveRef(Object.values(media.examples || {})[0], spec).value ?? exampleFor(media.schema, spec)
  return typeof example === 'string' ? example : JSON.stringify(example, null, 2)
}

export function makeDraft(operation: any, spec: any): any {
  const contentType = Object.keys(operation.requestBody?.content || {})[0] || ''
  const parameters = operation.parameters.map((param: any) => {
    const schema = resolveRef(param.schema || param, spec)
    const value = param.example ?? schema.default ?? ''
    return {
      name: param.name,
      location: param.in,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
      enabled: param.required || value !== '',
      required: !!param.required,
    }
  })
  const schema = resolveRef(operation.requestBody?.content?.[contentType]?.schema, spec)
  return {
    path: operation.path,
    parameters,
    headers: [],
    body: bodyExample(operation, spec, contentType),
    contentType,
    form: Object.entries(schema.properties || {}).map(([name, value]: [string, any]) => ({
      name,
      value: value.default ?? '',
      enabled: true,
      file: value.format === 'binary' || value.type === 'file',
    })),
    outputs: [],
    authEnabled: true,
  }
}

/**
 * 集合级共享的 headers/parameters（基底）与单个请求自身的 draft 同名字段合并。
 * - headers 按名称（忽略大小写）去重；parameters 按「名称 + 位置(location)」去重。
 * - 请求级同名项覆盖集合级；集合级为空时等价于原数组，旧数据不受影响。
 * - 不做启用/禁用过滤：保留原行（含 disabled），交给 buildRequest 在发送时统一按 enabled 处理。
 */
export function mergeCollectionRows(
  base: KeyValueRow[] | undefined,
  override: KeyValueRow[] | undefined,
  byLocation: boolean
): KeyValueRow[] {
  const key = (row: KeyValueRow) =>
    byLocation ? `${row.name.toLowerCase()}|${row.location || ''}` : row.name.toLowerCase()
  const map = new Map<string, KeyValueRow>()
  for (const row of base || []) if (row?.name) map.set(key(row), row)
  for (const row of override || []) if (row?.name) map.set(key(row), row)
  return [...map.values()]
}

/**
 * 把集合的「多组共享配置」叠加合并进某个请求：
 * - 收集所有把该接口勾选为生效目标的组（groups 中 targets 含 requestId 的）；
 * - 组间按数组顺序合并，后者覆盖前者同名项（header 按名、param 按 名+位置）；
 * - 最后请求自身 draft 作为最优先覆盖层。
 * 不改动入参，返回新的 draft。
 */
export function applyCollectionSettings(
  requestId: string,
  groups: { headers?: KeyValueRow[]; parameters?: KeyValueRow[]; targets?: string[] }[] | undefined,
  requestDraft: Draft
): Draft {
  const applicable = (groups || []).filter((group) => (group.targets || []).includes(requestId))
  let headersBase: KeyValueRow[] = []
  let parametersBase: KeyValueRow[] = []
  for (const group of applicable) {
    headersBase = mergeCollectionRows(headersBase, group.headers, false)
    parametersBase = mergeCollectionRows(parametersBase, group.parameters, true)
  }
  return {
    ...requestDraft,
    headers: mergeCollectionRows(headersBase, requestDraft.headers, false),
    parameters: mergeCollectionRows(parametersBase, requestDraft.parameters, true),
  }
}

/**
 * 变量 / 输出变量的「名字」经常被用户照抄成 `{{token}}` 或 `{{@token}}`（把引用语法当成了名字），
 * 于是出现「变量面板里能看到且有值，但 `{{token}}` 却提示不存在、可用列表还显示成 `{{{{token}}}}`」的怪象。
 * 这里把外层的 `{{ }}`、前导 `@` 和空白一律剥掉，让 `{{token}}` / `@token` / `token` 都归一为 `token`。
 */
export function normalizeVarName(name: any): string {
  let n = String(name ?? '').trim()
  n = n.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '')
  n = n.replace(/^@/, '').trim()
  return n
}

/**
 * 变量查找：名字归一化后精确匹配（同时兼容"首尾带空格 / 带 `{{ }}` / 带 `@` 前缀"的写法）。
 * 粘贴变量名时带上看不见的首尾空格、或把 `{{token}}` 当名字填，太常见了 —— 肉眼看完全一致却匹配不上。
 *
 * 判定（variableReferences）和替换（replaceVariables）**必须共用这一份**，
 * 否则会出现「界面判定变量已解析、真正发请求时却原样发出 {{x}}」这种两端打架。
 */
function variableLookup(variables: any[]): (name: string) => any {
  const usable = (variables || []).filter((variable: any) => variable.enabled !== false)
  const byName = new Map<string, any>()
  for (const variable of usable) {
    const norm = normalizeVarName(variable.name)
    if (norm && !byName.has(norm)) byName.set(norm, variable)
  }
  return (name: string) => byName.get(normalizeVarName(name))
}

export function replaceVariables(value: string | undefined | null, variables: any[]): string {
  const lookup = variableLookup(variables)
  return String(value ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match: string, name: string): string => {
    const hit = lookup(name) ?? (name.startsWith('@') ? lookup(name.slice(1)) : undefined)
    return hit ? String(hit.value ?? '') : match
  })
}

export function variableReferences(
  value: string,
  variables: any[] = [],
  outputs: any[] = []
): any[] {
  const lookup = variableLookup(variables)
  return Array.from(String(value ?? '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), (match) => {
    const name = match[1]
    const output = name.startsWith('@')
    const variable = lookup(name) ?? (output ? lookup(name.slice(1)) : undefined)
    const paths = output
      ? [
          ...new Set(
            outputs
              .filter(
                (item) =>
                  normalizeVarName(item.name) === normalizeVarName(name.slice(1)) && item.path
              )
              .map((item) => item.path)
          ),
        ]
      : []
    return {
      start: match.index,
      end: match.index! + match[0].length,
      name,
      output,
      status: variable ? 'resolved' : paths.length ? 'pending' : 'missing',
      value: variable ? replaceVariables(match[0], variables) : undefined,
      paths,
    }
  })
}

export function serverUrl(spec: any, source: string, fallback = location.origin): string {
  let server = spec.servers?.[0]?.url
  if (server)
    server = server.replace(
      /\{([^}]+)\}/g,
      (match: string, name: string) => spec.servers[0].variables?.[name]?.default ?? match
    )
  if (!server && spec.host)
    server = `${spec.schemes?.[0] || 'https'}://${spec.host}${spec.basePath || ''}`
  const base = source && /^https?:/i.test(source) ? source : fallback
  return new URL(server || '/', base).href.replace(/\/$/, '')
}

export function securitySchemes(spec: any): any {
  return spec.components?.securitySchemes || spec.securityDefinitions || {}
}

export function credentialPresent(scheme: any, value: any): boolean {
  if (!value) return false
  if (value.expiresAt && value.expiresAt <= Date.now()) return false
  if (scheme.type === 'basic' || scheme.scheme === 'basic') return !!value.username
  return !!value.token
}

/**
 * 把凭据里的 `{{变量}}` 替换成变量值（token / username / password 都支持，
 * 输出变量的 `@` 前缀写法同样有效）。
 * 变量不存在时保留原样 —— 与请求参数的处理一致，不会静默发空值。
 */
export function resolveCredential(credential: any, variables: any[] = []): Record<string, any> {
  if (!credential || !variables?.length) return credential || {}
  const resolved: Record<string, any> = { ...credential }
  for (const key of ['token', 'username', 'password'])
    if (typeof resolved[key] === 'string') resolved[key] = replaceVariables(resolved[key], variables)
  return resolved
}

/**
 * 凭据值里引用了但**取不到值**的 `{{变量}}`。
 * 令牌框是最容易踩的地方：填 `{{token}}` 而变量没定义时，界面原本照样显示"已配置"，
 * 请求发出去的却是字面量 `Bearer {{token}}`，必然 401 且无任何提示。
 * 复用 variableReferences —— 它是唯一权威的判定，能区分"已解析 / 待生成的输出变量 / 真的缺失"。
 */
export function credentialVariableIssues(
  credential: any,
  variables: any[] = [],
  outputs: any[] = []
): string[] {
  if (!credential) return []
  const issues: string[] = []
  for (const key of ['token', 'username', 'password']) {
    if (typeof credential[key] !== 'string') continue
    // 只认 'missing'：'pending' 是"输出变量已声明但还没跑过来源请求"，属预期状态，不该报警
    for (const reference of variableReferences(credential[key], variables, outputs))
      if (reference.status === 'missing') issues.push(reference.name)
  }
  return [...new Set(issues)]
}

/**
 * 把取不到值的引用按类型分流：带 `@` 的是"输出变量"（还没配提取规则），
 * 其余是普通变量（「变量」面板里压根没这个名字）。
 * 两者的下一步动作完全不同 —— 混在一起提示，用户只会照抄示例然后继续 401。
 */
export function splitUnresolved(names: string[] = []): {
  outputs: string[]
  variables: string[]
} {
  const outputs = names.filter((name) => name.startsWith('@'))
  return { outputs, variables: names.filter((name) => !name.startsWith('@')) }
}

export type CredentialIssueKind = 'output' | 'disabled' | 'case' | 'notFound'

export interface CredentialIssue {
  /** 引用里写的原始名字（带 @ 前缀表示输出变量） */
  name: string
  kind: CredentialIssueKind
  /** kind === 'case' 时给出变量面板里真实存在的那个名字 */
  suggestion?: string
}

/**
 * 光说"变量不存在"没用 —— 变量面板里明明看得到。真正的原因通常是这三种之一，
 * 判出来才能给出可执行的下一步（而不是让用户对着界面怀疑人生）。
 */
export function credentialIssues(
  credential: any,
  variables: any[] = [],
  outputs: any[] = []
): CredentialIssue[] {
  if (!credential) return []
  const norm = (value: any) => String(value ?? '').trim()
  const lower = (value: any) => norm(value).toLowerCase()
  const usable = (variables || []).filter((variable) => variable.enabled !== false)
  const disabled = (variables || []).filter((variable) => variable.enabled === false)
  const issues: CredentialIssue[] = []
  for (const key of ['token', 'username', 'password']) {
    if (typeof credential[key] !== 'string') continue
    for (const reference of variableReferences(credential[key], variables, outputs)) {
      if (reference.status !== 'missing') continue
      let issue: CredentialIssue
      if (reference.output) issue = { name: reference.name, kind: 'output' }
      else if (disabled.some((variable) => norm(variable.name) === norm(reference.name)))
        issue = { name: reference.name, kind: 'disabled' }
      else {
        const caseHit = usable.find((variable) => lower(variable.name) === lower(reference.name))
        issue = caseHit
          ? { name: reference.name, kind: 'case', suggestion: norm(caseHit.name) }
          : { name: reference.name, kind: 'notFound' }
      }
      if (!issues.some((item) => item.name === issue.name && item.kind === issue.kind))
        issues.push(issue)
    }
  }
  return issues
}

/**
 * 把诊断结果渲染成人话。四处提示（授权面板 / 侧栏徽标 / 请求头红字 / 发送 toast）
 * 共用这一份措辞，避免同一个问题四种说法。
 */
export function credentialIssueMessages(
  credential: any,
  variables: any[] = [],
  outputs: any[] = [],
  translate: (key: string, params?: Record<string, any>) => string
): string[] {
  const issues = credentialIssues(credential, variables, outputs)
  if (!issues.length) return []
  const refs = (names: string[]) => names.map((name) => `{{${name}}}`).join(', ')
  const available = (variables || [])
    .filter((variable) => variable.enabled !== false && normalizeVarName(variable.name))
    .map((variable) => normalizeVarName(variable.name))
  const messages: string[] = []
  const pick = (kind: CredentialIssueKind) => issues.filter((issue) => issue.kind === kind)

  const outputs_ = pick('output')
  if (outputs_.length)
    messages.push(translate('auth.unresolvedOutput', { names: refs(outputs_.map((i) => i.name)) }))

  const disabled = pick('disabled')
  if (disabled.length)
    messages.push(translate('auth.variableDisabled', { names: refs(disabled.map((i) => i.name)) }))

  const caseIssues = pick('case')
  if (caseIssues.length)
    messages.push(
      translate('auth.variableCase', {
        names: refs(caseIssues.map((i) => i.name)),
        suggestion: refs(caseIssues.map((i) => i.suggestion as string)),
      })
    )

  const notFound = pick('notFound')
  if (notFound.length)
    messages.push(
      translate('auth.variableNotFound', {
        names: refs(notFound.map((i) => i.name)),
        available: available.length ? refs(available.slice(0, 6)) : translate('auth.noVariablesYet'),
      })
    )
  return messages
}

/** 凭据是否真的可用：有值，且里面的变量引用都拿得到值。 */
export function credentialSatisfied(
  scheme: any,
  value: any,
  variables: any[] = [],
  outputs: any[] = []
): boolean {
  return (
    credentialPresent(scheme, value) && credentialVariableIssues(value, variables, outputs).length === 0
  )
}

/**
 * Resolves whether an operation requires credentials and whether the current
 * credentials satisfy at least one of its security requirements.
 * OpenAPI semantics: an empty requirement object `{}` means anonymous access is
 * allowed; an empty `security` array means the operation is explicitly public.
 */
export function authStatus(
  operation: any,
  spec: any,
  credentials: any = {},
  variables: any[] = [],
  outputs: any[] = []
): AuthStatus {
  const requirements: any[] = operation?.security || []
  const schemesMap = securitySchemes(spec)
  const schemes: string[] = []
  const missing: string[] = []
  const unresolved: string[] = []
  let required = false
  let satisfied = false
  for (const group of requirements) {
    const names = Object.keys(group || {})
    if (!names.length) {
      satisfied = true
      continue
    }
    required = true
    schemes.push(...names)
    let groupSatisfied = true
    for (const name of names) {
      const issues = credentialVariableIssues(credentials?.[name], variables, outputs)
      if (issues.length) {
        groupSatisfied = false
        unresolved.push(...issues)
      }
      if (!credentialPresent(resolveRef(schemesMap[name], spec), credentials?.[name])) {
        groupSatisfied = false
        if (!missing.includes(name)) missing.push(name)
      }
    }
    if (groupSatisfied) satisfied = true
  }
  return {
    required,
    satisfied,
    schemes: [...new Set(schemes)],
    missing,
    unresolved: [...new Set(unresolved)],
  }
}

/**
 * 找出 operation 当前真正能兑现的那一条 security requirement，并解析出对应的 scheme 与凭据。
 * buildRequest（真正发请求）和 RequestView 的「请求头」预览共用这一份逻辑，
 * 避免两边算法漂移 —— 以前就是 UI 不知道自己在注入什么，用户看着像"没带令牌"。
 */
export function resolvedAuth(
  operation: any,
  credentials: any = {},
  spec: any = {},
  variables: any[] = []
): { name: string; scheme: any; credential: Record<string, any> }[] {
  if (!operation?.security?.length) return []
  const schemes = securitySchemes(spec)
  const requirement = operation.security.find((group: any) =>
    Object.keys(group).every((name: string) =>
      credentialPresent(resolveRef(schemes[name], spec), credentials[name])
    )
  )
  return Object.keys(requirement || {}).map((name: string) => ({
    name,
    scheme: resolveRef(schemes[name], spec),
    credential: resolveCredential(credentials[name], variables),
  }))
}

/**
 * 用户几乎必然会把文档里那句「这里填：Bearer {token}」照抄进令牌框，
 * 于是发出 `Authorization: Bearer Bearer eyJ...`，服务端一律 401 ——
 * 而界面上又看不到真实请求头，只能靠猜。这里把多余的前缀剥掉。
 */
export function bearerToken(token: any): string {
  const raw = String(token ?? '').trim()
  return /^bearer\s+/i.test(raw) ? raw.replace(/^bearer\s+/i, '').trim() : raw
}

/**
 * 单个 scheme 应该写进请求头的名值对。
 * apiKey 落在 query / cookie 时不产生请求头（query 由 buildRequest 拼到 URL，
 * cookie 浏览器禁止设置），返回 null。
 */
export function authHeader(scheme: any, credential: any): { name: string; value: string } | null {
  if (!credential) return null
  if (scheme.type === 'apiKey') {
    if (scheme.in === 'query' || scheme.in === 'cookie') return null
    return { name: scheme.name, value: String(credential.token ?? '').trim() }
  }
  if (scheme.type === 'basic' || scheme.scheme === 'basic')
    return {
      name: 'Authorization',
      value: `Basic ${btoa(unescape(encodeURIComponent(`${credential.username}:${credential.password || ''}`)))}`,
    }
  return { name: 'Authorization', value: `Bearer ${bearerToken(credential.token)}` }
}

function parameterValue(parameter: any, definition: any, value: string): string[] {
  const type = definition?.schema?.type || definition?.type
  if (type === 'array') {
    const values = value.trim().startsWith('[') ? JSON.parse(value) : value.split(',')
    const delimiterMap: Record<string, string> = {
      spaceDelimited: ' ',
      pipeDelimited: '|',
      ssv: ' ',
      pipes: '|',
      tsv: '\t',
    }
    const delimiter = delimiterMap[definition.style || definition.collectionFormat] || ','
    const explode =
      definition.explode ?? (parameter.location === 'query' && !definition.collectionFormat)
    return (explode || definition.collectionFormat === 'multi') && parameter.location === 'query'
      ? values
      : [values.join(delimiter)]
  }
  return [value]
}

export function buildRequest(
  operation: any,
  draft: any,
  server: string,
  variables: any[] = [],
  credentials: any = {},
  spec: any = {},
  files: Record<string, File | undefined> = {}
): { url: string; options: RequestInit } {
  const replace = (value: string) => replaceVariables(value, variables)
  let path = replace(draft.path || operation.path)
  const query = new URLSearchParams()
  const headers = new Headers()
  for (const parameter of draft.parameters || []) {
    if (!parameter.enabled && !parameter.required) continue
    const value = replace(parameter.value)
    if (parameter.required && !value) throw new Error(`Required parameter: ${parameter.name}`)
    const definition = operation.parameters.find(
      (item: any) => item.name === parameter.name && item.in === parameter.location
    )
    const values = parameterValue(parameter, definition, value)
    if (parameter.location === 'path')
      path = path.split(`{${parameter.name}}`).join(encodeURIComponent(values.join(',')))
    if (parameter.location === 'query') {
      if (definition?.style === 'deepObject') {
        for (const [name, child] of Object.entries(JSON.parse(value)))
          query.append(`${parameter.name}[${name}]`, String(child))
      } else values.forEach((item) => query.append(parameter.name, String(item)))
    }
    if (parameter.location === 'header') headers.set(parameter.name, values.join(','))
    if (parameter.location === 'cookie' && value)
      throw new Error('Browsers cannot set Cookie headers. Set cookies on the API origin.')
  }
  if (/\{[^{}]+\}/.test(path) && !/\{\{/.test(path))
    throw new Error('Fill all path parameters before sending.')
  if (/^https?:\/\//i.test(path))
    throw new Error('Use the server field for the API origin and a relative request path.')
  const url = new URL(`${replace(server).replace(/\/$/, '')}/${path.replace(/^\//, '')}`)
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Only HTTP and HTTPS requests are supported.')
  query.forEach((value, name) => url.searchParams.append(name, value))
  for (const header of draft.headers || [])
    if (header.enabled !== false && header.name) headers.set(header.name, replace(header.value))
  if (draft.authEnabled !== false) {
    for (const { scheme, credential } of resolvedAuth(operation, credentials, spec, variables)) {
      if (scheme.type === 'apiKey') {
        if (scheme.in === 'query')
          url.searchParams.set(scheme.name, String(credential.token ?? '').trim())
        else if (scheme.in === 'cookie')
          throw new Error('Cookie API keys must be set on the API origin.')
      }
      const header = authHeader(scheme, credential)
      if (header) headers.set(header.name, header.value)
    }
  }
  let body: any
  if (!['get', 'head'].includes(operation.method)) {
    if (
      draft.contentType === 'multipart/form-data' ||
      draft.contentType === 'application/x-www-form-urlencoded'
    ) {
      body = draft.contentType === 'multipart/form-data' ? new FormData() : new URLSearchParams()
      for (const field of draft.form || []) {
        if (field.enabled === false || !field.name) continue
        if (field.file) {
          if (files[field.name]) body.append(field.name, files[field.name])
        } else body.append(field.name, replace(field.value))
      }
      if (draft.contentType === 'multipart/form-data') headers.delete('Content-Type')
      else headers.set('Content-Type', draft.contentType)
    } else if (draft.body) {
      body = replace(draft.body)
      if (draft.contentType?.includes('json')) JSON.parse(body)
      if (draft.contentType) headers.set('Content-Type', draft.contentType)
    }
    if (operation.requestBody?.required && !body) throw new Error('Request body is required.')
  }
  return {
    url: url.href,
    options: { method: operation.method.toUpperCase(), headers, body },
  }
}

export async function sendRequest(
  request: { url: string; options: RequestInit },
  signal?: AbortSignal
): Promise<any> {
  const started = performance.now()
  let response: Response
  try {
    response = await fetch(request.url, { ...request.options, signal })
  } catch (error: any) {
    throw new Error(
      error?.name === 'AbortError'
        ? 'Request cancelled'
        : `${error?.message || 'Failed to fetch'} (URL: ${request.url})`
    )
  }
  const blob = await response.blob()
  const contentType = response.headers.get('content-type') || ''
  const binary =
    /^(image|audio|video)\//.test(contentType) ||
    /octet-stream|pdf|zip|officedocument/.test(contentType)
  const text = binary ? '' : await blob.text()
  let body = text
  try {
    body = JSON.stringify(JSON.parse(text), null, 2)
  } catch {}
  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    blob,
    binary,
    duration: Math.round(performance.now() - started),
    size: blob.size,
    contentType,
  }
}

export function extractOutputs(outputs: any[], body: string, variables: any[]): any[] {
  let updated = [...variables]
  if (!outputs?.some((output) => output.name && output.path)) return updated
  const json = JSON.parse(body)
  for (const output of outputs) {
    if (!output.name || !output.path) continue
    const values = JSONPath({ path: output.path, json, eval: false })
    if (!values.length) continue
    const value = typeof values[0] === 'object' ? JSON.stringify(values[0]) : String(values[0])
    updated = [
      ...updated.filter((variable) => variable.name !== output.name),
      { name: output.name, value, enabled: true },
    ]
  }
  return updated
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
