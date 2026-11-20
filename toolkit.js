/* 数据开发工具包 - 通用工具逻辑（纯前端、零依赖） */
(function (global) {
  'use strict';
  var T = {};

  /* ---------------- JSON ---------------- */
  T.jsonFormat = function (text, indent) {
    var obj = JSON.parse(text);
    return JSON.stringify(obj, null, indent === 0 ? 0 : (indent || 2));
  };
  T.jsonMinify = function (text) {
    return JSON.stringify(JSON.parse(text));
  };
  T.jsonValidate = function (text) {
    try {
      var obj = JSON.parse(text);
      var type = Array.isArray(obj) ? 'array' : (obj === null ? 'null' : typeof obj);
      var count = Array.isArray(obj) ? obj.length : (obj && typeof obj === 'object' ? Object.keys(obj).length : 0);
      return { ok: true, type: type, count: count, message: 'JSON 合法 · ' + type + (count ? ' · ' + count + ' 项' : '') };
    } catch (e) {
      return { ok: false, message: 'JSON 无效：' + e.message };
    }
  };
  function sqlLiteral(v, quoteMode) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    var s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
    if (quoteMode === 'none') return s;
    var q = quoteMode === 'double' ? '"' : "'";
    return q + s.split(q).join(q + q) + q;
  }
  T.jsonToInsert = function (text, table, quoteMode) {
    var obj = JSON.parse(text);
    var arr = Array.isArray(obj) ? obj : [obj];
    var keys = [];
    arr.forEach(function (row) {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        Object.keys(row).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
      }
    });
    if (!keys.length) keys = ['value'];
    var rows = arr.map(function (row) {
      if (Array.isArray(row)) return '(' + row.map(function (v) { return sqlLiteral(v, quoteMode); }).join(', ') + ')';
      if (!row || typeof row !== 'object') return '(' + sqlLiteral(row, quoteMode) + ')';
      return '(' + keys.map(function (k) { return sqlLiteral(row[k], quoteMode); }).join(', ') + ')';
    });
    var cols = Array.isArray(obj) && obj.length && Array.isArray(obj[0]) ? '' : ' (' + keys.join(', ') + ')';
    return 'INSERT INTO ' + (table || 'my_table') + cols + ' VALUES\n' + rows.join(',\n') + ';';
  };

  /* ---------------- 文本处理 ---------------- */
  T.textProcess = function (text, o) {
    o = o || {};
    var rawLines = text.split(/\r?\n/);
    var stats = { lines: rawLines.length, chars: text.length, blank: 0 };
    var lines = rawLines.slice();
    if (o.dropEmpty) lines = lines.filter(function (l) { if (!l.trim()) { stats.blank++; return false; } return true; });
    if (o.trim) lines = lines.map(function (l) { return l.trim(); });
    if (o.caseMode === 'upper') lines = lines.map(function (l) { return l.toUpperCase(); });
    if (o.caseMode === 'lower') lines = lines.map(function (l) { return l.toLowerCase(); });
    if (o.dedup) {
      var seen = Object.create(null), out = [];
      lines.forEach(function (l) {
        var key = o.ignoreCaseDedup ? l.toLowerCase() : l;
        if (!seen[key]) { seen[key] = 1; out.push(l); }
      });
      lines = out;
    }
    if (o.sort && o.sort !== 'none') {
      lines.sort(function (a, b) {
        switch (o.sort) {
          case 'asc': return a.localeCompare(b, 'zh-CN');
          case 'desc': return b.localeCompare(a, 'zh-CN');
          case 'numAsc': return parseFloat(a) - parseFloat(b);
          case 'numDesc': return parseFloat(b) - parseFloat(a);
          case 'lenAsc': return a.length - b.length;
          case 'lenDesc': return b.length - a.length;
          default: return 0;
        }
      });
    }
    if (o.reverse) lines.reverse();
    if (o.prefix || o.suffix) lines = lines.map(function (l) { return (o.prefix || '') + l + (o.suffix || ''); });
    stats.unique = Object.keys(lines.reduce(function (m, l) { m[l] = 1; return m; }, Object.create(null))).length;
    stats.result = lines.length;
    return { text: lines.join('\n'), stats: stats };
  };

  /* ---------------- 正则 ---------------- */
  function makeRegex(pattern, flags) {
    if (!pattern) throw new Error('请输入正则表达式');
    return new RegExp(pattern, flags || 'g');
  }
  T.regexTest = function (pattern, flags, text) {
    try {
      var re = makeRegex(pattern, flags), m, matches = [], guard = 0;
      var global = flags && flags.indexOf('g') >= 0;
      while ((m = re.exec(text)) !== null) {
        matches.push({
          index: m.index,
          line: text.slice(0, m.index).split('\n').length,
          value: m[0],
          groups: m.slice(1)
        });
        if (!global || ++guard > 1000) break;
        if (m[0] === '') re.lastIndex++;
      }
      return { ok: true, count: matches.length, matches: matches };
    } catch (e) {
      return { ok: false, error: '正则无效：' + e.message };
    }
  };
  T.regexReplace = function (pattern, flags, text, replacement) {
    try {
      return { ok: true, text: text.replace(makeRegex(pattern, flags), replacement == null ? '' : replacement) };
    } catch (e) {
      return { ok: false, error: '正则无效：' + e.message };
    }
  };

  /* ---------------- 时间 / 分区 ---------------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
  function dash(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) {
    if (!s) return new Date();
    s = String(s).trim();
    var m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(s);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  T.timeNow = function () {
    var d = new Date();
    return { iso: d.toISOString(), local: d.toString(), unixSec: Math.floor(d.getTime() / 1000), unixMs: d.getTime(), ymd: ymd(d), dash: dash(d) };
  };
  T.tsToDate = function (value, unit) {
    var n = Number(value);
    if (!isFinite(n)) throw new Error('请输入有效时间戳');
    var ms = unit === 's' ? n * 1000 : n;
    var d = new Date(ms);
    if (isNaN(d.getTime())) throw new Error('时间戳超出范围');
    return { date: d, iso: d.toISOString(), local: d.toString(), dash: dash(d), ymd: ymd(d) };
  };
  T.dateToTs = function (s) {
    var d = parseDate(s);
    return { sec: Math.floor(d.getTime() / 1000), ms: d.getTime() };
  };
  T.dateShift = function (s, n, unit) {
    var d = parseDate(s);
    n = Number(n) || 0;
    if (unit === 'w') d.setDate(d.getDate() + n * 7);
    else if (unit === 'm') {
      var day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + n);
      var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
    }
    else d.setDate(d.getDate() + n);
    return d;
  };
  T.dateFormats = function (s) {
    var d = parseDate(s);
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    var first = new Date(y, d.getMonth(), 1), last = new Date(y, d.getMonth() + 1, 0);
    var weekNames = ['日', '一', '二', '三', '四', '五', '六'];
    var diff = Math.round((new Date(y, d.getMonth(), day) - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000);
    return [
      { label: '紧凑日期 yyyyMMdd', value: ymd(d) },
      { label: '标准日期 yyyy-MM-dd', value: dash(d) },
      { label: '年月 yyyyMM', value: '' + y + pad(m) },
      { label: '年月 yyyy-MM', value: y + '-' + pad(m) },
      { label: '斜杠 yyyy/MM/dd', value: y + '/' + pad(m) + '/' + pad(day) },
      { label: '月初', value: dash(first) },
      { label: '月末', value: dash(last) },
      { label: '星期', value: '星期' + weekNames[d.getDay()] },
      { label: '与今天相差', value: (diff > 0 ? '+' : '') + diff + ' 天' }
    ];
  };

  /* ---------------- 编码 / 哈希 ---------------- */
  function utf8ToB64(s) { return global.btoa(unescape(encodeURIComponent(s))); }
  function b64ToUtf8(s) { return decodeURIComponent(escape(global.atob(s.trim()))); }
  function htmlEscape(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function htmlUnescape(s) {
    return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (all, e) {
      if (e[0] === '#') {
        var code = e[1] && e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(code) ? String.fromCharCode(code) : all;
      }
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[e.toLowerCase()] || all;
    });
  }
  T.uuid = function () {
    var bytes = new Uint8Array(16);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(bytes);
    else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  };
  T.encode = function (mode, text) {
    switch (mode) {
      case 'b64enc': return utf8ToB64(text);
      case 'b64dec': return b64ToUtf8(text);
      case 'urlenc': return encodeURIComponent(text);
      case 'urldec': return decodeURIComponent(text);
      case 'uricomponent': return encodeURI(text);
      case 'htmlenc': return htmlEscape(text);
      case 'htmldec': return htmlUnescape(text);
      case 'md5': if (!global.md5) throw new Error('md5 库未加载'); return global.md5(text);
      case 'sha1': if (!global.sha1) throw new Error('sha1 库未加载'); return global.sha1(text);
      case 'sha256': if (!global.sha256) throw new Error('sha256 库未加载'); return global.sha256(text);
      case 'uuid': return T.uuid();
      default: return text;
    }
  };

  /* ---------------- CSV / TSV ---------------- */
  T.parseDelimited = function (text, delim, hasHeader) {
    delim = delim || ',';
    var rows = [], row = [], field = '', inQuote = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuote = false;
        } else field += c;
      } else {
        if (c === '"') inQuote = true;
        else if (c === delim) { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    rows = rows.filter(function (r) { return r.length > 1 || (r[0] || '').trim() !== ''; });
    var header;
    if (hasHeader && rows.length) header = rows.shift();
    else header = (rows[0] || []).map(function (_, i) { return 'col' + (i + 1); });
    header = header.map(function (h, i) { return String(h).trim() || ('col' + (i + 1)); });
    return { header: header, rows: rows };
  };
  T.csvToSql = function (text, o) {
    o = o || {};
    var p = T.parseDelimited(text, o.delimiter || ',', o.hasHeader !== false);
    var q = o.quote || 'auto';
    var vals = p.rows.map(function (r) {
      return '(' + r.map(function (v) {
        var s = String(v == null ? '' : v).trim();
        if (q === 'none') return s;
        if (q === 'auto' && (/^-?\d+(\.\d+)?$/.test(s) || /^(null|true|false)$/i.test(s))) return s;
        var quote = q === 'double' ? '"' : "'";
        return quote + s.split(quote).join(quote + quote) + quote;
      }).join(', ') + ')';
    });
    var cols = ' (' + p.header.map(function (h) { return '`' + h + '`'; }).join(', ') + ')';
    var table = o.table || 'my_table';
    var batch = Math.max(0, parseInt(o.batch, 10) || 0);
    if (!batch || vals.length <= batch) return 'INSERT INTO ' + table + cols + ' VALUES\n' + vals.join(',\n') + ';';
    var chunks = [];
    for (var i = 0; i < vals.length; i += batch) chunks.push('INSERT INTO ' + table + cols + ' VALUES\n' + vals.slice(i, i + batch).join(',\n') + ';');
    return chunks.join('\n\n');
  };
  T.csvToJson = function (text, o) {
    o = o || {};
    var p = T.parseDelimited(text, o.delimiter || ',', o.hasHeader !== false);
    return JSON.stringify(p.rows.map(function (r) {
      var obj = {};
      p.header.forEach(function (h, i) { obj[h] = r[i] == null ? '' : r[i]; });
      return obj;
    }), null, 2);
  };

  global.Toolkit = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
