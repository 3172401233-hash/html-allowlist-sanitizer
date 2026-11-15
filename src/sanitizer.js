'use strict';

const { tokenize } = require('./tokenizer');

// ---------------------------------------------------------------------------
// Allowlists
// ---------------------------------------------------------------------------

const ALLOWED_ELEMENTS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col',
  'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i',
  'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp',
  'small', 'span', 'strike', 'strong', 'sub', 'summary', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var',
  'wbr',
]);

const GLOBAL_ATTRIBUTES = new Set(['class', 'title', 'dir', 'lang']);

const ELEMENT_ATTRIBUTES = {
  a: new Set(['href', 'rel', 'target']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  ol: new Set(['start', 'type', 'reversed']),
  li: new Set(['value']),
  time: new Set(['datetime']),
  del: new Set(['datetime', 'cite']),
  ins: new Set(['datetime', 'cite']),
  blockquote: new Set(['cite']),
  q: new Set(['cite']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
};

const URL_ATTRIBUTES = new Set(['href', 'src', 'cite']);

const DEFAULT_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

const VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'wbr', 'col']);

// Elements whose raw-text content must never be reinterpreted as markup.
// Browsers tokenize their contents as raw text, so we skip to the matching
// end tag exactly like a browser would.
const RAWTEXT_DROP = new Set([
  'script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed',
  'noframes', 'noscript', 'plaintext',
]);

// Elements dropped together with their parsed subtree. SVG and MathML are
// banned by default: they switch the parser into foreign-content mode where
// integration points (foreignObject, annotation-xml) let HTML breakout
// payloads execute.
const SUBTREE_DROP = new Set([
  'svg', 'math', 'foreignobject', 'annotation-xml', 'mglyph', 'malignmark',
  'template', 'object', 'applet',
]);

const NAMESPACE_ELEMENTS = new Set([
  'svg', 'math', 'foreignobject', 'annotation-xml', 'mglyph', 'malignmark',
]);

// Elements that implicitly close the currently open element when they start.
// This mirrors a safe subset of the HTML tree-construction rules.
const CLOSE_ON_START = {
  p: new Set(['p']),
  div: new Set(['p']),
  blockquote: new Set(['p']),
  pre: new Set(['p']),
  ul: new Set(['p']),
  ol: new Set(['p']),
  dl: new Set(['p']),
  table: new Set(['p']),
  figure: new Set(['p']),
  details: new Set(['p']),
  h1: new Set(['p']),
  h2: new Set(['p']),
  h3: new Set(['p']),
  h4: new Set(['p']),
  h5: new Set(['p']),
  h6: new Set(['p']),
  hr: new Set(['p']),
  li: new Set(['li', 'p']),
  dt: new Set(['dt', 'dd', 'p']),
  dd: new Set(['dt', 'dd', 'p']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th']),
  tr: new Set(['tr', 'td', 'th']),
  thead: new Set(['thead', 'tbody', 'tfoot', 'tr', 'td', 'th']),
  tbody: new Set(['thead', 'tbody', 'tfoot', 'tr', 'td', 'th']),
  tfoot: new Set(['thead', 'tbody', 'tfoot', 'tr', 'td', 'th']),
  a: new Set(['a']),
};

const DEFAULT_MAX_DEPTH = 100;

// ---------------------------------------------------------------------------
// Escaping / URL checks
// ---------------------------------------------------------------------------

function escapeText(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

// Attribute values are already entity-decoded by the tokenizer, so
// `&#106;avascript:` arrives here as literal text. Browsers additionally
// ignore tab/newline characters anywhere in a URL and strip leading C0
// controls and spaces, so we normalize the same way before matching the
// scheme. Anything with a scheme outside the allowlist is rejected;
// scheme-relative (`//host`) and relative URLs have no scheme and pass.
function isSafeUrl(rawValue, allowedSchemes) {
  const flattened = rawValue.replace(/[\t\n\r]/g, '');
  const trimmed = flattened.replace(/^[\x00-\x20]+/, '');
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!match) return true;
  return allowedSchemes.has(match[1].toLowerCase());
}

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

function sanitize(input, options) {
  if (typeof input !== 'string') {
    throw new TypeError('sanitize() expects a string');
  }
  const opts = options || {};
  const allowedElements = opts.allowedElements
    ? new Set(opts.allowedElements.map((n) => n.toLowerCase()))
    : ALLOWED_ELEMENTS;
  const allowedSchemes = opts.allowedSchemes
    ? new Set(opts.allowedSchemes.map((s) => s.toLowerCase()))
    : DEFAULT_SCHEMES;
  const maxDepth = Number.isInteger(opts.maxDepth) && opts.maxDepth > 0
    ? opts.maxDepth
    : DEFAULT_MAX_DEPTH;

  const tokens = tokenize(input);
  const out = [];
  const removed = [];
  const openStack = [];
  const ignoredStack = [];
  let skip = null;

  function report(category, detail) {
    removed.push(Object.assign({ category }, detail));
  }

  function closeTop(reason) {
    const name = openStack.pop();
    out.push('</' + name + '>');
    report('structure-repair', { element: name, reason });
  }

  for (const token of tokens) {
    if (skip) {
      if (skip.rawtext) {
        // Raw-text elements (script/style/...): the first matching end tag
        // closes them; anything before it is inert text in browsers too.
        if (token.type === 'endTag' && token.name === skip.name) skip = null;
        continue;
      }
      if (token.type === 'startTag' && token.name === skip.name && !token.selfClosing) {
        skip.depth++;
      } else if (token.type === 'endTag' && token.name === skip.name) {
        skip.depth--;
        if (skip.depth === 0) skip = null;
      }
      continue;
    }

    switch (token.type) {
      case 'text': {
        out.push(escapeText(token.value));
        break;
      }

      case 'comment': {
        const pseudoTag = /<\/?[a-zA-Z!]/.test(token.value);
        report('comment-injection', {
          reason: pseudoTag
            ? 'comment containing markup-like text removed'
            : 'comment removed',
          excerpt: token.value.slice(0, 80),
        });
        break;
      }

      case 'bogusComment': {
        report('comment-injection', {
          reason: 'bogus comment (<?...>, <!...> or <![CDATA[) removed',
          excerpt: token.value.slice(0, 80),
        });
        break;
      }

      case 'doctype': {
        report('doctype-injection', { reason: 'doctype declaration removed' });
        break;
      }

      case 'startTag': {
        const name = token.name;

        if (RAWTEXT_DROP.has(name)) {
          report('active-content', {
            element: name,
            reason: 'active-content element dropped with its contents',
          });
          // HTML elements ignore the self-closing flag: <script/> still
          // swallows everything up to </script> in a browser.
          skip = { name, rawtext: true };
          continue;
        }

        if (SUBTREE_DROP.has(name)) {
          report('namespace-escape', {
            element: name,
            reason: 'SVG/MathML or embedded-content element dropped with its subtree',
          });
          // Foreign elements (svg/math) honour self-closing syntax; HTML
          // elements like <template/> do not.
          const honorSelfClosing = NAMESPACE_ELEMENTS.has(name);
          if (!(honorSelfClosing && token.selfClosing)) {
            skip = { name, rawtext: false, depth: 1 };
          }
          continue;
        }

        if (!allowedElements.has(name)) {
          report('disallowed-element', {
            element: name,
            reason: 'element not in allowlist; tag removed, children kept',
          });
          ignoredStack.push(name);
          continue;
        }

        for (const dup of token.duplicates) {
          report('duplicate-attribute', {
            element: name,
            attribute: dup,
            reason: 'duplicate attribute dropped; first occurrence wins',
          });
        }

        const closers = CLOSE_ON_START[name];
        if (closers) {
          while (openStack.length > 0 && closers.has(openStack[openStack.length - 1])) {
            closeTop('implicitly closed by <' + name + '> start tag');
          }
        }

        if (openStack.length >= maxDepth) {
          report('structure-repair', {
            element: name,
            reason: 'nesting depth limit exceeded; tag removed, children kept',
          });
          ignoredStack.push(name);
          continue;
        }

        const elementAttrs = ELEMENT_ATTRIBUTES[name] || null;
        const keptAttrs = [];
        let targetBlank = false;
        let relIndex = -1;

        for (const [attrName, attrValue] of token.attrs) {
          if (attrName.startsWith('on') && attrName.length > 2) {
            report('event-handler', {
              element: name,
              attribute: attrName,
              reason: 'event handler attribute removed',
            });
            continue;
          }
          if (attrName === 'xmlns' || attrName.startsWith('xmlns:')) {
            report('namespace-escape', {
              element: name,
              attribute: attrName,
              reason: 'namespace declaration attribute removed',
            });
            continue;
          }
          if (attrName === 'srcdoc' || attrName === 'style') {
            report('disallowed-attribute', {
              element: name,
              attribute: attrName,
              reason: 'attribute capable of carrying active content removed',
            });
            continue;
          }
          const allowed =
            GLOBAL_ATTRIBUTES.has(attrName) ||
            (elementAttrs !== null && elementAttrs.has(attrName));
          if (!allowed) {
            report('disallowed-attribute', {
              element: name,
              attribute: attrName,
              reason: 'attribute not in allowlist',
            });
            continue;
          }
          if (URL_ATTRIBUTES.has(attrName) && !isSafeUrl(attrValue, allowedSchemes)) {
            report('unsafe-url-scheme', {
              element: name,
              attribute: attrName,
              reason: 'URL scheme not in allowlist',
            });
            continue;
          }
          if (name === 'a' && attrName === 'target' && attrValue === '_blank') {
            targetBlank = true;
          }
          if (name === 'a' && attrName === 'rel') {
            relIndex = keptAttrs.length;
          }
          keptAttrs.push([attrName, attrValue]);
        }

        // Reverse tabnabbing guard: target="_blank" always gets noopener.
        if (targetBlank) {
          if (relIndex === -1) {
            keptAttrs.push(['rel', 'noopener noreferrer']);
          } else {
            const tokens = new Set(keptAttrs[relIndex][1].toLowerCase().split(/\s+/));
            tokens.add('noopener');
            tokens.add('noreferrer');
            tokens.delete('');
            keptAttrs[relIndex][1] = [...tokens].sort().join(' ');
          }
        }

        let html = '<' + name;
        for (const [attrName, attrValue] of keptAttrs) {
          html += ' ' + attrName + '="' + escapeAttribute(attrValue) + '"';
        }
        html += '>';
        out.push(html);
        if (!VOID_ELEMENTS.has(name)) openStack.push(name);
        break;
      }

      case 'endTag': {
        const name = token.name;
        if (ignoredStack.length > 0 && ignoredStack[ignoredStack.length - 1] === name) {
          ignoredStack.pop();
          continue;
        }
        const idx = openStack.lastIndexOf(name);
        if (idx === -1) {
          report('structure-repair', {
            element: name,
            reason: 'unmatched end tag dropped',
          });
          continue;
        }
        while (openStack.length > idx) {
          const top = openStack[openStack.length - 1];
          if (top === name) {
            openStack.pop();
            out.push('</' + name + '>');
          } else {
            closeTop('implicitly closed by </' + name + '> end tag');
          }
        }
        break;
      }

      default:
        break;
    }
  }

  while (openStack.length > 0) {
    closeTop('unclosed tag closed at end of input');
  }

  const categories = [...new Set(removed.map((r) => r.category))].sort();
  return { html: out.join(''), removed, categories };
}

module.exports = {
  sanitize,
  ALLOWED_ELEMENTS,
  GLOBAL_ATTRIBUTES,
  ELEMENT_ATTRIBUTES,
  DEFAULT_SCHEMES,
};
