import { createApp } from 'vue'
import { createPinia } from 'pinia'
import i18n from './i18n'
import App from './App.vue'

// 字体本地自足：原先是在 main.css / code-font.css 里 @import Google Fonts 的 CSS2 接口，
// 那样每个访客都要向 fonts.googleapis.com 发请求，内网/离线环境更是直接取不到字回落到兜底字体。
// 现在改由 @fontsource 随包打包 —— 字重与原来请求的保持一致，产物同源发布。
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'

import './styles/main.css'
import './styles/code-font.css'
import './styles/tab-context-menu.css'

declare const __SPEC_URL__: string
declare const __SPEC_NAME__: string

const urlParams = new URLSearchParams(location.search)

// 宿主配置：由服务端（如 .NET 的 UseDocUi 中间件）在 index.html 里注入
// <script id="docui-config" type="application/json">{"spec":"/openapi/v1.json"}</script>
// 没有该节点时返回空对象，独立部署行为不变
function readHostConfig(): { spec?: string; name?: string } {
  try {
    const el = document.getElementById('docui-config')
    return el?.textContent ? JSON.parse(el.textContent) : {}
  } catch {
    return {}
  }
}
const hostConfig = readHostConfig()

// 优先级：URL 参数 > 宿主注入 > 构建期 define > 同目录 swagger.json
const source = urlParams.get('spec') || urlParams.get('url') || hostConfig.spec
  || (typeof __SPEC_URL__ !== 'undefined' ? __SPEC_URL__ : 'swagger.json')
const specName = urlParams.get('name') || hostConfig.name
  || (typeof __SPEC_NAME__ !== 'undefined' ? __SPEC_NAME__ : '')

const app = createApp(App, { initialSource: source, specName })
app.use(createPinia())
app.use(i18n)
app.mount('#app')
