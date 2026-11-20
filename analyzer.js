/*
 * SQL Analysis engine - zero dependency
 * Provides: variables, id-to-IN, refs (tables/columns), risk scan,
 *           CTE outline, line diff, SELECT -> DDL
 */
(function (global) {
  'use strict';

  var KW_NO_ALIAS = new Set(['SELECT','FROM','WHERE','GROUP','BY','ORDER','HAVING','LIMIT','AS','AND','OR','ON','JOIN','LEFT','RIGHT','INNER','OUTER','FULL','CROSS','UNION','ALL','DISTINCT','CASE','WHEN','THEN','ELSE','END','IN','IS','NOT','NULL','LIKE','BETWEEN','ASC','DESC','OVER','PARTITION']);
  var tok = function (sql) { return (global.SQLFmt && global.SQLFmt.tokenize) ? global.SQLFmt.tokenize(sql) : []; };

  // ---------- variables ----------
  function scanVariables(sql) {
    var re = /\$\{[A-Za-z_][\w:.]*\}|\$\{[^}]+\}|#\{[^}]+\}|%\{[^}]+\}|:[A-Za-z_]\w*/g;
    var map = {}, m;
    while ((m = re.exec(sql)) !== null) {
      var raw = m[0];
      var name = raw.replace(/^[^A-Za-z_]*/, '').replace(/[^A-Za-z0-9_:]$/, '');
      if (!map[name]) map[name] = { name: name, raw: raw, count: 0 };
      map[name].count++;
    }
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function replaceVariables(sql, values) {
    return sql.replace(/\$\{[A-Za-z_][\w:.]*\}|\$\{[^}]+\}|#\{[^}]+\}|%\{[^}]+\}|:[A-Za-z_]\w*/g, function (raw) {
      var name = raw.replace(/^[^A-Za-z_]*/, '').replace(/[^A-Za-z0-9_:]$/, '');
      if (Object.prototype.hasOwnProperty.call(values, name)) return values[name];
      if (Object.prototype.hasOwnProperty.call(values, raw)) return values[raw];
      return raw;
    });
  }

  // ---------- IDs -> IN (...) ----------
  function idsToIn(text, opts) {
    opts = opts || {};
    var quote = opts.quote || 'auto';
    var distinct = opts.distinct !== false;
    var parts = text.split(/[\r\n,;\t]+/).map(function (s) { return s.trim().replace(/^['"]|['"]$/g, ''); }).filter(function (s) { return s.length > 0; });
    if (distinct) { var seen = {}; parts = parts.filter(function (s) { return seen[s] ? false : (seen[s] = 1); }); }
    var needsQuote = quote === 'single' ? true : (quote === 'none' ? false : parts.some(function (s) { return !/^-?\d+(\.\d+)?$/.test(s); }));
    var body = parts.map(function (s) {
      if (!needsQuote) return s;
      return "'" + s.replace(/'/g, "''") + "'";
    }).join(', ');
    return { text: '(' + body + ')', count: parts.length, quoted: needsQuote };
  }

  // ---------- table / column refs ----------
  function pickIdent(tokens, i) {
    var t = tokens[i];
    if (!t) return null;
    var name = '';
    if (t.type === 'word' || t.type === 'ident') {
      name = t.value.replace(/^["`]/, '').replace(/["`]$/, '');
      if (tokens[i + 1] && tokens[i + 1].value === '.') {
        var t2 = tokens[i + 2];
        if (t2 && (t2.type === 'word' || t2.type === 'ident')) {
          name += '.' + t2.value.replace(/^["`]/, '').replace(/["`]$/, '');
          return { name: name, next: i + 3 };
        }
      }
      return { name: name, next: i + 1 };
    }
    return null;
  }

  function extractRefs(sql) {
    var tokens = tok(sql);
    var tables = [], tseen = {};
    var columns = [], cseen = {};
    var hasStar = false;
    function addTable(name, kind) {
      var k = kind + ':' + name.toLowerCase();
      if (!tseen[k]) { tseen[k] = 1; tables.push({ name: name, kind: kind }); }
    }
    function addColumn(name, expr) {
      if (!name || KW_NO_ALIAS.has(name.toUpperCase())) return;
      var k = name.toLowerCase();
      if (!cseen[k]) { cseen[k] = 1; columns.push({ name: name, expr: (expr || name).trim() }); }
    }

    var stmtStarts = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var up = (t.type === 'word') ? t.value.toUpperCase() : '';
      // table sources
      if (up === 'FROM' || up === 'JOIN' || up === 'TABLE' || up === 'INTO' || up === 'UPDATE') {
        var j = i + 1;
        // skip subquery
        if (tokens[j] && tokens[j].value === '(') continue;
        var id = pickIdent(tokens, j);
        if (id) {
          var kind = (up === 'INTO' || up === 'UPDATE' || up === 'TABLE') ? 'target' : (up === 'JOIN' ? 'join' : 'from');
          addTable(id.name, kind);
          if (tokens[id.next] && (tokens[id.next].type === 'word' || tokens[id.next].type === 'ident') && tokens[id.next].value.toUpperCase() !== 'WHERE' && tokens[id.next].value.toUpperCase() !== 'ON') {
            // alias
          }
        }
      }
      // select list -> columns
      if (up === 'SELECT') {
        if (tokens[i + 1] && tokens[i + 1].value === '*') hasStar = true;
        var k = i + 1, depth = 0, buf = [], groups = [];
        while (k < tokens.length) {
          var tk = tokens[k];
          var u2 = tk.value.toUpperCase();
          if (tk.value === '(') depth++;
          if (tk.value === ')') depth = Math.max(0, depth - 1);
          if (depth === 0 && (u2 === 'FROM' || u2 === 'WHERE' || u2 === 'GROUP' || u2 === 'ORDER' || u2 === 'HAVING' || u2 === 'LIMIT')) break;
          if (tk.value === ',' && depth === 0) { groups.push(buf); buf = []; k++; continue; }
          buf.push(tk); k++;
        }
        if (buf.length) groups.push(buf);
        groups.forEach(function (g) {
          if (!g.length) return;
          if (g.length === 1 && g[0].value === '*') { hasStar = true; return; }
          var alias = '';
          for (var q = 0; q < g.length - 1; q++) {
            if (g[q].type === 'word' && g[q].value.toUpperCase() === 'AS' && g[q + 1]) { alias = g[q + 1].value.replace(/^["`]/, '').replace(/["`]$/, ''); break; }
          }
          if (!alias) {
            var last = g[g.length - 1];
            if (last && (last.type === 'word' || last.type === 'ident') && !KW_NO_ALIAS.has(last.value.toUpperCase()) && !(g[g.length - 2] && g[g.length - 2].value === '.')) {
              alias = last.value.replace(/^["`]/, '').replace(/["`]$/, '');
            }
          }
          if (alias) {
            addColumn(alias, g.map(function (x) { return x.value; }).join(''));
          }
        });
      }
    }
    return { tables: tables, columns: columns, hasStar: hasStar };
  }

  // ---------- risk scan ----------
  function scanRisks(sql) {
    var risks = [];
    function push(level, title, detail) { risks.push({ level: level, title: title, detail: detail }); }
    var tokens = tok(sql);
    var words = tokens.filter(function (t) { return t.type === 'word'; }).map(function (t) { return t.value.toUpperCase(); });
    var hasWhere = words.indexOf('WHERE') !== -1;
    var upper = tokens.map(function (t) { return t.value.toUpperCase(); });

    // SELECT *
    for (var i = 0; i < tokens.length - 1; i++) {
      if (tokens[i].value.toUpperCase() === 'SELECT' && tokens[i + 1].value === '*') { push('warn', '使用了 SELECT *', '显式列出字段可减少 IO、避免字段顺序变化带来的问题。'); break; }
    }
    // DML without WHERE
    if (words.indexOf('DELETE') !== -1 && !hasWhere) push('danger', 'DELETE 没有 WHERE', '将删除全表数据，请确认是否误操作。');
    if (words.indexOf('UPDATE') !== -1 && !hasWhere) push('warn', 'UPDATE 没有 WHERE', '将更新全表，请确认范围。');
    // JOIN without ON / USING
    for (var j = 0; j < tokens.length; j++) {
      if (tokens[j].value.toUpperCase() === 'JOIN') {
        var hasOn = false;
        for (var q = j + 1; q < Math.min(j + 40, tokens.length); q++) {
          var uj = tokens[q].value.toUpperCase();
          if (uj === 'ON' || uj === 'USING') { hasOn = true; break; }
          if (['WHERE','GROUP','ORDER','HAVING','LIMIT','JOIN','UNION'].indexOf(uj) !== -1) break;
        }
        if (!hasOn) { push('danger', 'JOIN 缺少 ON/USING', '可能产生笛卡尔积，行数爆炸。请检查第 ' + (lineOf(sql, j, tokens)) + ' 处 JOIN。'); break; }
      }
    }
    // non-equi join
    for (var n = 0; n < tokens.length - 1; n++) {
      if (tokens[n].value.toUpperCase() === 'ON') {
        for (var z = n + 1; z < Math.min(n + 30, tokens.length); z++) {
          if (['WHERE','GROUP','ORDER','HAVING','LIMIT','JOIN','UNION'].indexOf(tokens[z].value.toUpperCase()) !== -1) break;
          if ((tokens[z].value === '<>' || tokens[z].value === '!=')) { push('info', '非等值 JOIN 条件', 'ON 中使用了 <> / !=，通常会导致 Shuffle 膨胀，建议确认。'); z = 999; break; }
        }
        if (z === 999) break;
      }
    }
    // ORDER BY without LIMIT
    if (words.indexOf('ORDER') !== -1 && words.indexOf('LIMIT') === -1) push('warn', 'ORDER BY 没有 LIMIT', '全量排序开销很大，建议加 LIMIT。');
    // INSERT OVERWRITE without PARTITION (hive/spark)
    if (words.indexOf('OVERWRITE') !== -1 && words.indexOf('PARTITION') === -1) push('warn', 'OVERWRITE 未见 PARTITION', '动态分区写入请确认分区字段，避免覆盖整表。');
    // partition column wrapped by function in WHERE
    var partFuncs = ['DATE','TO_DATE','DATE_FORMAT','SUBSTR','SUBSTRING','CAST','YEAR','MONTH','DAY','EXTRACT','TRUNC','FROM_UNIXTIME'];
    var whereIdx = -1;
    for (var w = 0; w < tokens.length; w++) if (tokens[w].value.toUpperCase() === 'WHERE') { whereIdx = w; break; }
    if (whereIdx >= 0) {
      for (var f = whereIdx; f < tokens.length; f++) {
        var fu = tokens[f].value.toUpperCase();
        if (partFuncs.indexOf(fu) !== -1 && tokens[f + 1] && tokens[f + 1].value === '(') {
          var inner = (tokens[f + 2] && tokens[f + 2].value.toLowerCase()) || '';
          if (/^(dt|ds|date|day|pt|partition_date|create_date)$/i.test(inner)) { push('warn', '分区字段套了函数', 'WHERE 中对分区字段 "' + inner + '" 使用函数会导致分区裁剪失效，全表扫描。'); break; }
        }
      }
    }
    // count(distinct a, b) may skew
    for (var c = 0; c < tokens.length - 1; c++) {
      if (tokens[c].value.toUpperCase() === 'DISTINCT' && c > 0 && tokens[c - 1].value.toUpperCase() === 'COUNT') {
        var commas = 0;
        for (var e = c + 1; e < Math.min(c + 15, tokens.length); e++) { if (tokens[e].value === ',') commas++; if (tokens[e].value === ')') break; }
        if (commas > 0) push('warn', 'COUNT(DISTINCT 多字段)', '多列去重在 Hive/Spark 中只按一个 Reducer 处理，容易数据倾斜。');
        break;
      }
    }
    // UNION without ALL
    if (words.indexOf('UNION') !== -1 && words.indexOf('ALL') === -1 && words.indexOf('DISTINCT') === -1) push('info', 'UNION 默认去重', '如果不需要去重，改用 UNION ALL 可省一次 Shuffle。');
    // CREATE TABLE without IF NOT EXISTS
    if (words.indexOf('CREATE') !== -1 && words.indexOf('TABLE') !== -1 && words.indexOf('EXISTS') === -1) push('info', 'CREATE TABLE 未加 IF NOT EXISTS', '重跑任务时可能因表已存在而失败。');
    return risks;
  }

  function lineOf(sql, tokenIndex, tokens) {
    var t = tokens[tokenIndex];
    if (!t) return 1;
    var p = t.pos || 0;
    return sql.slice(0, p).split('\n').length;
  }

  // ---------- CTE outline ----------
  function extractCTEs(sql) {
    var tokens = tok(sql);
    var out = [];
    var inWith = false;
    for (var i = 0; i < tokens.length; i++) {
      var up = tokens[i].value.toUpperCase();
      if (up === 'WITH') { inWith = true; continue; }
      if (!inWith) continue;
      var nameTok = null, asIdx = -1;
      if ((tokens[i].type === 'word' || tokens[i].type === 'ident') && tokens[i + 1] && tokens[i + 1].value.toUpperCase() === 'AS' && tokens[i + 2] && tokens[i + 2].value === '(') {
        nameTok = tokens[i]; asIdx = i;
      }
      if (nameTok) {
        var depth = 0, end = i + 2;
        for (var j = i + 2; j < tokens.length; j++) {
          if (tokens[j].value === '(') depth++;
          else if (tokens[j].value === ')') { depth--; if (depth === 0) { end = j; break; } }
        }
        out.push({
          name: nameTok.value.replace(/^["`]/, '').replace(/["`]$/, ''),
          startToken: asIdx,
          endToken: end
        });
        i = end;
        if (!(tokens[i + 1] && tokens[i + 1].value === ',')) inWith = false;
      }
    }
    return out;
  }

  // token index -> line number in text (accurate via token.pos)
  function tokenLineMap(sql) {
    var tokens = tok(sql);
    var lineStarts = [0];
    for (var i = 0; i < sql.length; i++) if (sql[i] === '\n') lineStarts.push(i + 1);
    function lineOfPos(p) {
      var lo = 0, hi = lineStarts.length - 1;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= p) lo = mid; else hi = mid - 1;
      }
      return lo + 1;
    }
    var lines = [];
    for (var t = 0; t < tokens.length; t++) lines.push(lineOfPos(tokens[t].pos || 0));
    return lines;
  }
  function cteLines(sql) {
    var list = extractCTEs(sql), map = tokenLineMap(sql);
    return list.map(function (c) {
      return { name: c.name, start: map[c.startToken] || 1, end: map[c.endToken] || 1 };
    });
  }

  // ---------- line diff (LCS) ----------
  function normLine(s, opts) {
    var x = s;
    if (opts.ignoreCase) x = x.toLowerCase();
    if (opts.ignoreSpace) x = x.replace(/\s+/g, ' ').trim();
    return x;
  }
  function diff(a, b, opts) {
    opts = opts || {};
    var A = a.split(/\r?\n/), B = b.split(/\r?\n/);
    var n = A.length, m = B.length;
    if (n * m > 4000000) return { rows: [{ type: 'info', text: '内容过大，已跳过行级对比。' }], stats: { same: 0, add: 0, del: 0 } };
    var dp = [];
    for (var i = 0; i <= n; i++) { dp.push(new Uint32Array(m + 1)); }
    for (var x = n - 1; x >= 0; x--) {
      for (var y = m - 1; y >= 0; y--) {
        dp[x][y] = normLine(A[x], opts) === normLine(B[y], opts) ? dp[x + 1][y + 1] + 1 : Math.max(dp[x + 1][y], dp[x][y + 1]);
      }
    }
    var rows = [], i2 = 0, j2 = 0, same = 0, add = 0, del = 0;
    while (i2 < n || j2 < m) {
      if (i2 < n && j2 < m && normLine(A[i2], opts) === normLine(B[j2], opts)) {
        rows.push({ type: 'same', a: A[i2], b: B[j2], aNum: i2 + 1, bNum: j2 + 1 }); same++; i2++; j2++;
      } else if (j2 < m && (i2 >= n || dp[i2][j2 + 1] >= dp[i2 + 1][j2])) {
        rows.push({ type: 'add', b: B[j2], bNum: j2 + 1 }); add++; j2++;
      } else {
        rows.push({ type: 'del', a: A[i2], aNum: i2 + 1 }); del++; i2++;
      }
    }
    return { rows: rows, stats: { same: same, add: add, del: del } };
  }

  // ---------- SELECT -> DDL ----------
  function inferType(name, expr) {
    var s = (name + ' ' + (expr || '')).toLowerCase();
    if (/count|sum|_num|_cnt|qty|amount|total|id$|_id/.test(s)) return 'BIGINT';
    if (/avg|rate|ratio|price|money|amt|score/.test(s)) return 'DOUBLE';
    if (/dt|date|time|_at$/.test(s)) return 'STRING';
    return 'STRING';
  }
  function toDDL(sql, tableName, opts) {
    opts = opts || {};
    var refs = extractRefs(sql);
    var cols = refs.columns.filter(function (c) { return c.name && c.name.indexOf('.') === -1; });
    var name = (tableName || 'new_table').replace(/[^A-Za-z0-9_.]/g, '');
    if (!cols.length) return '-- 未能从 SELECT 中识别到字段，请手动补充。\nCREATE TABLE ' + name + ' (\n  col STRING\n);';
    var lines = cols.map(function (c) {
      return '  ' + c.name + ' ' + inferType(c.name, c.expr) + " COMMENT ''";
    });
    var head = 'CREATE TABLE IF NOT EXISTS ' + name + ' (\n' + lines.join(',\n') + '\n)\n';
    var tail = opts.storedAs ? 'STORED AS ' + opts.storedAs + ';' : ';';
    return head + tail;
  }

  var API = {
    scanVariables: scanVariables,
    replaceVariables: replaceVariables,
    idsToIn: idsToIn,
    extractRefs: extractRefs,
    scanRisks: scanRisks,
    extractCTEs: extractCTEs,
    cteLines: cteLines,
    diff: diff,
    toDDL: toDDL
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.SQLAnalysis = API;

})(typeof window !== 'undefined' ? window : globalThis);
