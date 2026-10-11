/**
 * Monaco 的「本地自足」加载入口 —— 按需进来时不碰任何外网。
 *
 * 【为什么要有这个文件】
 * 以前 CodeEditor.vue 是从 cdnjs.cloudflare.com 拉 Monaco 的 AMD loader：
 * 只要环境是内网隔离 / 出口被限制 / CDN 不可达，loader.js 就取不到，
 * 编辑器直接退化成纯文本框。这与本项目「可作为 .NET 类库资源内嵌、离线部署」
 * 的定位冲突 —— 服务端能跑，编辑器却部分残废。
 *
 * 现在 Monaco 由 npm 依赖提供，跟 dist/ 一起构建发布、同源加载，
 * 嵌进 .NET 时被 DLL 资源带走，整套链路不依赖任何外部域名。
 *
 * 【为什么走 edcore.main，而不是包根入口 'monaco-editor'】
 * 包根入口 = editor.main = 全部编辑器贡献 + **全部几十种语言**
 * (yaml / php / ruby / go / bat / lua …) + 全部语言服务 (ts / html / css worker)，
 * 打进产物体量爆炸，而本项目一个都用不到那些语言。
 * edcore.main = 编辑器 API + **全部编辑器贡献**（查找、折叠、右键菜单、命令面板 …），
 * 但**不含任何语言** —— 语言在下面按需补齐，多一个都不带。
 *
 * 【为什么不用 editor.api】
 * editor.api 只有裸 API，没有上面那些 contributions，编辑器会缺一大半交互能力。
 */
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main.js'

// ===== 语言：严格对齐 CodeEditor.vue 的 languageMap =====
// plaintext 是 Monaco 内置默认语言，无需引入；curl 复用了 shell。
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js'

// ===== JSON 单独处理：走「语言服务」而非 basic-languages =====
// 请求体编辑器要能做语法校验（红波浪线），这依赖 json worker；
// basic-languages 只给着色，不校验。
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js'

// ===== Worker =====
// Monaco 通过这个全局钩子决定各语言用哪个 worker。不设置的话它会尝试按自身路径
// 去捞 worker 文件，表现为一堆 404 + 丢失 JSON 校验。
// Vite 的 `?worker` 后缀会把它们打成同源产物，随 dist/ 一起发布。
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker'

;(self as any).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new JsonWorker()
    return new EditorWorker()
  },
}

export default monaco
