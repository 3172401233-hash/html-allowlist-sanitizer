'use strict';

const { decodeEntities } = require('./entities');

// A spec-inspired HTML tokenizer. It follows the browser state machine for
// the states that matter to a sanitizer: data, tag open, tag name, attribute
// name/value (quoted and unquoted), self-closing start tags, comments
// (including the abrupt `<!-->` / `<!--->` closings and `--!>`), bogus
// comments (`<?...>`, `<!foo>`, `<![CDATA[...` in HTML content) and doctypes.
//
// Token shapes:
//   { type: 'text', value }
//   { type: 'startTag', name, attrs: [[name, value]], duplicates: [name], selfClosing }
//   { type: 'endTag', name }
//   { type: 'comment', value, abrupt }
//   { type: 'bogusComment', value }
//   { type: 'doctype' }

function isAsciiLetter(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\f' || ch === '\r';
}

function replaceNulls(str) {
  return str.indexOf('\0') === -1 ? str : str.replace(/\0/g, '�');
}

function tokenize(input) {
  const tokens = [];
  const len = input.length;
  let pos = 0;

  function pushText(raw) {
    if (raw.length === 0) return;
    tokens.push({ type: 'text', value: decodeEntities(replaceNulls(raw), false) });
  }

  function parseBogusComment(from) {
    const gt = input.indexOf('>', from);
    if (gt === -1) {
      tokens.push({ type: 'bogusComment', value: replaceNulls(input.slice(from)) });
      return len;
    }
    tokens.push({ type: 'bogusComment', value: replaceNulls(input.slice(from, gt)) });
    return gt + 1;
  }

  // input[lt] === '<', input[lt + 1] === '!'
  function parseMarkupDeclaration(lt) {
    if (input.startsWith('<!--', lt)) {
      // Abrupt closings: `<!-->` and `<!--->` are complete, empty comments.
      if (input.startsWith('<!-->', lt)) {
        tokens.push({ type: 'comment', value: '', abrupt: true });
        return lt + 5;
      }
      if (input.startsWith('<!--->', lt)) {
        tokens.push({ type: 'comment', value: '', abrupt: true });
        return lt + 6;
      }
      let cursor = lt + 4;
      while (cursor < len) {
        const close = input.indexOf('--', cursor);
        if (close === -1) break;
        if (input.startsWith('--!>', close)) {
          tokens.push({ type: 'comment', value: replaceNulls(input.slice(lt + 4, close)), abrupt: false });
          return close + 4;
        }
        if (input.startsWith('-->', close)) {
          tokens.push({ type: 'comment', value: replaceNulls(input.slice(lt + 4, close)), abrupt: false });
          return close + 3;
        }
        cursor = close + 2;
      }
      // EOF inside a comment: the comment runs to end of input.
      tokens.push({ type: 'comment', value: replaceNulls(input.slice(lt + 4)), abrupt: false });
      return len;
    }
    if (/^<!doctype/i.test(input.slice(lt, lt + 9))) {
      const gt = input.indexOf('>', lt + 2);
      tokens.push({ type: 'doctype' });
      return gt === -1 ? len : gt + 1;
    }
    // Includes <![CDATA[ ... in HTML content: without foreign (SVG/MathML)
    // elements this is a bogus comment, exactly as browsers treat it.
    return parseBogusComment(lt + 2);
  }

  function skipWhitespace(j) {
    while (j < len && isWhitespace(input[j])) j++;
    return j;
  }

  // Parses attributes starting at j. Returns null when EOF is hit inside the
  // tag (browsers discard the whole tag token in that case).
  function parseAttributes(j) {
    const attrs = [];
    const duplicates = [];
    const seen = new Set();
    let selfClosing = false;

    for (;;) {
      j = skipWhitespace(j);
      if (j >= len) return null;
      const ch = input[j];
      if (ch === '>') {
        return { attrs, duplicates, selfClosing, next: j + 1 };
      }
      if (ch === '/') {
        if (input[j + 1] === '>') {
          selfClosing = true;
          return { attrs, duplicates, selfClosing, next: j + 2 };
        }
        j++;
        continue;
      }

      let name = '';
      while (j < len) {
        const c = input[j];
        if (isWhitespace(c) || c === '/' || c === '>') break;
        if (c === '=' && name !== '') break;
        name += c;
        j++;
      }
      name = replaceNulls(name).toLowerCase();

      j = skipWhitespace(j);
      let value = '';
      if (j < len && input[j] === '=') {
        j++;
        j = skipWhitespace(j);
        if (j >= len) return null;
        const quote = input[j];
        if (quote === '"' || quote === "'") {
          const end = input.indexOf(quote, j + 1);
          if (end === -1) return null; // EOF in quoted value: tag discarded
          value = input.slice(j + 1, end);
          j = end + 1;
        } else {
          const start = j;
          while (j < len && !isWhitespace(input[j]) && input[j] !== '>') j++;
          value = input.slice(start, j);
        }
      }

      if (name === '') continue;
      if (seen.has(name)) {
        // Per the HTML standard the first occurrence wins; later duplicates
        // are dropped. We record them so the sanitizer can report the repair.
        duplicates.push(name);
        continue;
      }
      seen.add(name);
      attrs.push([name, decodeEntities(replaceNulls(value), true)]);
    }
  }

  // input[lt] === '<', input[lt + 1] is an ASCII letter.
  function parseStartTag(lt) {
    let j = lt + 1;
    let name = '';
    while (j < len) {
      const c = input[j];
      if (isWhitespace(c) || c === '/' || c === '>') break;
      name += c;
      j++;
    }
    name = replaceNulls(name).toLowerCase();
    const parsed = parseAttributes(j);
    if (parsed === null) return len; // EOF in tag: token discarded
    tokens.push({
      type: 'startTag',
      name,
      attrs: parsed.attrs,
      duplicates: parsed.duplicates,
      selfClosing: parsed.selfClosing,
    });
    return parsed.next;
  }

  // input[lt] === '<', input[lt + 1] === '/'
  function parseEndTag(lt) {
    const j0 = lt + 2;
    if (j0 >= len) {
      pushText('</');
      return len;
    }
    const first = input[j0];
    if (first === '>') return j0 + 1; // `</>` is dropped entirely
    if (!isAsciiLetter(first)) return parseBogusComment(lt + 2);
    let j = j0;
    let name = '';
    while (j < len) {
      const c = input[j];
      if (isWhitespace(c) || c === '/' || c === '>') break;
      name += c;
      j++;
    }
    name = replaceNulls(name).toLowerCase();
    // End tags may carry (ignored) attributes, including quoted values that
    // can contain ">". Parse and discard them so we resync like a browser.
    const parsed = parseAttributes(j);
    if (parsed === null) return len;
    tokens.push({ type: 'endTag', name });
    return parsed.next;
  }

  while (pos < len) {
    const lt = input.indexOf('<', pos);
    if (lt === -1) {
      pushText(input.slice(pos));
      break;
    }
    pushText(input.slice(pos, lt));
    const next = input[lt + 1];
    if (next === undefined) {
      pushText('<');
      break;
    }
    if (next === '!') {
      pos = parseMarkupDeclaration(lt);
    } else if (next === '/') {
      pos = parseEndTag(lt);
    } else if (isAsciiLetter(next)) {
      pos = parseStartTag(lt);
    } else if (next === '?') {
      pos = parseBogusComment(lt + 1);
    } else {
      pushText('<');
      pos = lt + 1;
    }
  }

  return tokens;
}

module.exports = { tokenize };
