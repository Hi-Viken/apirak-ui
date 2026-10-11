import { describe, expect, it } from 'vitest'
import {
  authStatus,
  buildRequest,
  credentialIssueMessages,
  credentialIssues,
  credentialSatisfied,
  credentialVariableIssues,
  mergeCollectionRows,
  applyCollectionSettings,
  normalizeVarName,
  replaceVariables,
  resolveCredential,
  splitUnresolved,
  variableReferences,
} from './api'

const spec = {
  components: {
    securitySchemes: {
      Bearer: { type: 'http', scheme: 'bearer' },
      ApiKey: { type: 'apiKey', name: 'X-Api-Key', in: 'header' },
      Basic: { type: 'http', scheme: 'basic' },
    },
  },
}

function headersFor(scheme: string, credential: any, variables: any[] = []) {
  const operation = { method: 'get', path: '/me', security: [{ [scheme]: [] }], parameters: [] }
  const draft = { path: '/me', parameters: [], headers: [], authEnabled: true }
  const { options } = buildRequest(
    operation,
    draft,
    'http://api.test',
    variables,
    { [scheme]: credential },
    spec
  )
  return new Headers(options.headers as any)
}

describe('replaceVariables', () => {
  it('replaces plain and output variables', () => {
    const variables = [
      { name: 'base', value: 'http://x' },
      { name: '@token', value: 't-123' },
      { name: 'off', value: 'no', enabled: false },
    ]
    expect(replaceVariables('{{base}}/v1', variables)).toBe('http://x/v1')
    expect(replaceVariables('Bearer {{@token}}', variables)).toBe('Bearer t-123')
    expect(replaceVariables('{{off}}', variables)).toBe('{{off}}')
  })

  it('leaves unknown variables untouched', () => {
    expect(replaceVariables('Bearer {{nope}}', [])).toBe('Bearer {{nope}}')
  })
})

describe('resolveCredential', () => {
  it('resolves token, username and password', () => {
    const variables = [{ name: 'token', value: 'abc' }, { name: 'pw', value: 's3cret' }]
    expect(resolveCredential({ token: '{{token}}' }, variables)).toEqual({ token: 'abc' })
    expect(resolveCredential({ username: 'u', password: '{{pw}}' }, variables)).toEqual({
      username: 'u',
      password: 's3cret',
    })
  })

  it('keeps non-string fields (like expiresAt) as-is', () => {
    const expiresAt = Date.now() + 1000
    expect(resolveCredential({ token: 'x', expiresAt }, [{ name: 'a', value: 'b' }])).toEqual({
      token: 'x',
      expiresAt,
    })
  })

  it('returns the original object when there are no variables', () => {
    const credential = { token: '{{nothing}}' }
    expect(resolveCredential(credential, []).token).toBe('{{nothing}}')
  })
})

describe('buildRequest credentials', () => {
  it('extracts the bearer token from a variable', () => {
    const headers = headersFor('Bearer', { token: '{{token}}' }, [{ name: 'token', value: 'abc' }])
    expect(headers.get('Authorization')).toBe('Bearer abc')
  })

  it('extracts an api key from a variable', () => {
    const headers = headersFor('ApiKey', { token: '{{key}}' }, [{ name: 'key', value: 'k-1' }])
    expect(headers.get('X-Api-Key')).toBe('k-1')
  })

  it('extracts basic credentials from variables', () => {
    const headers = headersFor(
      'Basic',
      { username: '{{user}}', password: '{{pw}}' },
      [
        { name: 'user', value: 'admin' },
        { name: 'pw', value: 'admin123' },
      ]
    )
    expect(headers.get('Authorization')).toBe(`Basic ${btoa('admin:admin123')}`)
  })

  it('falls back to the literal placeholder when the variable is missing', () => {
    const headers = headersFor('Bearer', { token: '{{missing}}' }, [])
    expect(headers.get('Authorization')).toBe('Bearer {{missing}}')
  })

  it('still sends a literal token unchanged', () => {
    const headers = headersFor('Bearer', { token: 'plain-token' }, [{ name: 'token', value: 'abc' }])
    expect(headers.get('Authorization')).toBe('Bearer plain-token')
  })

  // 文档里那句「这里填：Bearer {token}」几乎必然被照抄进令牌框，
  // 不剥前缀就会发出 `Bearer Bearer eyJ...`，服务端一律 401。
  it('strips a redundant Bearer prefix pasted into the token field', () => {
    expect(headersFor('Bearer', { token: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y' }).get('Authorization')).toBe(
      'Bearer eyJhbGciOiJIUzI1NiJ9.x.y'
    )
  })

  it('strips the prefix case-insensitively and trims whitespace', () => {
    expect(headersFor('Bearer', { token: '  bearer abc  ' }).get('Authorization')).toBe('Bearer abc')
  })

  it('does not touch a token that merely starts with those letters', () => {
    expect(headersFor('Bearer', { token: 'Bearing gifts' }).get('Authorization')).toBe(
      'Bearer Bearing gifts'
    )
  })
})

describe('凭据里的变量识别', () => {
  const bearerScheme = { type: 'http', scheme: 'bearer' }

  it('变量有值 → 视为已配置', () => {
    const variables = [{ name: 'token', value: 'abc' }]
    expect(credentialVariableIssues({ token: '{{token}}' }, variables)).toEqual([])
    expect(credentialSatisfied(bearerScheme, { token: '{{token}}' }, variables)).toBe(true)
  })

  it('变量未定义 → 报出变量名，且不算已配置', () => {
    expect(credentialVariableIssues({ token: '{{token}}' }, [{ name: 'other', value: 'x' }])).toEqual([
      'token',
    ])
    expect(credentialSatisfied(bearerScheme, { token: '{{token}}' }, [])).toBe(false)
  })

  it('变量被禁用 → 算取不到值', () => {
    expect(
      credentialVariableIssues({ token: '{{token}}' }, [{ name: 'token', value: 'x', enabled: false }])
    ).toEqual(['token'])
  })

  // 变量值为空串时界面会显示「值：空字符串」，跟其它输入框口径一致，不额外报警
  it('变量值为空串 → 不算缺失（与其它输入框口径一致）', () => {
    expect(credentialVariableIssues({ token: '{{token}}' }, [{ name: 'token', value: '' }])).toEqual([])
  })

  it('已声明的输出变量还没生成 → 不算缺失（不该误报）', () => {
    const outputs = [{ name: '@token', path: '$.token' }]
    expect(credentialVariableIssues({ token: '{{@token}}' }, [], outputs)).toEqual([])
  })

  it('authStatus 把未解析变量暴露出来，并判为未满足', () => {
    const operation = { method: 'get', path: '/me', security: [{ Bearer: [] }] }
    const status = authStatus(operation, spec, { Bearer: { token: '{{token}}' } }, [])
    expect(status.required).toBe(true)
    expect(status.satisfied).toBe(false)
    expect(status.unresolved).toEqual(['token'])
  })

  it('变量解析成功后 authStatus 才算满足', () => {
    const operation = { method: 'get', path: '/me', security: [{ Bearer: [] }] }
    const status = authStatus(
      operation,
      spec,
      { Bearer: { token: '{{token}}' } },
      [{ name: 'token', value: 'abc' }]
    )
    expect(status.satisfied).toBe(true)
    expect(status.unresolved).toEqual([])
  })
})

describe('@ 前缀（输出变量语法）', () => {
  const outputs = [{ name: 'token', path: '$.token' }]

  it('误加 @ 但存在同名普通变量 → 照样解析，不该报错', () => {
    const variables = [{ name: 'token', value: 'JWT' }]
    expect(credentialVariableIssues({ token: '{{@token}}' }, variables, outputs)).toEqual([])
    expect(replaceVariables('{{@token}}', variables)).toBe('JWT')
  })

  it('只声明了输出变量、还没跑过来源请求 → pending，不报错', () => {
    const refs = variableReferences('{{@token}}', [], outputs)
    expect(refs[0].status).toBe('pending')
    expect(credentialVariableIssues({ token: '{{@token}}' }, [], outputs)).toEqual([])
  })

  it('输出变量声明时自己也带 @ → 同样匹配得上', () => {
    const refs = variableReferences('{{@token}}', [], [{ name: '@token', path: '$.token' }])
    expect(refs[0].status).toBe('pending')
  })

  it('什么都没定义 → missing，名字保留 @ 便于提示分流', () => {
    expect(credentialVariableIssues({ token: '{{@token}}' }, [], [])).toEqual(['@token'])
  })
})

describe('normalizeVarName', () => {
  it('剥掉外层的 {{ }}', () => {
    expect(normalizeVarName('{{token}}')).toBe('token')
    expect(normalizeVarName('{{ @token }}')).toBe('token')
  })

  it('剥掉前导 @', () => {
    expect(normalizeVarName('@token')).toBe('token')
    expect(normalizeVarName('{{@token}}')).toBe('token')
  })

  it('剥掉首尾空白', () => {
    expect(normalizeVarName('  token  ')).toBe('token')
  })

  it('空 / 仅花括号 → 空串', () => {
    expect(normalizeVarName('')).toBe('')
    expect(normalizeVarName('{{}}')).toBe('')
  })
})

describe('输出变量名字被填成 {{token}} 也能解析（容错）', () => {
  // 真实场景：用户把引用语法 `{{token}}` 当成了输出变量的「名字」填进去，
  // 于是变量面板里看得到且有值，但 `{{token}}` 却查不到、可用列表还显示成 `{{{{token}}}}`。
  it('引用的 {{token}} 能匹配到名为 {{token}} 的输出变量', () => {
    const variables = [{ name: '{{token}}', value: 'JWT' }]
    expect(replaceVariables('{{token}}', variables)).toBe('JWT')
    expect(credentialVariableIssues({ token: '{{token}}' }, variables)).toEqual([])
    expect(credentialSatisfied({ type: 'http' }, { token: '{{token}}' }, variables)).toEqual(true)
  })

  it('引用 {{@token}} 也能匹配到名为 {{token}} 的输出变量（并走 pending 判定）', () => {
    const variables = [{ name: '{{token}}', value: 'JWT' }]
    const outputs = [{ name: '{{token}}', path: '$.token' }]
    expect(replaceVariables('{{@token}}', variables)).toBe('JWT')
    expect(credentialVariableIssues({ token: '{{@token}}' }, variables, outputs)).toEqual([])
  })

  it('提示里的可用变量名不再双层花括号', () => {
    const messages = credentialIssueMessages(
      { token: '{{nope}}' },
      [{ name: '{{token}}', value: 'v' }],
      [],
      (key: string, params?: any) => `${key}|${params?.available ?? ''}`
    )
    expect(messages[0]).toContain('{{token}}')
    expect(messages[0]).not.toContain('{{{{token}}}}')
  })
})

describe('splitUnresolved', () => {
  it('按是否为输出变量分流', () => {
    expect(splitUnresolved(['@token', 'user', '@id'])).toEqual({
      outputs: ['@token', '@id'],
      variables: ['user'],
    })
  })

  it('空数组不炸', () => {
    expect(splitUnresolved([])).toEqual({ outputs: [], variables: [] })
    expect(splitUnresolved()).toEqual({ outputs: [], variables: [] })
  })
})

describe('凭据变量取不到值时，能说清是哪一种取不到', () => {
  // 变量面板里明明看得到却报"不存在"，真实原因就这三种
  it('变量被禁用（checkbox 未勾）→ disabled', () => {
    const issues = credentialIssues({ token: '{{tok}}' }, [{ name: 'tok', value: 'v', enabled: false }])
    expect(issues).toEqual([{ name: 'tok', kind: 'disabled' }])
  })

  it('大小写不一致 → case，并给出变量面板里的真名', () => {
    const issues = credentialIssues({ token: '{{Token}}' }, [{ name: 'token', value: 'v' }])
    expect(issues).toEqual([{ name: 'Token', kind: 'case', suggestion: 'token' }])
  })

  it('压根没这个变量 → notFound', () => {
    const issues = credentialIssues({ token: '{{nope}}' }, [{ name: 'token', value: 'v' }])
    expect(issues).toEqual([{ name: 'nope', kind: 'notFound' }])
  })

  it('带 @ 的走输出变量分支', () => {
    const issues = credentialIssues({ token: '{{@tok}}' }, [], [])
    expect(issues).toEqual([{ name: '@tok', kind: 'output' }])
  })

  it('变量名带首尾空格 → 直接算解析成功，不报错', () => {
    // 从别处粘贴变量名带上看不见的空格，肉眼看完全一致
    expect(credentialIssues({ token: '{{tok}}' }, [{ name: ' tok ', value: 'v' }])).toEqual([])
    expect(variableReferences('{{tok}}', [{ name: 'tok ', value: 'v' }])[0].status).toBe('resolved')
  })

  it('变量名带空格时，替换和判定必须一致', () => {
    // 判定说"已解析"、真正发请求却原样发出 {{tok}} 的话，就是静默 401
    const variables = [{ name: ' tok ', value: 'V' }]
    expect(replaceVariables('{{tok}}', variables)).toBe('V')
    expect(variableReferences('{{tok}}', variables)[0].status).toBe('resolved')
    expect(credentialSatisfied({ type: 'http' }, { token: '{{tok}}' }, variables, [])).toBe(true)
  })

  it('生成的提示里带上当前可用变量名，方便对照', () => {
    const messages = credentialIssueMessages(
      { token: '{{nope}}' },
      [{ name: 'token', value: 'v' }],
      [],
      (key: string, params?: any) => `${key}:${JSON.stringify(params ?? {})}`
    )
    expect(messages[0]).toContain('auth.variableNotFound')
    expect(messages[0]).toContain('{{token}}')
  })

  it('变量面板为空时提示"还没有任何变量"，而不是列一串空值', () => {
    const messages = credentialIssueMessages(
      { token: '{{nope}}' },
      [],
      [],
      (key: string, params?: any) => `${key}|${params?.available ?? ''}`
    )
    expect(messages[0]).toContain('auth.noVariablesYet')
  })
})

describe('mergeCollectionRows', () => {
  const a = { name: 'Authorization', value: 'Bearer c', enabled: true }
  const b = { name: 'X-Trace', value: '1', enabled: true }
  const p1 = { name: 'page', location: 'query', value: '1', enabled: true }
  const p2 = { name: 'apiKey', location: 'header', value: 'k', enabled: true }

  it('集合级为空时等价于请求级原数组', () => {
    expect(mergeCollectionRows(undefined, [a], false)).toEqual([a])
    expect(mergeCollectionRows([], [a], true)).toEqual([a])
  })

  it('请求级无配置时直接用集合级基底', () => {
    expect(mergeCollectionRows([a, b], undefined, false)).toEqual([a, b])
  })

  it('请求级同名项覆盖集合级（header 忽略大小写）', () => {
    const override = { name: 'authorization', value: 'Bearer x', enabled: true }
    expect(mergeCollectionRows([a, b], [override], false)).toEqual([override, b])
  })

  it('parameter 按 名称+位置 去重，不同 location 的同名参数可并存', () => {
    const override = { name: 'apiKey', location: 'query', value: 'q', enabled: true }
    const merged = mergeCollectionRows([p1, p2], [override], true)
    expect(merged).toContainEqual(p2)
    expect(merged).toContainEqual(override)
    expect(merged).toContainEqual(p1)
  })

  it('请求级未声明同名项时，集合级该项保留', () => {
    // 集合有 a、b；请求只覆盖了 a；b 应保留，且 a 的值为请求级覆盖值
    const merged = mergeCollectionRows([a, b], [{ name: 'Authorization', value: 'Bearer x' }], false)
    expect(merged).toContainEqual(b)
    expect(merged.find((r) => r.name.toLowerCase() === 'authorization')?.value).toBe('Bearer x')
  })
})

describe('applyCollectionSettings', () => {
  const draft = { headers: [{ name: 'Accept', value: 'application/json', enabled: true }], parameters: [] }
  const gAuth = { id: 'g1', name: 'auth', headers: [{ name: 'Authorization', value: 'Bearer x', enabled: true }], targets: ['r1', 'r2'] }
  const gVer = { id: 'g2', name: 'ver', headers: [{ name: 'X-Version', value: 'v2', enabled: true }], targets: ['r2', 'r3'] }

  it('未被任何组勾选的接口只保留自身 draft', () => {
    const merged = applyCollectionSettings('r9', [gAuth, gVer], draft)
    expect(merged.headers).toEqual(draft.headers)
  })

  it('被一个组勾选时叠加该组配置', () => {
    const merged = applyCollectionSettings('r1', [gAuth, gVer], draft)
    expect(merged.headers).toContainEqual(gAuth.headers![0])
    expect(merged.headers).toContainEqual(draft.headers[0])
    expect(merged.headers).not.toContainEqual(gVer.headers![0])
  })

  it('被多个组勾选时汇总所有组的配置', () => {
    const merged = applyCollectionSettings('r2', [gAuth, gVer], draft)
    expect(merged.headers).toContainEqual(gAuth.headers![0])
    expect(merged.headers).toContainEqual(gVer.headers![0])
    expect(merged.headers).toContainEqual(draft.headers[0])
  })

  it('组间同名项后者覆盖（按数组顺序）', () => {
    const overlapping = [
      { id: 'a', name: 'a', headers: [{ name: 'X-Token', value: 'first', enabled: true }], targets: ['r1'] },
      { id: 'b', name: 'b', headers: [{ name: 'X-Token', value: 'second', enabled: true }], targets: ['r1'] },
    ]
    const merged = applyCollectionSettings('r1', overlapping, draft)
    expect(merged.headers!.find((h: { name: string }) => h.name === 'X-Token')?.value).toBe('second')
  })

  it('请求自身配置最终优先于所有组', () => {
    const groups = [{ id: 'a', name: 'a', headers: [{ name: 'Accept', value: 'text/html', enabled: true }], targets: ['r1'] }]
    const merged = applyCollectionSettings('r1', groups, draft)
    expect(merged.headers!.find((h: { name: string }) => h.name === 'Accept')?.value).toBe('application/json')
  })

  it('无组时等价于原 draft', () => {
    expect(applyCollectionSettings('r1', undefined, draft)).toEqual(draft)
    expect(applyCollectionSettings('r1', [], draft)).toEqual(draft)
  })
})
