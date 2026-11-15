# html-allowlist-sanitizer

面向评论区富文本的防御型 HTML 白名单净化器。不依赖正则替换，而是用一个
贴近 HTML 标准的解析状态机（tokenizer）先做词法分析，再在令牌流上执行
白名单过滤、URL scheme 校验和嵌套修复，输出规范化、可重复的稳定 HTML。

## 用法

```js
const { sanitize } = require('./index');

const result = sanitize('<p onclick=alert(1)>hi</p><svg><script>x</script></svg>');

result.html;
// '<p>hi</p>'

result.removed;
// [
//   { category: 'event-handler', element: 'p', attribute: 'onclick', reason: '...' },
//   { category: 'namespace-escape', element: 'svg', reason: '...' },
// ]

result.categories;
// [ 'event-handler', 'namespace-escape' ]
```

可选参数：`allowedElements`、`allowedSchemes`、`maxDepth`（默认 100）。

```js
sanitize(html, { allowedSchemes: ['https'], allowedElements: ['p', 'b'] });
```

## 白名单

- **元素**：`a abbr b blockquote br caption cite code col colgroup dd del
  details dfn div dl dt em figcaption figure h1–h6 hr i img ins kbd li mark
  ol p pre q s samp small span strike strong sub summary sup table tbody td
  tfoot th thead time tr u ul var wbr`
- **全局属性**：`class title dir lang`
- **元素属性**：`a[href rel target]`、`img[src alt width height loading]`、
  `td/th[colspan rowspan scope]`、`ol[start type reversed]`、`li[value]`、
  `time[datetime]`、`del/ins[datetime cite]`、`blockquote/q[cite]`、
  `col/colgroup[span]`
- **URL scheme**（用于 `href`/`src`/`cite`）：`http https mailto tel`，
  以及相对 URL、`#fragment`、`//host` 协议相对 URL。`javascript:`、
  `data:`、`vbscript:` 等一律拒绝。
- **不白名单即拒绝**：`id`、`style`、`srcdoc`、`data-*`、`on*` 事件属性、
  `xmlns*` 命名空间声明默认全部移除。`target="_blank"` 会自动补
  `rel="noopener noreferrer"`。

## 风险类别（removed[].category）

- `active-content`：`script/style/iframe/template/object` 等连同内容删除
- `namespace-escape`：`svg/math/foreignObject/annotation-xml` 及 `xmlns*` 属性
- `event-handler`：`on*` 事件属性
- `unsafe-url-scheme`：URL scheme 不在白名单
- `disallowed-element` / `disallowed-attribute`：不在白名单的标签/属性
- `duplicate-attribute`：重复属性（保留第一个，与浏览器一致）
- `comment-injection`：注释及伪注释（含注释中的伪标签）
- `doctype-injection`：DOCTYPE 声明
- `structure-repair`：未闭合标签、隐式闭合、孤立结束标签、嵌套超限

## 与浏览器行为的差异（有意为之）

解析器尽量对齐 HTML 标准的容错顺序，但净化目标是**安全**而非像素级还原，
以下差异是有意设计：

- **SVG/MathML 默认整体禁止**。浏览器在 `foreignObject`、`annotation-xml`
  等集成点会切回 HTML 解析，形成命名空间逃逸面；本库不跟踪 foreign
  content 作用域，直接连同子树删除，不提供开启选项。
- **重复属性保留第一个**（与浏览器一致），但会记录 `duplicate-attribute`，
  因为属性走私（第一个 `href` 安全、第二个恶意，或反之）是常见绕过手段。
- **注释一律删除**，包括 `<!-->` 这类浏览器认可的"突变闭合"注释；`<?...>`、
  `<!foo>`、HTML 内容中的 `<![CDATA[` 按浏览器规则视为 bogus comment 并删除。
- **非 void 元素的自闭合标记被忽略**（如 `<div/>` 仍视为开始标签并压栈），
  与浏览器一致；但 `<svg/>` 这类 foreign 元素尊重自闭合，不会吞掉后续内容。
- **隐式闭合只实现安全子集**（`p/li/dt/dd/td/th/tr/thead/tbody/tfoot/a`）。
  浏览器还会自动插入 `<tbody>`、触发生成 adoption agency 等完整树构建
  算法，本库不做，输出结构可能与浏览器 DOM 不完全同构，但保证嵌套合法。
- **`</br>` 等孤立结束标签直接丢弃**；浏览器会把 `</br>` 改写成 `<br>`，
  本库不复制这个怪癖。
- **实体解码先于 scheme 校验**：`&#106;avascript:`、`java&Tab;script:`、
  嵌入制表符/换行/前导控制字符的 URL 在判定前按浏览器 URL 解析规则
  规范化。未知命名实体保持原样（浏览器亦然）。
- **`noscript` 内容一律删除**：浏览器在禁用脚本时才解析其内容，净化器
  无法预知运行环境，按最严格处理。
- **文本与属性值重新转义输出**（`& < > "`），因此同一输入重复净化结果
  完全一致（幂等），但实体写法会被规范化（如 `&copy;` 输出为字面 `©`）。

## 测试

```
node --test
```

测试全部使用合成 XSS 边界片段：实体/控制字符混淆的 `javascript:`、
重复属性顺序、`foreignObject` 逃逸、注释伪标签与突变闭合、嵌套破坏、
深度炸弹、大小写混淆等，并验证同一输入重复净化结果一致。
