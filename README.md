# 侧栏代码引用搜索工具（dsh-sidebar-editor）

在 DSH 右侧栏的文档面板里**彩色预览工作区代码文件**，并把**选中的行一键引用到对话框**。
可编辑与保存的能力仍在 bundle 里，但**默认关闭**（原因见下方「面板的形态：预览优先」）。

这是一个 DSH 插件 bundle（`@local/dsh-sidebar-editor`），**免构建**：客户端半边是纯 classic script，宿主半边只注册一条路由。

## 状态

预览、分类着色、行选、引用、右键菜单（含剪切/复制/粘贴/全选）、大文件降级、以及宿主保存路由**都已实现**；
其中编辑器与保存默认不启用。离线自检 `node E:\DSH\_tools\selfcheck-sidebar-editor.js` 覆盖 **300 项断言**（客户端）+ **29 项断言**（宿主路由），
包含后缀覆盖契约、hook 顺序纪律、着色分类与注入防护、右键菜单、标准编辑项、三种引用形态、文件树行右键、拖选成范围、搜索面板、tab 条滚轮与自动揭露、
「出厂默认形态」、大文件降级边界、宿主路由的完整信封与全部失败码映射。

## 它做了什么

- 注册文档预览实现 `@local/dsh-sidebar-editor/code`，属于 `extension` 档。后缀的认领规则是：
  **内置「代码」渲染器认领的每一个后缀，我全都认领**，只排除被其他渲染器专门接管的那几个。
  因为 `extension` 档排在 `builtin` 之前，**这些文件打开时默认就是编辑器**；
  而内置「代码」渲染器仍然匹配同一个后缀，所以渲染器下拉里始终有它，随时可切回去看 Shiki 高亮。
  这条规则同时保证了两件事：任何原本以只读代码视图打开的文件都不会"没有编辑器"，
  且任何被我接管的文件都"有路可回"。
- 唯一的例外是刻意**不认领**其他内置渲染器已占用的后缀：`md`/`markdown`（Markdown 预览）、
  `html`/`htm`（沙箱 HTML 预览）、`svg` 与位图（图片）、`pdf`、`xlsx`/`xls`/`csv`/`tsv`（表格）、
  Office 文档 —— 认领它们会把这些文件的默认预览从用户手里抢走。
- 另外额外认领了十几个内置表里没有的文本后缀（`txt`、`astro`、`json5`、`sass`、`.gitignore`、
  `.editorconfig`、`.npmrc`、`Cargo.lock` …）。这些文件我是唯一候选，所以**没有渲染器下拉**，
  只能靠面板里的「只读」开关切换视图。自检里有一条断言把"超出内置表的后缀"限制在 20 个以内。
- 宿主半边注册一条精确 Fetch 路由 `POST /api/sidebarEditor/save`。
- 面板里没有任何 DSH 客户端包的 import：编辑器、行号槽、轻量高亮、地址解析全部自带，
  颜色只用 `--dsw-alias-*` 与 `--shiki-token-*` 主题 token。

### 面板能做什么

| 能力 | 说明 |
|---|---|
| 预览 | 自带分类着色（注释 / 字符串 / 数字与字面量 / 关键字 / 函数名与定义 / 装饰器与类名 / 属性 / 标点 / markup 标签与属性），按行渲染，可点选行 |
| 选行 | 点一行选中、`Shift+点击` 扩选，**鼠标拖选任意多行**也直接成为引用范围；`已选 L5-L9` 实时显示 |
| 右键 | 面板内的右键菜单是插件自绘的，除三种引用外还带 **剪切 / 复制 / 粘贴 / 全选**（预览形态只保留引用与「复制」）；右键某行会先把该行选为范围 |
| 引用选中行 | 把 `@路径 L10-L20` 插入到对话输入框 |
| 引用整个文件 | 工具条按钮与菜单项，插 `@路径`（不带行号） |
| 引用所在目录 | 菜单项，插 `@目录/`（带尾斜杠）；文件就在工作区根目录时该项不出现 |
| **文件树右键** | 直接在最右侧**文件树的行**上右键 → 「引用整个文件」/「引用这个目录」，外加「复制绝对路径」。不要求先打开面板 |
| **文件面板搜索框** | 文件树的工具栏里（路径栏那一排的**最左**）多一个搜索框：输入即按名字匹配工作区文件（**文件与文件夹都匹配**），结果浮层列出「名字 + 所在目录」。点**文件**结果 → **先在文件树里展开到它、滚动进视野、高亮那一行，然后才打开该文件**；点**文件夹**结果 → 不打开任何东西，只在树里展开定位并高亮（已经展开的不再收起）。Esc 或点外面收起 |
| **文件内查找** | 打开文件后，工具条上的「查找」按钮（面板有焦点时 Ctrl+F）：在当前文件内按行匹配、命中行加底色、1/N 行 计数、↑↓/Enter 逐个跳（到头回绕），跳到的行同时成为选中行，可直接引用 |
| **搜索快捷键** | `Ctrl/Cmd+Shift+P` 打开「文件」tab 并聚焦搜索框（命令 `sidebarEditor.filesearch`）。键位在**设置 → 快捷键**（或 `Mod+/`）里改、清除、恢复默认，插件不持有键位副本 |
| **条带滚动** | 右侧边栏 tab 开多了时：滚轮停在 tab 条上即左右滚动；新激活的 tab 会自动滚进视野（原来它只会停在视野外） |
| 大文件 | 超过 4000 行时关闭着色只出纯文本，并在工具条上说明；行仍然可选可引用 |
| 字号 | 工具条右侧的 `A− / A+` 步进器调**代码字号**，10–22px，默认 13px，选择会被记住 |
| 编辑（默认关闭） | `<textarea>` + 行号槽，关闭软换行（保证行号与内容严格对齐），支持横向滚动 |
| 保存（随编辑，默认关闭） | 把缓冲区写回磁盘，带版本守卫；冲突时挂横幅提供「重新载入」与「强制覆盖」 |
| 守卫（随编辑，默认关闭） | 文件未完全载入或超过 512 KiB / 20000 行时自动转只读，并说明原因 |

### 面板的形态：预览优先

**默认形态是「预览 + 引用」**，编辑与保存藏在 bundle 里由开关控制（`client.js` 里的 `editingEnabled()`）。
理由有两条，第一条是实测的：

- **受控 `<textarea>` 会毁掉浏览器自己的撤销栈。** 这个面板每次输入都把 `value` 写回控件
  （React 受控输入），而程序化写 `value` 会清空原生 undo 历史 —— 于是 Ctrl+Z 什么都不做。
  要修就得自己维护快照撤销栈（编辑/粘贴/剪切都要接入，并处理合并与光标位置），
  等于在侧栏里重造半个编辑器。
- **侧栏本来就不是写代码的地方。** 它窄、没有项目级跳转与索引，真正的编辑应该发生在 IDE 里；
  在侧栏里"能改"反而制造了"改完要记得保存、还要处理冲突"的负担。

想把它变回可编辑面板，只需让 `editingEnabled()` 返回 `true`：编辑器、保存路由、冲突横幅、
版本守卫全都还在，自检里也一直有覆盖（测试通过一个宿主侧全局量切换两种形态，两种都跑）。

面板**右上方仍然是「引用选中行」按钮**；`保存` 与 `编辑/只读` 开关在默认形态下不出现。

### 文件树右键是怎么做到的（没有行级席位）

文件树**没有**给插件留行级席位，也没有自己的右键菜单（它的文档写着"只有列目录……没有搜索、
拖拽、重命名、右键菜单"），所以"在树上右键引用"看起来是做不到的。但它暴露了两样东西：

```js
// 每个行元素上
<li data-files-entry="file|directory" data-files-path="E:\DSH/src/app.ts">
// 滚动容器上
<div data-files-root="E:\DSH" data-files-state="tree">
```

于是插件可以**只读**地使用这个契约：在 `document` 上监听 `contextmenu`，用
`event.target.closest('[data-files-entry]')` 认出是哪一行，取 `data-files-path` 减去
`data-files-root` 得到工作区相对路径 —— 全程不写树自己的 DOM，也不依赖它的内部组件。

菜单由注册进 **`conversation.composer.dock`** 的伴生组件渲染（`{kind:"list", scope:"session"}`，
所以 `inputActions` 会照常送达），并用 `ReactDOM.createPortal` 挂到 `document.body`，
以免 composer 的某个祖先把它裁掉或改变定位基准。面板与它共用同一份样式表 ——
样式表因此改成插件级注入（`document.head`），不再由面板组件自己渲染，
否则"没打开任何面板就右键文件树"时菜单会没有样式。

代价说清楚：在这棵树上右键**会顶掉浏览器的原生菜单**（不然两个菜单叠在一起），
所以插件补了「复制绝对路径」（按根自己的分隔符拼：Windows 给 `E:\DSH\src\app.ts`，POSIX 保持正斜杠）。这与面板内的取舍一致 —— 压掉什么就补上什么。

### 搜索：为什么最后没有用官方的 `fileReferences`

第一版搜索走的是输入框 `@` 补全用的那条接缝（`remote.fileReferences.list`），在你这台机器上
**什么都搜不到**。原因写在官方包里：那条 seam 本身不拥有文件系统访问，**没有挂载提供方时
UI 只能得到空的列表**；浏览器侧还要经 Session Controller 适配器**先解析 Agent**（第一参数的
语义是 agent 的工作目录）。它返回的空列表和"没有匹配"长得一模一样，所以第一版看起来只是"没结果"。

于是搜索改成**由本插件自己的宿主半边遍历工作区**：

- `fs.listDir` 逐层走（这条 seam 明确不提供递归/glob），始终在沙箱围栏给出的 `workspaceRoot`
  之内，**不读文件内容**；
- 固定上限：跳过 `node_modules/.git/dist/build/.venv/__pycache__` 等依赖与构建目录，
  深度 ≤ 12、文件 ≤ 20000、单文件内容 ≤ 512 KiB、每文件 ≤ 3 处、总数 ≤ 200；
- 内容搜索用 `fs.readText` 过滤 —— 它对二进制、超限、不可读文件返回 `null` 而不是抛错，
  正好就是这里需要的过滤器；
- 列表按 root 缓存 15 秒，面板重开是瞬时的。

代价要写清楚：这条遍历**不认识 `.gitignore`**（用固定跳过表代替），也不做模糊评分
（只在客户端按"命中文件名优先于命中父目录"排序）。若以后要忽略规则感知，正路是让
`fileReferences` 的提供方在本机生效，再把面板切回去。

### 定位为什么要排在打开之前

右侧边栏是**单列**的：`ctx.sidebarRight.openResource()` 会把资源的文档 tab **揭到前面**
（`placeResource` 的注释原话是 "claim it, place it, reveal the column"），「文件」tab 随之退到后台、
**本插件的搜索框组件被卸载**。第一版把"打开"放在"定位"之前，症状是实测出来的：

- 树在没人看的时候被展开，你切回「文件」tab 只看到一棵已经展开的树，不知道它为什么展开；
- 提示语浮层挂在搜索框组件上，组件一卸载就没了 —— 所以**连"哪一步失败了"都看不到**。

打开也因此**不能和写提示语挤在同一个 tick**：`setNote` 之后立刻 `openResource`，React 还没绘制，
组件就被卸载了。所以文件打开要延后 `NOTE_READ_MS`（900ms），让你先读到结果。

### 根那一级没有行（定位曾经 100% 失败的原因）

`revealInFileTree` 一开始沿祖先往下走，第一件事是找**根那一行**：

```js
let current = base;                                  // 'E:\DSH'
const parent = treeRowOf(root, current);             // 真实树里 → undefined
if (parent === undefined) return { ok:false, reason:'no-row:' + current };
```

但真实 DOM 里**根不是一行**（`dsh-client-ui-sidebar-files` 的 `FilesBody`）：

```jsx
<div data-files-state="tree" data-files-root={state.root}>   // ← 没有 data-files-path
  <div class="header">
    <PathLabel data-files-path={true} />        // 标题标签，值是字符串 "true"
    <button data-files-reload />
    {renderSlot("sidebar.right.tab.files.actions")}
  </div>
  <div data-files-body><ul class="level"><Level path={state.root} /></ul></div>
</div>
```

所以每一级都还没开始就返回 `no-row:E:\DSH` —— 定位从来没有成功过，跟路径、文件类型都无关。
根那一级的子项在面板挂载时就列出来了，**也没有 toggle 可按**，所以现在第一段直接
`waitForTreeRow` 等它出现，不再经过祖先行。

**这个 bug 在自检里躲了很久**，因为假树把根也当成了一行（`rendered` 里含 `'E:\\DSH'`），
和真实 DOM 不一致 —— 就是那段 `KNOWN RED … fake tree has not yet been made to agree with the walk`
注释在说的事。现在假树的 `reset()` / `expandAll()` 都**不再渲染根那一行**。验证方式：把上面那段分支
删掉再跑自检，8 条断言会失败，其中一条正是
`no-row:E:\DSH`（`DSH_SELFTEST_BUNDLE` 可以把自检指向改坏的副本，见"离线自检"）。

高亮还要扛住重挂：`data-se-tree-hit` 是打在**别的包拥有的**树行上的属性，而那棵树切换 tab 回来时
会把行重新渲染一遍，属性不继承。所以落点路径由 `rememberLocatedRow()` 记住，再用一个
`MutationObserver`（只看 `childList`，不看属性，避免自己写的属性把观察器喂回自己）在那一行重新
出现时把高亮补回去。展开状态本来就存在树自己的 tab store 里，因此补高亮不需要重走一遍。

### 入口、模式与快捷键

搜索只有一个入口：**文件面板工具栏**里那个搜索框，挂在官方留的
`sidebar.right.tab.files.actions` 子席位（路径栏那一排）。它用 `order:-1` 排在那一排的**最左**
（`Woyo-G_header` 是 `display:flex`，路径栏靠 `flex:1` 把工具推到右边），结果用 portal 浮层列出，
**只按文件名匹配**。

> **已删除：搜索页 tab 与内容模式。** 早期版本另有一个占满整格的「搜索页」页类型 tab
> （`sidebarRightTabs.register` + guide 入口）和「文件名 / 内容」两种模式。产物里已经没有它们，
> 自检那条 `'the page-type tab stays gone'` 断言就是钉这件事的。宿主的
> `/api/sidebarEditor/search` 仍然实现 `mode:'content'`（`index.js` 的 `searchWorkspaceContent`），
> 但**客户端没有任何一处调用它** —— 想恢复内容搜索，缺的是 UI，不是路由。

**快捷键由平台管，不由本插件管。** 命令 `sidebarEditor.filesearch` 注册进 DSH 自己的
`shortcuts` 服务，带一套默认键：桌面 `Ctrl/Cmd+Shift+P`，Web 再加 `Alt`（浏览器把 `Ctrl+P`
留给打印）。运行时不冲突 —— 只有官方文件树用 `KeyP`（`Mod+P` 与 Web 的 `Mod+Alt+P`）。

- 按下去先**打开/聚焦「文件」tab**（`sidebarRight.openTabFromTarget('files', target)`），再轮询等
  搜索框挂载后 `focus()` + `select()`，所以是"一键开始输入"，不是"打开一个面板"；
- 会话没解析出来时命令**不执行**，原因交给快捷键面板显示（`search.commandNoSession`）；
- **改键 / 清除 / 恢复默认都在「设置 → 快捷键」或 `Mod+/`**：Web 写 `dsh.keybindings.v1`，
  桌面写 `userData/keybindings.json`。插件**不保存任何键位副本**，所以不会出现"设置改了但插件还用
  旧键"这种分叉；冲突的组合由那个面板直接拒绝。
- 因此 `dsh.client.inject` 里多了一个 `@deepseek-ai/dsh-client-shortcuts`，`ctx.inject` 也多了
  一组 `['shortcuts', 'sidebarRight']` —— 服务必须点名才拿得到，见下面踩坑一。

正文的 props 里没有 `inputActions` 就不显示「引用」按钮 —— 那个按钮只有在会话级属性真的送到
这个席位时才有意义，所以是运行时探测而不是硬依赖。

**踩过的坑一：服务必须写进 `inject`。** 第一版把这个注册块放在
`ctx.inject(['remote.fileReferences', 'sidebarRight'], …)` 里，却在回调中调用
`scope.sidebarRightTabs.register` —— Cordis 按 `inject` 门控服务，没列出的服务在回调里是
`undefined`，于是 `.register` 抛 `TypeError`，**tab 类型根本没注册**，而插件其余部分照常工作，
界面上只表现为"搜索框不存在"。harness 当时无条件暴露所有服务，所以没拦住；现在它会按 `inject`
门控（点号依赖放行其命名空间，例如 `remote.fileReferences` 放行 `remote`），把 `inject` 改回
出错的版本就能立刻复现那句 `TypeError`。

**踩过的坑二：同一个 bundle 里只能有一个 `fetch` 桩。** 加了搜索路由之后，harness 里原本给
保存路由用的 `fetch` 桩写在我新桩的后面，把我的覆盖掉了 —— 表现是"面板状态正常但请求数为 0"。
两个桩现在合成一个，按 URL 分流。


### 让 tab 条能被滚轮左右滚

右侧边栏的 tab 条**本来就可以横向滚动**（`overflow-x:auto`），但：

- 滚动条是**故意藏起来**的（`scrollbar-width:none` 加一条 `::-webkit-scrollbar{display:none}`）；
- 这个构建里**没有任何 JS 管理它的滚动** —— 我把整份归档（8276 个文本条目）扫了一遍，
  `data-dockkit-strip-scroll` 只出现在 CSS 里、JS 里一次都没有，那套渐隐提示其实是死代码；
- 浏览器只在按住 `Shift` 滚轮或触控板横向滑动时才把纵向滚动映射成横向。

于是鼠标用户实际上够不到跑出视野的 tab，更糟的是**新开的 tab 没人帮它滚进视野**（`scrollLeft` /
`scrollIntoView` 在归档里与条带无关）。

**没有加可见滚动条**：条带容器只有 28px 高（`.tabStrip{height:28px}`），
`scrollbar-width:thin` 会吃掉约 8px 并把 tab 胶囊裁掉 —— 所以改用滚轮映射：

- 原生 `wheel` 监听装在 `document` 的**捕获阶段**且 `passive:false`。必须原生：React 的
  `onWheel` 是被动的，写成 prop 的话 `preventDefault()` 不生效，边栏会跟着一起纵向滚。
- 命中判定用 `[data-dockkit-strip-tabs]`（条带滚动容器的稳定属性，取自 shell 的 JSX），
  不看哈希类名。
- 横向滚轮 / `Ctrl+滚轮`(缩放) / 已经滚到头 / 没有溢出 —— 这四种一律**把事件交还**给页面，
  不抢别人的滚动。
- 另外用 `MutationObserver`（`attributeFilter:['aria-selected']`）盯住激活变化，
  让当前 tab 以 `inline:"nearest", block:"nearest"` 滚进视野 —— 只横向动，不牵动纵向。

### 拖选多行也会成为引用范围

只读视图里最自然的手势是**用鼠标拖选**若干行，但那产生的是浏览器自己的 DOM 选区，
不是点击 —— 最初只实现了"点一行 / Shift+点击扩选"，拖完之后 `已选` 还停在**上一次点击的那一行**，
引用出来就是 `L4` 而不是 `L2-L4`。修法是把 DOM 选区读回来：

- 每一行带 `data-se-line`（这个属性只属于本面板，所以别处的选区不会被误认）；
- 鼠标抬起（`mouseup`）或键盘选区结束（`keyup`）时，用选区的起止节点映射成行号区间，取小者为 start；
- **点击会紧跟在拖选之后到达**，所以点击处理里先问一次选区：多行选区优先，
  否则才按点击的那一行选 —— 这条次序正是"范围被缩成一行"的根源。

### 为什么要自己做一个字号步进器

平台**有**字号设置（设置 →「通用」→ 正文字号，10–22 px，默认 14 px），
但 `dsh-client-ui-theme` 的文档写明它只调整正文与低一档的流内文本，
**「小号文本和代码保持固定字号」** —— 所以调那个设置，面板里的代码不会变。代码要变大变小只能在面板里调。

实现要点：字号与行高是一对 CSS 变量（`--dsh-se-size` / `--dsh-se-line`），
**行号槽、编辑区、只读行三者共用同一个行高**，否则数字会和文字错位；
行高由字号按固定比例算出（13px → 21px）。选择存在 `localStorage`（键
`dsh-sidebar-editor.code-font-size`），在禁止存储的文档里会退化为"本次挂载内有效"而不是报错。
自检里有一条断言专门盯这个耦合：把行高钉死成常量后，它会立刻失败。

### 关于文件树搜索（本插件不做，但值得记下来）

右侧文件树**故意没有搜索**，这不是缺失而是设计：`dsh-client-ui-sidebar-files` 的文档直说
「**只有列目录。**没有搜索、产物过滤、拖拽、重命名、右键菜单或当前文件高亮。」插件库里也没有任何插件补上它。

平台真正提供"按名字找文件"的地方是**输入框**：敲 `@` 会打开文件引用补全菜单，
支持边打边过滤、键盘选择、逐级下钻（`dsh-client-ui-input-trigger`），选中即插入引用。
本插件的「引用选中行」走的是同一条插入路径，所以两者可以混用。

如果确实想要一个可搜索的文件面板，**技术上可行**：插件可以注册自己的右侧 tab 类型与正文
（`ctx.sidebarRightTabs.register({ id, kind, … })` + `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id })`），
随包发布的引导页走的正是这条公开路径。那是一个新功能（需要自己的文件列举与过滤），本插件目前不做。

## 引用是怎么实现的（重要）

DSH 的 `@` 引用语法**没有行号**：只有 `@path` / `@"path with spaces"` / `@dir/`，
而且引用只是提示词文本，发送时不展开、也不附带文件内容。

所以本插件插入的是**一个纯文本引用 token**：`@src/app.ts L10-L20`。

三种引用对应语法的三种形态：

| 动作 | 插入的文本 | 语法形态 |
|---|---|---|
| 引用选中行 | `@src/app.ts L10-L20` | `@path` + 纯文本行号 |
| 引用整个文件 | `@src/app.ts` | `@path` |
| 引用所在目录 | `@src/` | `@dir/`（尾斜杠是语法的一部分） |

含空格的路径会加引号，**目录的尾斜杠放在引号里面**（`@"my dir/deep/"`）——
这一点是本插件自己推的（目录行的序列化形式只规定"带尾斜杠的 `@dir/` mention"），
如果哪天发现 DSH 实际要求 `@"my dir/deep"/`，改一行即可。

- `@src/app.ts` 会被输入框重新扫描成 DSH 原生的引用 token（有 hover / 点击预览），
  紧跟在后面的 `L10-L20` 是普通文本；模型能直接读懂这一行。
- **没有走"引用 chip"那条路**，这是刻意的：发送时每个 chip 的文本会用它自己的 `ref`
  经 source codec 重新序列化（`serialize: ref => ref`），挂在 chip 上的行号**永远到不了模型**。
  证据：`dsh-client-ui-conversation` 的 `sinkSerialized` 用
  `inputTriggers.serializeReference(o.source, o.ref)` 重建文本。

插入走的是会话作用域插槽的文档化标准 prop `inputActions`：
`captureInsertion()` 取当前光标 span → `insertText(text, span)` 插入。
该 prop 由 `ctx.uiSession.provide({ props: ['inputActions'] })` 物化进每个 session 作用域插槽
（不是某个 inject face），与 `conversation.composer.bar` 拿到的是同一个来源。

如果该 prop 不存在，退化路径只在草稿为空时通过常驻输入机
`conversation.input.shell(sessionId).setDraft()` 追加；草稿非空时拒绝执行并报错，
避免把已有的 chip 冲掉。

## 保存是怎么实现的

```
浏览器                                    宿主
fetch('api/sidebarEditor/save')  ──►  POST /api/sidebarEditor/save
{ absolutePath, text, version }        connection.admit(request)   ← Host/Origin 围栏
                                        + 浏览器会话签名 cookie      ← 未认证 401 / 未信任 403
                                       ctx.fs.resolve(absolutePath)
                                       ctx.fs.writeText(target, text,
                                         { kind: 'replaceIfVersion', version })
                                       ← FS_SANDBOX_DENIED 403 / FS_STALE_VERSION 409
```

要点：

- **路由在 `/api` 前缀下**，所以自动被 `connection.admit()` 的围栏与浏览器会话 cookie 认证包住，
  和官方包 `dsh-client-ui-deliverables` 的 `/api/changes.diff` 走同一条路。
- **浏览器侧 URL 必须写成去掉前导斜杠的相对形式**（`api/...`）：桌面端用 `file://` 加载壳、
  经 IPC 桥接 fetch，带前导斜杠会指到文件系统根。官方包的客户端半边正是这么转换的。
- **写入必须带上会话身份，否则一定被拒**。这是实测踩到的坑：沙箱的 per-call 策略是
  `ctx.sandboxPolicy.resolve()`，不带会话时工作区根回落到部署默认的 `process.cwd()`
  ——也就是宿主进程的启动目录，而不是 `E:\DSH`。于是哪怕文件就在会话工作区里，
  写入也会因为"不在此根之下"被判 `FS_SANDBOX_DENIED`。
  修法是客户端把 `sessionId`（从资源地址里解析出来的）一起发上来，宿主用
  `ctx.sessions.get(sessionId).header.cwd` + `ctx.sandboxPolicy.resolve({ session })`
  得到**该会话的**模式与工作区根，再作为 per-call 策略传给 `writeText`。
  这条链路与官方 `dsh-api-workspace-files` 的 `workspaceFileScope` 解析器完全一致。
  副作用是**正确的**：会话被切成只读模式时会返回独立的 `read-only-mode`，而不是笼统的沙箱拒绝。
- **版本守卫是双保险**：`replaceIfVersion` 既满足"覆盖前必须先读过文件"的观察前置条件
  （否则 `FS_NOT_OBSERVED`），又提供乐观并发——文件在读取之后被改过就抛 `FS_STALE_VERSION`。
- **沙箱兜底**：`workspace-write` 下只有该会话工作区根（与临时目录）之内能写，
  越界是**直接失败**并回传实际使用的可写根，而不是弹窗要权限。
- **不会被自己的读回滚**：保存成功后，如果共享读取器还在送保存前的那一份内容，
  adopt 逻辑靠"我们刚覆盖掉的那段旧文本"把它识别出来并跳过，避免刚保存的内容在缓冲区里被回滚。
  磁盘版本变化有三种表现：缓冲区干净 → 静默跟随；缓冲区有未保存改动 → 冲突横幅（重新载入 / 强制覆盖）；
  两者都不满足时（读取器还没追上我们的写入）→ 什么都不做。

### 保存失败时横幅在说什么

宿主返回的是**稳定错误码**，客户端只按码分支，所以每条文案都对应一个确定的原因：

| 横幅 | 含义 | 该往哪查 |
|---|---|---|
| 该路径不在可写工作区内…当前可写根：`X` | 围栏用的根是 `X`，目标不在其下 | 看 `X` 是不是本会话工作区 |
| …（**未能解析会话**，按部署默认根判定） | `sessions.get(sessionId)` 没拿到会话，只能回落到部署默认根 | 检查客户端发上来的 `sessionId` 与宿主会话 id 是否一致 |
| 当前会话处于只读模式 | 会话被切成只读，写入被有意拒绝 | 切回可写模式 |
| 宿主保存路由未注册（HTTP 404） | 宿主半边没挂上，路由根本不存在 | 重启应用让宿主模块重新加载 |
| 文件在磁盘上已被改动 | 乐观并发拦下了这次覆盖 | 「重新载入」或「强制覆盖」 |
| 覆盖前必须先读取该文件 | 缺少读取前置条件（`FS_NOT_OBSERVED`） | 先载入完整文件再保存 |

宿主半边把操作实现为**一个函数** `saveWorkspaceFile(ctx, input, signal)`，路由调用它；
将来要加 agent 工具时调用同一个函数即可（符合插件规范里"一个操作、两个调用者"）。

## 安装

第一次安装需要在 GUI 里操作一次（插件安装要跑 pnpm 并改 profile 清单）：

1. 打开发送侧边栏的**插件**页。
2. 点「添加插件」，填入这个绝对路径：

   ```
   E:\DSH\plugins\dsh-sidebar-editor
   ```

3. 点安装。装完 bundle 的**客户端半边会立即生效**（无需重启，实测如此）。
4. **改了宿主半边（`index.js`）之后需要重启一次 DSH** —— 宿主模块不进客户端 HMR，
   详见下面「实测过的热更边界」。只改 `client.js` 不必重启，也不必重新安装。
5. 装好后可在**设置 → 内置插件 → 插件列表**里看到 `sidebar-editor` 行。

## 验收清单

1. 用右侧栏文件树打开 `E:\DSH` 里任意 `.ts` / `.py` / `.json` 文件
   → 顶部出现「编辑 / 只读」「保存」「引用选中行」，渲染器下拉里同时有「编辑器」和「代码」。
2. 选中第 10–20 行 → 点「引用选中行」→ 输入框出现 `@文件 L10-L20`，`@文件` 可点击预览。
3. 在编辑器里右键 → 弹出插件自绘的菜单 → 点「引用选中行」效果与工具条按钮一致。
4. 切到「只读」→ 观察分类着色（关键字 / 字符串 / 数字 / 函数名 / 装饰器 / 类名 / 标点各自成色）；
   点第 5 行、`Shift+点击`第 9 行 → 显示 `已选 L5-L9`；在某一行上右键可直接设为引用范围。
5. 改一行内容 → 「保存」变为可用 → 点保存 → 文件在磁盘上真的变了，横幅显示「已保存」。
   保存被拒时看横幅里的**可写根**：写往会话工作区根之外是设计如此，不是 bug。
6. 保存后让 agent 改同一个文件，再回到面板改一行 → 出现冲突横幅
   → 「重新载入」取磁盘版本，「强制覆盖」把自己的版本写上去。
7. 打开 `.md` 或 `.png` → 仍是内置 Markdown / 图片预览（没有被抢走）。
8. 把会话权限切成只读，再改一行保存 → 横幅应显示「当前会话处于只读模式」，而不是笼统的沙箱拒绝。
9. 打开右侧「文件」面板 → 搜索框在工具栏**最左**（路径栏 `E:\DSH` 之前）→ 输入某文件名 → 点结果
   → **先看到文件树展开到那一行并高亮**（提示语「已打开并在文件树中定位到 …」，停留约 0.9s），
   紧接着文件被打开、右栏切到该文档；再切回「文件」tab，**那一行仍然是高亮的**（属性扛住了重挂）。
   输入某文件夹名 → 点结果 → 不打开任何文件，右栏留在「文件」tab，树展开定位并高亮，
   提示语是「已在文件树中定位到 …」。
   把「文件」面板关掉（或树不在屏幕上）再点一次文件结果 → 文件立刻打开，
   提示语变成「没有打开文件树：请在右侧打开「文件」面板后再试」。
10. 按 `Ctrl+Shift+P` → 右栏切到「文件」tab 且搜索框获得焦点（已有内容被全选，可直接覆写）；
    打开**设置 → 快捷键**（或 `Mod+/`）→ 搜 `filesearch` 或「搜索工作区文件」→ 改成一个别的组合
    → 新组合立刻生效、旧组合失效；再「恢复默认」应回到 `Ctrl+Shift+P`。会话未选中时按这个键
    → 命令不执行，快捷键面板给出「请先选择会话」。

## 二次开发（实测过的热更边界）

- **客户端半边（`client.js`）改完即生效**：不需要重启，也不需要重新安装。
  `dsh-client-hmr` 的 node 半边按 500 ms 轮询 bundle 文件，改动会推一个新的 `rev`，
  浏览器随之取到新代码。实测：插件装进 profile 后，**在应用未重启的情况下**渲染器就已经接管了。
- **宿主半边（`index.js`）改动需要重启应用**。`dsh-hmr` 那一行的配置是 `root: []`，
  其注释写明「Profile configuration reloads by default; module roots are opt-in」——
  也就是说它监听 profile 配置，但不监听插件模块文件，所以改 `index.js` 不会重建宿主模块。
  （想让它热更，可以把插件目录加进 profile 里 `hmr.root`；那属于你自己的配置层，插件本身没改。）
- 离线自检：

  ```
  node E:\DSH\_tools\selfcheck-sidebar-editor.js
  ```

  它用 React 桩把 `client.js` 真正加载、`apply()`、挂载并渲染组件，并且用假的 `ctx.fs` /
  `ctx.sessions` / `ctx.sandboxPolicy` 跑通宿主半边的路由信封（会话围栏、只读模式拒绝、
  六种失败码映射、畸形与非 JSON 请求体、超限 413）。
  桩自己实现了 React 的 hook 顺序规则（顺序或数量变了就报错，并有一条断言证明这个守卫真的会触发），
  另外断言了只读高亮把文件内容当**文本**转义而不是当 HTML 插入。
- **变异测试**：`DSH_SELFTEST_BUNDLE=<副本路径>` 可以让自检指向一个改坏的副本，
  用来证明某条断言真的会因为缺了它守护的那段代码而失败，而不是恰好为真。
  例如把右键菜单的关闭守卫去掉后，自检会稳定报出 3 项失败；把编辑开关钉死成 `true`
  会报出 8 项。文件是 UTF-8 且含中文，用 PowerShell 读写副本时要显式指定 UTF-8，
  否则 `Get-Content` 会按本地代码页解码成乱码。
- **桩里必须有假宿主节点**：组件通过 `ref` 读 `value` / `selectionStart` / `selectionEnd`，
  桩如果不给 `ref` 一个节点，这些代码路径会**静默空转**，围绕它们的断言就全是假的。
  自检会给每个带 `ref` 的宿主元素绑一个跨渲染保持的假节点（值跟随受控 prop）。

### 为什么菜单要按「按下 → 点击」两段来测

真实浏览器里 `mousedown` 先于 `click`。菜单的关闭逻辑挂在 `document` 的 `mousedown` 上，
如果它不区分"按在菜单里面"，那么按下的那一瞬间菜单就被卸载了，
浏览器随后派发的 `click` 落在已移除的按钮上——菜单项看起来完全没反应。
这不是假想：第一版就是这样，而当时的测试直接调用 `props.onClick()`，
**跳过了事件序列**，所以一路全绿。修法是两层：关闭回调忽略来自 `.dsh-se-menu` 内部的事件，
菜单自身再 `preventDefault()` + `stopPropagation()`；测试改成先派发 document 的 `mousedown`
再触发点击，并在没有修复的副本上验证过它确实会失败。

### 为什么右键菜单里要自己做剪切/复制/粘贴

插件**没有**向应用自身右键菜单加项的接口（客户端各包文档里搜不到任何 context menu 服务或插槽），
而同时弹出两个菜单会叠在一起。所以 `preventDefault()` 只有在"我的菜单取代了被我压掉的那个"时才算诚实 ——
于是标准编辑项由插件自己实现：`navigator.clipboard` 优先，失败时回落到
`document.execCommand('copy')`；读取剪贴板可能被浏览器拒绝，那时会明确提示"请直接用 Ctrl+V"，
而不是静默失败。只读模式没有可编辑缓冲区，因此只留「引用」与「复制」。
- 沙箱围栏的真实性检查（直接驱动应用自带的实现，不用假代码）：

  ```
  node E:\DSH\_tools\fence-check-sidebar-editor.mjs
  ```

  它调用 `SandboxedFileSystem.prototype.checkedTarget` 与 `writableRoots` 本身，
  证明：会话根策略允许写会话工作区内、拒绝写其外；**部署根回落正是当初拒绝保存的原因**；
  只读会话拒绝一切写入；`danger-full-access` 不加围栏；前缀相似的兄弟目录不会被误判为在根之内。
  它需要 `E:\DSH\_dsh_src` 那棵解包出来的包树（用 `E:\DSH\_tools\asar.js` 生成）。
- **两种形态都在自检里**：bundle 里的 `editingEnabled()` 会读宿主侧全局量
  `__DSH_SIDEBAR_EDITOR_EDITING__`（应用里没有这个全局量，所以出厂就是预览形态）。
  自检把它设成 `true` 跑完整套编辑器/保存/冲突断言，再设回 `false` 断言出厂形态 ——
  因此"关闭编辑"不会让那半边代码失去覆盖。变异掉这个开关（让它恒为 `true`）会让 8 项断言失败。

## 卸载

在插件页把 `@local/dsh-sidebar-editor` 取消选择或卸载，然后重启。

## 已知限制

- 超过 4000 行的文件不出着色，只出纯文本（DOM 规模换响应速度）；行仍然可选可引用，工具条上有说明。
- 着色是单遍正则分词，不是语法分析：多行结构只对块注释与 Python 三引号字符串做了跨行延续，
  模板字符串、嵌套语言的着色可能不够精确。要精确着色可以随时切到内置「代码」渲染器（Shiki）。
- 编辑形态关闭软换行：为了行号严格对齐，长行横向滚动而不是折行。该形态默认不启用，
  且**没有撤销栈**（受控 `<textarea>` 会清空原生 undo 历史），重新启用前需要自己实现快照撤销。
- 面板内的操作行是插件自绘的（没有占用文档面板头部的 `sidebar.right.tab.document.action` 插槽），
  与宿主头部按钮的像素级一致度有限。
- 文件超过 512 KiB 或 20000 行转只读；未完全载入前也保持只读（避免保存时截断未读到的尾部）。
- 保存只对**会话工作区根之内**的文件生效（这就是沙箱的定义）。工作区外的文件仍可打开、
  可引用、可只读浏览，但保存会以「不在可写工作区内」失败并回传实际可写根。
- 一个 DSH 升级就失效的风险点：`inputActions` 与 `conversation.input` 属于客户端内部约定，
  后者甚至没写进 README；插件对两者都做了存在性检查并会显示明确错误，而不是静默失败。
  同理，宿主半边的会话围栏依赖 `ctx.sessions.get(id).header.cwd` 与
  `ctx.sandboxPolicy.resolve({ session })`，这两个都是官方读写路径在用的接口，但同样不在插件契约里。
