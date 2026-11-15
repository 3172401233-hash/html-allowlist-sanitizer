'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitize } = require('../index');

function categoriesOf(result) {
  return new Set(result.categories);
}

test('keeps ordinary allowlisted markup intact', () => {
  const { html, removed } = sanitize(
    '<p class="intro">Hi <b>there</b>, <a href="https://example.com/q?a=1&amp;b=2">link</a></p>'
  );
  assert.equal(
    html,
    '<p class="intro">Hi <b>there</b>, <a href="https://example.com/q?a=1&amp;b=2">link</a></p>'
  );
  assert.deepEqual(removed, []);
});

test('escapes text and never reinterprets entity-decoded markup', () => {
  const { html } = sanitize('<p>1 < 2 & 3 > 2</p><p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(
    html,
    '<p>1 &lt; 2 &amp; 3 &gt; 2</p><p>&lt;img src=x onerror=alert(1)&gt;</p>'
  );
});

test('drops script elements together with their contents', () => {
  const result = sanitize('<p>a</p><script>alert(1)</script><p>b</p>');
  assert.equal(result.html, '<p>a</p><p>b</p>');
  assert.ok(categoriesOf(result).has('active-content'));
  assert.equal(result.removed[0].element, 'script');
});

test('script raw text: inner tags stay inert until the first </script>', () => {
  const { html } = sanitize('<script><b>not markup</b></script><b>real</b>');
  assert.equal(html, '<b>real</b>');
});

test('uppercase tags and attributes are handled case-insensitively', () => {
  const result = sanitize('<SCRIPT>alert(1)</SCRIPT><IMG SRC=x ONERROR=alert(1)>');
  assert.equal(result.html, '<img src="x">');
  const cats = categoriesOf(result);
  assert.ok(cats.has('active-content'));
  assert.ok(cats.has('event-handler'));
});

test('removes event handler attributes in all quoting styles', () => {
  const result = sanitize(
    '<img src="x" onerror="alert(1)"><p onclick=alert(1)>a</p><span onload=\'x\'>b</span>'
  );
  assert.equal(result.html, '<img src="x"><p>a</p><span>b</span>');
  assert.equal(
    result.removed.filter((r) => r.category === 'event-handler').length,
    3
  );
});

test('blocks javascript: URLs, including entity and control-char obfuscation', () => {
  const cases = [
    '<a href="javascript:alert(1)">x</a>',
    '<a href="jAvAsCrIpT:alert(1)">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="&#x6A;avascript:alert(1)">x</a>',
    '<a href="java&#115;cript:alert(1)">x</a>',
    '<a href="java&Tab;script:alert(1)">x</a>',
    '<a href="jav&#x09;ascript:alert(1)">x</a>',
    '<a href="  javascript:alert(1)">x</a>',
    '<a href="&#x1F;javascript:alert(1)">x</a>',
    '<a href=javascript:alert(1)>x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  ];
  for (const input of cases) {
    const result = sanitize(input);
    assert.equal(result.html, '<a>x</a>', input);
    assert.ok(categoriesOf(result).has('unsafe-url-scheme'), input);
  }
});

test('blocks data: URLs in img src', () => {
  const result = sanitize('<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="p">');
  assert.equal(result.html, '<img alt="p">');
  assert.ok(categoriesOf(result).has('unsafe-url-scheme'));
});

test('allows safe schemes and relative URLs', () => {
  const inputs = [
    '<a href="https://example.com/">a</a>',
    '<a href="http://example.com/">a</a>',
    '<a href="mailto:user@example.com">a</a>',
    '<a href="tel:+8613800000000">a</a>',
    '<a href="/relative/path">a</a>',
    '<a href="#fragment">a</a>',
    '<a href="//example.com/protocol-relative">a</a>',
    '<a href="../up">a</a>',
  ];
  for (const input of inputs) {
    const result = sanitize(input);
    assert.equal(result.html, input, input);
    assert.deepEqual(result.removed, [], input);
  }
});

test('duplicate attributes: first occurrence wins (browser order)', () => {
  const evilFirst = sanitize('<a href="javascript:alert(1)" href="https://safe.example/">x</a>');
  assert.equal(evilFirst.html, '<a>x</a>');
  assert.ok(categoriesOf(evilFirst).has('duplicate-attribute'));
  assert.ok(categoriesOf(evilFirst).has('unsafe-url-scheme'));

  const safeFirst = sanitize('<a href="https://safe.example/" href="javascript:alert(1)">x</a>');
  assert.equal(safeFirst.html, '<a href="https://safe.example/">x</a>');
  assert.ok(categoriesOf(safeFirst).has('duplicate-attribute'));
  assert.ok(!categoriesOf(safeFirst).has('unsafe-url-scheme'));
});

test('drops SVG and MathML namespaces with their whole subtree', () => {
  const result = sanitize(
    '<p>ok</p><svg><script>alert(1)</script><circle onload="alert(1)"/></svg>' +
      '<math><mtext><img src=x onerror=alert(1)></mtext></math><p>done</p>'
  );
  assert.equal(result.html, '<p>ok</p><p>done</p>');
  assert.ok(categoriesOf(result).has('namespace-escape'));
});

test('foreignObject breakout is dropped with contents', () => {
  const result = sanitize(
    '<svg><foreignObject><img src=x onerror=alert(1)><p>hi</p></foreignObject></svg>'
  );
  assert.equal(result.html, '');
  assert.ok(categoriesOf(result).has('namespace-escape'));
});

test('standalone foreignObject outside svg is also dropped with contents', () => {
  const result = sanitize('<foreignObject><img src=x onerror=alert(1)></foreignObject><p>ok</p>');
  assert.equal(result.html, '<p>ok</p>');
  assert.ok(categoriesOf(result).has('namespace-escape'));
});

test('self-closing svg does not swallow following HTML', () => {
  const { html } = sanitize('<svg/><b>still here</b>');
  assert.equal(html, '<b>still here</b>');
});

test('annotation-xml html integration point cannot smuggle scripts', () => {
  const result = sanitize(
    '<math><annotation-xml encoding="text/html"><script>alert(1)</script></annotation-xml></math>'
  );
  assert.equal(result.html, '');
});

test('comments are removed, including pseudo-tags inside them', () => {
  const result = sanitize('<p>a</p><!-- <img src=x onerror=alert(1)> --><p>b</p>');
  assert.equal(result.html, '<p>a</p><p>b</p>');
  assert.ok(categoriesOf(result).has('comment-injection'));
  assert.match(result.removed[0].reason, /markup-like/);
});

test('abrupt comment closing: <!--> ends the comment, following markup is real', () => {
  const result = sanitize('<!--><img src=x onerror=alert(1)>-->');
  assert.equal(result.html, '<img src="x">--&gt;');
  assert.ok(categoriesOf(result).has('event-handler'));
});

test('bogus comments (<?...>, <![CDATA[) are removed without leaking markup', () => {
  const result = sanitize('<![CDATA[<img src=x onerror=alert(1)>]]><?xml <script>alert(1)</script>?>');
  // Browsers end a bogus comment at the first ">"; the remainder is inert
  // text. The img/script tags themselves must never become real elements.
  assert.equal(result.html, ']]&gt;alert(1)?&gt;');
  assert.ok(!result.html.includes('<img'));
  assert.ok(!result.html.includes('<script'));
  assert.ok(categoriesOf(result).has('comment-injection'));
});

test('doctype declarations are removed', () => {
  const result = sanitize('<!DOCTYPE html><p>x</p>');
  assert.equal(result.html, '<p>x</p>');
  assert.ok(categoriesOf(result).has('doctype-injection'));
});

test('unclosed tags are closed at end of input', () => {
  const result = sanitize('<div><b>bold<i>both');
  assert.equal(result.html, '<div><b>bold<i>both</i></b></div>');
  assert.ok(categoriesOf(result).has('structure-repair'));
});

test('EOF inside a tag discards the partial tag like browsers do', () => {
  const { html } = sanitize('<div>ok<span class="unterminated');
  assert.equal(html, '<div>ok</div>');
});

test('misnested tags are repaired in stack order', () => {
  const result = sanitize('<b><i>x</b>y</i>');
  assert.equal(result.html, '<b><i>x</i></b>y');
  assert.ok(categoriesOf(result).has('structure-repair'));
});

test('implicit closes: p, li and table cells', () => {
  assert.equal(sanitize('<p>one<p>two').html, '<p>one</p><p>two</p>');
  assert.equal(
    sanitize('<ul><li>a<li>b</ul>').html,
    '<ul><li>a</li><li>b</li></ul>'
  );
  assert.equal(
    sanitize('<table><tr><td>a<td>b</tr></table>').html,
    '<table><tr><td>a</td><td>b</td></tr></table>'
  );
});

test('unmatched end tags are dropped, not turned into elements', () => {
  const result = sanitize('<p>x</p></br></p></div>');
  assert.equal(result.html, '<p>x</p>');
  assert.ok(categoriesOf(result).has('structure-repair'));
});

test('disallowed elements are unwrapped but children survive', () => {
  const result = sanitize('<section><p>keep</p><marquee>text</marquee></section>');
  assert.equal(result.html, '<p>keep</p>text');
  assert.ok(categoriesOf(result).has('disallowed-element'));
});

test('iframe, style, template and object contents are dropped', () => {
  const result = sanitize(
    '<iframe src="https://evil.example"></iframe>' +
      '<style>body{display:none}</style>' +
      '<template><img src=x onerror=alert(1)></template>' +
      '<object data="x.swf"></object><p>ok</p>'
  );
  assert.equal(result.html, '<p>ok</p>');
});

test('style and xmlns attributes are stripped', () => {
  const result = sanitize(
    '<p style="background:url(javascript:alert(1))" xmlns="http://www.w3.org/1999/xhtml">x</p>'
  );
  assert.equal(result.html, '<p>x</p>');
  const cats = categoriesOf(result);
  assert.ok(cats.has('disallowed-attribute'));
  assert.ok(cats.has('namespace-escape'));
});

test('id and data-* attributes are not in the allowlist', () => {
  const result = sanitize('<p id="x" data-payload="y">ok</p>');
  assert.equal(result.html, '<p>ok</p>');
});

test('target="_blank" gains rel="noopener noreferrer"', () => {
  const { html } = sanitize('<a href="https://example.com/" target="_blank">x</a>');
  assert.equal(
    html,
    '<a href="https://example.com/" target="_blank" rel="noopener noreferrer">x</a>'
  );
});

test('nesting depth limit drops tags but keeps text', () => {
  const depth = 150;
  const input = '<div>'.repeat(depth) + 'deep' + '</div>'.repeat(depth);
  const result = sanitize(input);
  assert.ok(result.html.includes('deep'));
  assert.ok((result.html.match(/<div>/g) || []).length <= 100);
  assert.ok(categoriesOf(result).has('structure-repair'));
});

test('null bytes become U+FFFD and cannot hide a scheme', () => {
  const result = sanitize('<a href="java\0script:alert(1)">x</a>');
  // After U+FFFD replacement this is not a javascript: URL any more, exactly
  // as a browser would resolve it; the link target is inert either way.
  assert.ok(!result.html.includes('javascript:'));
});

test('deterministic: repeated sanitization of the same input is identical', () => {
  const input =
    '<div><script>alert(1)</script><a href="java&Tab;script:alert(1)" href="https://ok.example/" onclick="x()">l</a>' +
    '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg><!-- <b> --><p>one<p>two' +
    '<math><mtext></math><img src="data:text/html,x" alt="a"><![CDATA[<script>]]></div>';
  const first = sanitize(input);
  const second = sanitize(input);
  assert.deepEqual(second, first);
  // Idempotent: sanitizing the output again changes nothing.
  const third = sanitize(first.html);
  assert.equal(third.html, first.html);
});

test('combined XSS payload leaves no executable residue', () => {
  const input =
    '<p onclick=alert(1)>hi</p>' +
    '<img src=x onerror=alert(1)>' +
    '<a href="&#106;&#97;vascript:alert(1)">click</a>' +
    '<svg onload=alert(1)><foreignObject><iframe srcdoc="<script>alert(1)</script>"></iframe></foreignObject></svg>' +
    '<!--><script>alert(1)</script>-->' +
    '<math href="javascript:alert(1)"><mi>x</mi></math>';
  const result = sanitize(input);
  // The trailing "--&gt;" is the text left over after the abrupt `<!-->`
  // comment and the dropped <script>, matching browser tokenization.
  assert.equal(result.html, '<p>hi</p><img src="x"><a>click</a>--&gt;');
  const cats = categoriesOf(result);
  for (const expected of [
    'event-handler',
    'unsafe-url-scheme',
    'namespace-escape',
    'active-content',
    'comment-injection',
  ]) {
    assert.ok(cats.has(expected), 'missing category ' + expected);
  }
});

test('custom options: schemes and element allowlist can be tightened', () => {
  const result = sanitize('<a href="https://example.com/">x</a><b>y</b>', {
    allowedSchemes: ['https'],
    allowedElements: ['a'],
  });
  assert.equal(result.html, '<a href="https://example.com/">x</a>y');
  const mailto = sanitize('<a href="mailto:a@b.c">x</a>', { allowedSchemes: ['https'] });
  assert.equal(mailto.html, '<a>x</a>');
});
