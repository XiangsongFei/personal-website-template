// Port of the frozen PG-only lexer and frame codec, with no transport.
import { randomBytes } from 'node:crypto';

export function splitSql(source) {
  const result = [];
  let part = '', state = '', dollarTag = '', depth = 0, escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'line') {
      if (char === '\n') {
        state = '';
        part += '\n';
      }
    } else if (state === 'block') {
      if (char === '/' && next === '*') {
        depth++;
        index++;
      } else if (char === '*' && next === '/') {
        if (--depth === 0) state = '';
        index++;
      }
    } else if (state === 'dollar') {
      if (source.startsWith(dollarTag, index)) {
        part += dollarTag;
        index += dollarTag.length - 1;
        state = '';
      } else {
        part += char;
      }
    } else if (state === 'single' || state === 'double') {
      part += char;
      const quote = state === 'single' ? "'" : '"';
      if (state === 'single' && escaped && char === '\\') {
        part += source[++index] ?? '';
      } else if (char === quote) {
        if (next === quote) part += source[++index];
        else state = '';
      }
    } else if (char === '-' && next === '-') {
      state = 'line';
      index++;
    } else if (char === '/' && next === '*') {
      state = 'block';
      depth = 1;
      index++;
    } else if (char === "'" || char === '"') {
      escaped = char === "'" && /(?:^|[^A-Za-z0-9_])E$/i.test(part);
      state = char === "'" ? 'single' : 'double';
      part += char;
    } else if (char === ';') {
      if (part.trim()) result.push(part.trim());
      part = '';
    } else {
      const tag = char === '$' && /^(?:\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/.exec(source.slice(index));
      if (tag) {
        [dollarTag] = tag;
        state = 'dollar';
        part += dollarTag;
        index += dollarTag.length - 1;
      } else {
        part += char;
      }
    }
  }
  if (state && state !== 'line') throw new Error('SQL_LEXICALLY_UNCLOSED');
  if (part.trim()) throw new Error('SQL_STATEMENT_MISSING_SEMICOLON');
  return result;
}

export function frameQuery(statement, token = randomBytes(16).toString('hex')) {
  if (typeof statement !== 'string' || !statement || /(^|\n)\s*\\/.test(statement) ||
      !/^[0-9a-f]{32}$/.test(token)) throw new Error('FRAME_INPUT');
  const marker = 'S36_FRAME_' + token;
  return {marker, input: statement + ';\n\\echo ' + marker + ' :ERROR :SQLSTATE\n'};
}

export function readFrame(marker, output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > 512 * 1024) throw new Error('FRAME_INVALID');
  const lines = output.trimEnd().split(/\r?\n/);
  const tail = lines.pop()?.split(' ');
  if (tail?.length !== 3 || tail[0] !== marker || !/^[0-9A-Z]{5}$/.test(tail[2]) ||
      tail[1] !== (tail[2] === '00000' ? 'false' : 'true') || lines.some(line => line.startsWith(marker))) {
    throw new Error('FRAME_UNACKNOWLEDGED');
  }
  return {sqlstate: tail[2], lines};
}
