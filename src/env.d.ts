/// <reference types="vite/client" />

declare const __SPEC_URL__: string
declare const __SPEC_NAME__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module '@/lib/generators/javascriptApiClientGenerator' {
  export class JavaScriptApiGenerator {
    constructor(options?: Record<string, any>)
    options: Record<string, any>
    loadFromSwaggerData(data: any): any
    generateClient(moduleName?: string, className?: string): Record<string, string | null>
  }
}

declare module '@/lib/generators/csharpApiClientGenerator' {
  export class CSharpApiGenerator {
    constructor(options?: Record<string, any>)
    options: Record<string, any>
    loadFromSwaggerData(data: any): any
    generateClient(namespace?: string, className?: string): Record<string, string | null>
  }
}

interface Window {
  openapiHost?: any
  swaggerData?: any
}

/**
 * 本地 Monaco 入口 `src/lib/monaco.ts` 走的是 `edcore.main`，官方没有给它配 .d.ts
 * （只有 editor.api.d.ts 有声明）。这里直接复用官方类型，省得在 strict 下报
 * "Could not find a declaration file for module"。
 *
 * 为什么是 edcore.main 而不是包根入口：见 src/lib/monaco.ts 顶部注释。
 */
declare module 'monaco-editor/esm/vs/editor/edcore.main.js' {
  export * from 'monaco-editor'
}
