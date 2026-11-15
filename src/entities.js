'use strict';

// Named character references. `legacy: true` marks references that HTML
// browsers also honour without a trailing semicolon (the "legacy" set from
// the HTML standard). Unknown names are intentionally left undecoded.

const LATIN1_LEGACY = {
  AElig: 0xc6, Aacute: 0xc1, Acirc: 0xc2, Agrave: 0xc0, Aring: 0xc5,
  Atilde: 0xc3, Auml: 0xc4, Ccedil: 0xc7, ETH: 0xd0, Eacute: 0xc9,
  Ecirc: 0xca, Egrave: 0xc8, Euml: 0xcb, Iacute: 0xcd, Icirc: 0xce,
  Igrave: 0xcc, Iuml: 0xcf, Ntilde: 0xd1, Oacute: 0xd3, Ocirc: 0xd4,
  Ograve: 0xd2, Oslash: 0xd8, Otilde: 0xd5, Ouml: 0xd6, THORN: 0xde,
  Uacute: 0xda, Ucirc: 0xdb, Ugrave: 0xd9, Uuml: 0xdc, Yacute: 0xdd,
  aacute: 0xe1, acirc: 0xe2, acute: 0xb4, agrave: 0xe0, aring: 0xe5,
  atilde: 0xe3, auml: 0xe4, brvbar: 0xa6, ccedil: 0xe7, cedil: 0xb8,
  cent: 0xa2, copy: 0xa9, curren: 0xa4, deg: 0xb0, divide: 0xf7,
  eacute: 0xe9, ecirc: 0xea, egrave: 0xe8, eth: 0xf0, euml: 0xeb,
  frac12: 0xbd, frac14: 0xbc, frac34: 0xbe, iacute: 0xed, icirc: 0xee,
  iexcl: 0xa1, igrave: 0xec, iquest: 0xbf, iuml: 0xef, laquo: 0xab,
  macr: 0xaf, micro: 0xb5, middot: 0xb7, nbsp: 0xa0, not: 0xac,
  ntilde: 0xf1, oacute: 0xf3, ocirc: 0xf4, ograve: 0xf2, ordf: 0xaa,
  ordm: 0xba, oslash: 0xf8, otilde: 0xf5, ouml: 0xf6, para: 0xb6,
  plusmn: 0xb1, pound: 0xa3, raquo: 0xbb, reg: 0xae, sect: 0xa7,
  shy: 0xad, sup1: 0xb9, sup2: 0xb2, sup3: 0xb3, szlig: 0xdf,
  thorn: 0xfe, times: 0xd7, uacute: 0xfa, ucirc: 0xfb, ugrave: 0xf9,
  uml: 0xa8, uuml: 0xfc, yacute: 0xfd, yen: 0xa5, yuml: 0xff,
};

const NAMED = Object.create(null);

function addNamed(name, codePoint, legacy) {
  NAMED[name] = { value: String.fromCodePoint(codePoint), legacy: !!legacy };
}

for (const [name, cp] of Object.entries(LATIN1_LEGACY)) addNamed(name, cp, true);

addNamed('amp', 0x26, true);
addNamed('AMP', 0x26, true);
addNamed('lt', 0x3c, true);
addNamed('LT', 0x3c, true);
addNamed('gt', 0x3e, true);
addNamed('GT', 0x3e, true);
addNamed('quot', 0x22, true);
addNamed('QUOT', 0x22, true);
addNamed('apos', 0x27, false);
addNamed('Tab', 0x09, false);
addNamed('NewLine', 0x0a, false);
addNamed('nbsp', 0xa0, true);
addNamed('colon', 0x3a, false);
addNamed('semi', 0x3b, false);
addNamed('period', 0x2e, false);
addNamed('sol', 0x2f, false);
addNamed('equals', 0x3d, false);
addNamed('excl', 0x21, false);
addNamed('quest', 0x3f, false);
addNamed('commat', 0x40, false);
addNamed('num', 0x23, false);
addNamed('percnt', 0x25, false);
addNamed('plus', 0x2b, false);
addNamed('comma', 0x2c, false);
addNamed('hyphen', 0x2d, false);
addNamed('dash', 0x2d, false);
addNamed('lowbar', 0x5f, false);
addNamed('grave', 0x60, false);
addNamed('circ', 0x5e, false);
addNamed('tilde', 0x7e, false);
addNamed('verbar', 0x7c, false);
addNamed('bsol', 0x5c, false);
addNamed('lpar', 0x28, false);
addNamed('rpar', 0x29, false);
addNamed('ast', 0x2a, false);
addNamed('lsqb', 0x5b, false);
addNamed('rsqb', 0x5d, false);
addNamed('lcub', 0x7b, false);
addNamed('rcub', 0x7d, false);
addNamed('hellip', 0x2026, false);
addNamed('mdash', 0x2014, false);
addNamed('ndash', 0x2013, false);
addNamed('lsquo', 0x2018, false);
addNamed('rsquo', 0x2019, false);
addNamed('ldquo', 0x201c, false);
addNamed('rdquo', 0x201d, false);
addNamed('bull', 0x2022, false);
addNamed('dagger', 0x2020, false);
addNamed('Dagger', 0x2021, false);
addNamed('permil', 0x2030, false);
addNamed('prime', 0x2032, false);
addNamed('Prime', 0x2033, false);
addNamed('euro', 0x20ac, false);
addNamed('trade', 0x2122, false);

const MAX_NAME_LENGTH = Math.max(...Object.keys(NAMED).map((n) => n.length));

// C1 control codes are remapped to Windows-1252 characters, per the HTML
// standard's numeric character reference rules.
const C1_REPLACEMENTS = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

function codePointToString(cp) {
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return '�';
  }
  if (Object.prototype.hasOwnProperty.call(C1_REPLACEMENTS, cp)) {
    return String.fromCodePoint(C1_REPLACEMENTS[cp]);
  }
  return String.fromCodePoint(cp);
}

// Decodes character references the way an HTML parser does:
// - numeric references with an optional trailing semicolon
// - named references; the legacy subset also matches without a semicolon
// - in attribute values, a legacy reference without a semicolon is not
//   decoded when followed by "=" or an alphanumeric character
function decodeEntities(input, inAttribute) {
  if (input.indexOf('&') === -1) return input;
  let out = '';
  let i = 0;
  while (i < input.length) {
    const amp = input.indexOf('&', i);
    if (amp === -1) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, amp);

    const numeric = /^&#([xX][0-9a-fA-F]+|[0-9]+);?/.exec(input.slice(amp));
    if (numeric) {
      const body = numeric[1];
      const cp = body[0] === 'x' || body[0] === 'X'
        ? parseInt(body.slice(1), 16)
        : parseInt(body, 10);
      out += codePointToString(cp);
      i = amp + numeric[0].length;
      continue;
    }

    const named = /^&([0-9a-zA-Z]{1,32})(;?)/.exec(input.slice(amp));
    if (named) {
      const run = named[1];
      const hasTrailingSemi = named[2] === ';';
      let matched = null;
      const upper = Math.min(run.length, MAX_NAME_LENGTH);
      for (let len = upper; len >= 2; len--) {
        const entry = NAMED[run.slice(0, len)];
        if (!entry) continue;
        const withSemi = len === run.length && hasTrailingSemi;
        if (!withSemi && !entry.legacy) continue;
        if (!withSemi && inAttribute) {
          const nextCh = input[amp + 1 + len];
          if (nextCh === '=' || (nextCh !== undefined && /[0-9a-zA-Z]/.test(nextCh))) {
            continue;
          }
        }
        matched = { value: entry.value, consumed: 1 + len + (withSemi ? 1 : 0) };
        break;
      }
      if (matched) {
        out += matched.value;
        i = amp + matched.consumed;
        continue;
      }
    }

    out += '&';
    i = amp + 1;
  }
  return out;
}

module.exports = { decodeEntities };
