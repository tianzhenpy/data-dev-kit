/*
 * SQL Formatter core - zero dependency
 * Style: keywords upper-case, compact parentheses (never one-item-per-line),
 *        clause keywords start a new line, AND/OR indented on new line.
 * Dialects: generic / hive / spark / presto / clickhouse
 * Supports scheduler variables: ${bizdate}, ${hivevar:x}, :name, ?
 */
(function (global) {
  'use strict';

  var BASE_KEYWORDS = [
    'SELECT','FROM','WHERE','GROUP','BY','ORDER','HAVING','LIMIT','OFFSET','FETCH','FIRST','NEXT','ROWS','ROW','ONLY',
    'AND','OR','NOT','IN','IS','NULL','LIKE','ILIKE','BETWEEN','EXISTS','ALL','ANY','SOME',
    'JOIN','INNER','LEFT','RIGHT','FULL','OUTER','CROSS','NATURAL','ON','USING',
    'UNION','EXCEPT','INTERSECT','DISTINCT','AS','ASC','DESC','NULLS','LAST','FIRST',
    'CASE','WHEN','THEN','ELSE','END','OVER','PARTITION','WINDOW','QUALIFY','ILTER','FILTER',
    'INSERT','INTO','VALUES','UPDATE','SET','DELETE','RETURNING','MERGE','MATCHED',
    'CREATE','TABLE','VIEW','INDEX','ALTER','DROP','TRUNCATE','ADD','COLUMN','RENAME','TO','CONSTRAINT','PRIMARY','KEY','FOREIGN','REFERENCES','UNIQUE','CHECK','DEFAULT','CASCADE','RESTRICT','IF','EXISTS',
    'WITH','RECURSIVE','BEGIN','COMMIT','ROLLBACK','TRANSACTION','GRANT','REVOKE',
    'CAST','INTERVAL','TRUE','FALSE','ESCAPE','COLLATE','FOR','SHARE','LOCK','MODE','EXPLAIN','ANALYZE',
    'EXTRACT','SUBSTRING','TRIM','LEADING','TRAILING','BOTH','FOR'
  ];

  var BASE_FUNCTIONS = [
    'COUNT','SUM','AVG','MIN','MAX','COALESCE','IFNULL','NULLIF','ISNULL','NVL','DECODE',
    'ABS','ROUND','CEIL','CEILING','FLOOR','MOD','POWER','SQRT','EXP','LOG','LN','SIGN',
    'CONCAT','CONCAT_WS','SUBSTR','SUBSTRING','CHAR_LENGTH','CHARACTER_LENGTH','LENGTH','LOWER','UPPER','TRIM','LTRIM','RTRIM','REPLACE','REVERSE','LPAD','RPAD','INSTR','POSITION','LEFT','RIGHT',
    'NOW','CURRENT_DATE','CURRENT_TIME','CURRENT_TIMESTAMP','CURDATE','CURTIME','DATE','DATETIME','TIME','TIMESTAMP','YEAR','MONTH','DAY','HOUR','MINUTE','SECOND','DATE_FORMAT','STR_TO_DATE','DATEDIFF','DATE_ADD','DATE_SUB','UNIX_TIMESTAMP','FROM_UNIXTIME',
    'CAST','CONVERT','EXTRACT','GROUP_CONCAT','STRING_AGG','ARRAY_AGG','JSON_EXTRACT','JSON_VALUE','JSON_OBJECT','JSON_ARRAY',
    'ROW_NUMBER','RANK','DENSE_RANK','NTILE','LAG','LEAD','FIRST_VALUE','LAST_VALUE','NTH_VALUE',
    'GREATEST','LEAST','TO_CHAR','TO_DATE','TO_NUMBER','MD5','SHA1','SHA2','UUID','RANDOM','RAND'
  ];

  // dialect-specific additions
  var DIALECTS = {
    generic: { label: '通用 SQL', kw: [], fn: [], clauses: [] },
    hive: {
      label: 'Hive / Hadoop',
      kw: ['OVERWRITE','PARTITION','PARTITIONED','DISTRIBUTE','SORT','CLUSTER','BUCKET','BUCKETS','TBLPROPERTIES','SERDE','STORED','LOCATION','EXTERNAL','TEMPORARY','LATERAL','VIEW','SEMI','ANTI','REPLACE','COMMENT','REPAIR','MSCK','LOAD','INPATH','DIRECTORY','FIELDS','TERMINATED','ESCAPED','LINES','COLLECTION','ITEMS','KEYS','MAPS','ARRAY','STRUCT','MAP','REDUCE','TRANSFORM','INPUTFORMAT','OUTPUTFORMAT','ANALYZE','COMPUTE','STATISTICS','ROLLUP','CUBE','GROUPING','SETS','UNBOUNDED','PRECEDING','FOLLOWING','CURRENT','DAY','HOUR','MINUTE','MONTH','YEAR'],
      fn: ['EXPLODE','POSEXPLODE','LATERAL_VIEW','GET_JSON_OBJECT','JSON_TUPLE','PARSE_URL','PARSE_URL_TUPLE','COLLECT_SET','COLLECT_LIST','SORT_ARRAY','SIZE','MAP_KEYS','MAP_VALUES','ARRAY_CONTAINS','SPLIT','REGEXP_EXTRACT','REGEXP_REPLACE','RLIKE','NAMED_STRUCT','STACK','INLINE','PERCENTILE','PERCENTILE_APPROX','APPROX_COUNT_DISTINCT','HASH','CRC32','BASE64','UNBASE64','REFLECT','ASSERT_TRUE','NEXT_DAY','LAST_DAY','ADD_MONTHS','MONTHS_BETWEEN','TRUNC','TO_UNIX_TIMESTAMP','DATE_SUB','DATE_ADD'],
      clauses: [['INSERT','OVERWRITE','TABLE'],['DISTRIBUTE','BY'],['SORT','BY'],['CLUSTER','BY'],['LATERAL','VIEW'],['GROUP','BY'],['ORDER','BY']]
    },
    spark: {
      label: 'Spark SQL',
      kw: ['OVERWRITE','PARTITION','PARTITIONED','DISTRIBUTE','SORT','CLUSTER','BUCKET','BUCKETS','TBLPROPERTIES','SERDE','STORED','LOCATION','EXTERNAL','TEMPORARY','LATERAL','VIEW','CACHE','UNCACHE','REFRESH','REPARTITION','COALESCE','PERSIST','UNPERSIST','USING','OPTIONS','MERGE','MATCHED','DELETE','UPDATE','INSERT','DELTA','ROLLUP','CUBE','GROUPING','SETS','UNBOUNDED','PRECEDING','FOLLOWING','CURRENT','INTERVAL','TRY_CAST','NULLIF'],
      fn: ['EXPLODE','POSEXPLODE','GET_JSON_OBJECT','FROM_JSON','TO_JSON','COLLECT_SET','COLLECT_LIST','SORT_ARRAY','SIZE','MAP_KEYS','MAP_VALUES','ARRAY_CONTAINS','SPLIT','REGEXP_EXTRACT','REGEXP_REPLACE','RLIKE','NAMED_STRUCT','STACK','INLINE','APPROX_COUNT_DISTINCT','PERCENTILE_APPROX','DATE_TRUNC','TRUNC','LAST_DAY','NEXT_DAY','ADD_MONTHS','MONTHS_BETWEEN','SHA2','CRC32','BASE64','UNBASE64','REFLECT','ASSERT_TRUE','TRY_CAST'],
      clauses: [['INSERT','OVERWRITE','TABLE'],['DISTRIBUTE','BY'],['SORT','BY'],['CLUSTER','BY'],['LATERAL','VIEW'],['GROUP','BY'],['ORDER','BY']]
    },
    presto: {
      label: 'Presto / Trino',
      kw: ['UNNEST','LATERAL','CROSS','TABLESAMPLE','BERNOULLI','SYSTEM','PREPARE','EXECUTE','DEALLOCATE','ROLLUP','CUBE','GROUPING','SETS','UNBOUNDED','PRECEDING','FOLLOWING','CURRENT','RUNNING','WITHIN','FILTER','OVER','SKIP','NULLS','IMPLICIT','EXPLICIT','TRY_CAST','CATALOGS','SCHEMAS','COLUMNS'],
      fn: ['APPROX_DISTINCT','APPROX_PERCENTILE','ARRAY_AGG','MAP_AGG','MULTIMAP_AGG','ARBITRARY','UNNEST','ARRAY_JOIN','ARRAY_EXCEPT','ARRAY_INTERSECT','ARRAY_DISTINCT','CARDINALITY','CONTAINS','ELEMENT_AT','SLICE','ZIP','ZIP_WITH','JSON_EXTRACT_SCALAR','JSON_ARRAY_GET','CAST','TRY_CAST','DATE_TRUNC','DATE_DIFF','INTERVAL','NOW','CURRENT_DATE','FROM_ISO8601_TIMESTAMP','TO_ISO8601','REGEXP_LIKE','REGEXP_REPLACE','SPLIT','SPLIT_PART','NORMALIZE','SHA256','MD5','TO_HEX','FROM_BASE64'],
      clauses: [['UNNEST'],['CROSS','JOIN','LATERAL'],['GROUP','BY'],['ORDER','BY']]
    },
    clickhouse: {
      label: 'ClickHouse',
      kw: ['PREWHERE','FINAL','SAMPLE','SETTINGS','GLOBAL','ARRAY','JOIN','ANY','ALL','ASOF','LEFT','RIGHT','INNER','CROSS','ENGINE','PARTITION','PRIMARY','KEY','ORDER','TTL','MATERIALIZED','POPULATE','TOTALS','WITH','FORMAT','LIMIT','BY','UNBOUNDED','PRECEDING','FOLLOWING','CURRENT','SEMI','ANTI','ILIKE','GLOBAL','NOT','INTO','OUTFILE'],
      fn: ['toDate','toDateTime','toInt32','toInt64','toFloat64','toString','toUInt32','toUInt64','toDecimal64','arrayJoin','arrayMap','arrayFilter','arrayReduce','arraySum','arrayExists','arrayCount','arrayFirst','arraySort','arrayDistinct','arrayFlatten','arrayConcat','has','indexOf','count','uniq','uniqExact','uniqCombined','quantile','quantiles','median','argMax','argMin','sumIf','countIf','avgIf','groupArray','groupUniqArray','groupArrayInsertAt','JSONExtractString','JSONExtractInt','JSONExtractRaw','visitParamExtractString','formatDateTime','dateDiff','addDays','subDays','startOfMonth','endOfMonth','toStartOfDay','toStartOfHour','multiIf','ifNull','nullIf','assumeNotNull','isNull','isNotNull','neighbor','runningAccumulate','windowFunnel','sequenceCount','dictGet'],
      clauses: [['PREWHERE'],['ARRAY','JOIN'],['GLOBAL','JOIN'],['LIMIT','BY'],['GROUP','BY'],['ORDER','BY'],['WITH','TOTALS']]
    }
  };

  var BASE_CLAUSE_PHRASES = [
    ['LEFT','OUTER','JOIN'], ['RIGHT','OUTER','JOIN'], ['FULL','OUTER','JOIN'],
    ['NATURAL','LEFT','JOIN'], ['NATURAL','RIGHT','JOIN'],
    ['INSERT','INTO'], ['DELETE','FROM'], ['CREATE','TABLE'], ['CREATE','VIEW'], ['CREATE','INDEX'],
    ['ALTER','TABLE'], ['DROP','TABLE'], ['DROP','VIEW'], ['TRUNCATE','TABLE'],
    ['GROUP','BY'], ['ORDER','BY'], ['UNION','ALL'],
    ['INNER','JOIN'], ['CROSS','JOIN'], ['LEFT','JOIN'], ['RIGHT','JOIN'], ['FULL','JOIN'], ['NATURAL','JOIN'],
    ['SELECT'],['FROM'],['WHERE'],['HAVING'],['LIMIT'],['OFFSET'],['RETURNING'],['VALUES'],['UPDATE'],['SET'],
    ['UNION'],['EXCEPT'],['INTERSECT'],['WINDOW'],['QUALIFY'],['JOIN']
  ];

  var SPACE_BEFORE_PAREN = new Set([
    'IN','VALUES','EXISTS','ALL','ANY','SOME','NOT','AND','OR','ON','USING','CHECK','BY','THEN','ELSE','AS','OVER','WHEN','WHERE','SELECT','FROM','IF','CASE','LIKE','BETWEEN'
  ]);

  function makeContext(dialect) {
    var d = DIALECTS[dialect] || DIALECTS.generic;
    var kw = new Set(BASE_KEYWORDS);
    var fn = new Set(BASE_FUNCTIONS);
    d.kw.forEach(function (w) { kw.add(w); });
    d.fn.forEach(function (w) { fn.add(w); });
    var clauses = BASE_CLAUSE_PHRASES.concat(d.clauses || []);
    // dedupe clauses
    var seen = {}, uniq = [];
    clauses.forEach(function (p) { var k = p.join(' '); if (!seen[k]) { seen[k] = 1; uniq.push(p); } });
    uniq.sort(function (a, b) { return b.length - a.length; });
    return { kw: kw, fn: fn, clauses: uniq };
  }

  function isWordChar(c) { return /[A-Za-z0-9_@#$]/.test(c); }

  function tokenize(sql) {
    var tokens = [], i = 0, n = sql.length, c, j;
    function push(type, value) { tokens.push({ type: type, value: value, pos: i }); }
    while (i < n) {
      c = sql[i];
      if (/\s/.test(c)) { i++; continue; }

      if (c === '-' && sql[i + 1] === '-') {
        j = i + 2; while (j < n && sql[j] !== '\n') j++;
        j = Math.min(j, n);
        push('comment', sql.slice(i, j)); i = j; continue;
      }
      if (c === '/' && sql[i + 1] === '*') {
        j = i + 2; while (j < n && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
        j = Math.min(j + 2, n);
        push('comment', sql.slice(i, j)); i = j; continue;
      }
      // scheduler variable ${...}, #{...}, %{...}
      if ((c === '$' || c === '#' || c === '%') && sql[i + 1] === '{') {
        j = i + 2; while (j < n && sql[j] !== '}') j++;
        j = Math.min(j + 1, n);
        push('var', sql.slice(i, j)); i = j; continue;
      }
      // bind variable :name
      if (c === ':' && /[A-Za-z_]/.test(sql[i + 1] || '')) {
        j = i + 2; while (j < n && isWordChar(sql[j])) j++;
        push('var', sql.slice(i, j)); i = j; continue;
      }
      if (c === "'") {
        j = i + 1;
        while (j < n) {
          if (sql[j] === "'") {
            if (sql[j + 1] === "'") { j += 2; continue; }
            j++; break;
          }
          j++;
        }
        push('string', sql.slice(i, j)); i = j; continue;
      }
      if (c === '"' || c === '`') {
        var q = c; j = i + 1;
        while (j < n) {
          if (sql[j] === q) {
            if (sql[j + 1] === q) { j += 2; continue; }
            j++; break;
          }
          j++;
        }
        push('ident', sql.slice(i, j)); i = j; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
        j = i;
        while (j < n) {
          if (/[0-9.]/.test(sql[j])) { j++; continue; }
          if ((sql[j] === 'e' || sql[j] === 'E')) {
            if (sql[j + 1] === '+' || sql[j + 1] === '-') { j += 2; continue; }
            j++; continue;
          }
          break;
        }
        push('number', sql.slice(i, j)); i = j; continue;
      }
      if (/[A-Za-z_@#$]/.test(c)) {
        j = i; while (j < n && isWordChar(sql[j])) j++;
        push('word', sql.slice(i, j)); i = j; continue;
      }
      var two = sql.substr(i, 2);
      var ops2 = ['<=','>=','<>','!=','||','::','->','=>','+=','-=','*=','/=','%=','&&','!~','~*','!='];
      if (ops2.indexOf(two) !== -1) { push('op', two); i += 2; continue; }
      if ('=<>+-*/%!~^&|?'.indexOf(c) !== -1) { push('op', c); i++; continue; }
      if ('(),;.[]:'.indexOf(c) !== -1) { push('punc', c); i++; continue; }
      push('raw', c); i++;
    }
    return tokens;
  }

  function matchPhrase(tokens, i, clauses) {
    for (var p = 0; p < clauses.length; p++) {
      var phrase = clauses[p];
      if (i + phrase.length > tokens.length) continue;
      var ok = true;
      for (var k = 0; k < phrase.length; k++) {
        var t = tokens[i + k];
        if (t.type !== 'word' || t.value.toUpperCase() !== phrase[k]) { ok = false; break; }
      }
      if (ok) return phrase.length;
    }
    return 0;
  }

  function defaultSpace(t, prev, KW, FN) {
    if (!prev) return false;
    var v = t.value;
    if (v === ',' || v === ')' || v === ';' || v === '.') return false;
    if (prev.value === '(' || prev.value === '.') return false;
    if (v === '(') {
      if (prev.type === 'word') {
        var u = prev.value.toUpperCase();
        if (KW.has(u) && !FN.has(u) && SPACE_BEFORE_PAREN.has(u)) return true;
        if (KW.has(u) && !FN.has(u)) return true;
        return false;
      }
      return true;
    }
    if (t.type === 'op') return true;
    if (prev.type === 'op') return true;
    return true;
  }

  function tokenClass(t, next, KW, FN) {
    if (t.type === 'comment') return 'com';
    if (t.type === 'string') return 'str';
    if (t.type === 'ident') return 'qid';
    if (t.type === 'var') return 'var';
    if (t.type === 'number') return 'num';
    if (t.type === 'op') return 'op';
    if (t.type === 'word') {
      var u = t.value.toUpperCase();
      if (KW.has(u)) {
        if (next && next.value === '(' && FN.has(u)) return 'fn';
        return 'kw';
      }
      if (next && next.value === '(') return 'fn';
      return 'id';
    }
    return 'plain';
  }

  // 数一数从 start 开始、同一层里有多少个逗号分隔的字段（用于决定 SELECT 列表是否一字段一行）
  function countFields(tokens, start, clauses) {
    var depth = 0, n = 0;
    for (var i = start; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.type === 'word' && depth === 0 && matchPhrase(tokens, i, clauses) > 0) break;
      if (t.value === '(') depth++;
      else if (t.value === ')') { if (depth === 0) break; depth--; }
      else if (t.value === ';' && depth === 0) break;
      else if (t.value === ',' && depth === 0) n++;
    }
    return n + 1;
  }

  function wrapLongLines(lines, maxWidth, indentSize) {
    var out = [];
    for (var li = 0; li < lines.length; li++) {
      var ln = lines[li];
      var len = ln.indent * indentSize;
      for (var q = 0; q < ln.parts.length; q++) len += ln.parts[q].text.length;
      if (len <= maxWidth) { out.push(ln); continue; }
      var cur = { indent: ln.indent, parts: [] };
      var curLen = ln.indent * indentSize;
      var depth = 0;
      for (var pi = 0; pi < ln.parts.length; pi++) {
        var p = ln.parts[pi];
        cur.parts.push(p);
        curLen += p.text.length;
        var v = p.text.trim();
        if (v === '(') depth++;
        else if (v === ')') depth = Math.max(0, depth - 1);
        if (v === ',' && depth === 0 && curLen > maxWidth * 0.65) {
          out.push(cur);
          cur = { indent: ln.indent + 1, parts: [] };
          curLen = (ln.indent + 1) * indentSize;
        }
      }
      if (cur.parts.length) out.push(cur);
    }
    return out;
  }

  function format(sql, options) {
    options = options || {};
    var upper = options.upper !== false;
    var indentSize = options.indentSize || 2;
    var clauseLines = options.clauseLines !== false;
    var wrapLogic = options.wrapLogic !== false;
    var maxWidth = options.maxWidth || 100;
    var fieldPerLine = options.fieldPerLine !== false;   // SELECT 列表一字段一行
    var casePerLine = options.casePerLine !== false;     // CASE 每个 WHEN 一行
    var ctx = makeContext(options.dialect || 'generic');
    var KW = ctx.kw, FN = ctx.fn, CLAUSES = ctx.clauses;

    var tokens = tokenize(sql);
    var lines = [];
    var cur = { indent: 0, parts: [] };
    var prev = null;
    var parenDepth = 0, caseDepth = 0, betweenPending = 0;
    // statement level: clauses live at parenDepth === stmtLevel (0 = top, N = inside CTE body)
    var stmtLevel = 0, stmtIndent = 0, cteStack = [], afterCteClose = false;
    var caseStack = [];                       // CASE 起始行缩进
    var listDepth = -1, listIndent = 0;       // 正在拆行的字段列表（-1 表示无）

    function newLine(level) {
      if (cur.parts.length) lines.push(cur);
      cur = { indent: level, parts: [] };
      prev = null;
    }
    function add(t, cls, forceSpace) {
      var space = forceSpace === undefined ? defaultSpace(t, prev, KW, FN) : forceSpace;
      var text = (cur.parts.length && space ? ' ' : '') + t.value;
      cur.parts.push({ text: text, cls: cls });
      prev = t;
    }
    function w(v) { return upper ? v.toUpperCase() : v.toLowerCase(); }

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var next = tokens[i + 1];
      var up = (t.type === 'word') ? t.value.toUpperCase() : '';

      // multi-word clause (at statement level: top query or CTE body)
      if (clauseLines && parenDepth === stmtLevel && caseDepth === 0) {
        var plen = matchPhrase(tokens, i, CLAUSES);
        if (plen > 0) {
          listDepth = -1;
          newLine(stmtIndent);
          for (var k = 0; k < plen; k++) {
            var pt = tokens[i + k];
            add({ type: pt.type, value: w(pt.value) }, 'kw', k > 0);
          }
          i += plen - 1;
          // SELECT 列表：字段多于 1 个时一字段一行（DISTINCT / ALL 留在 SELECT 这一侧）
          if (fieldPerLine && plen === 1 && tokens[i].value.toUpperCase() === 'SELECT') {
            while (i + 1 < tokens.length && tokens[i + 1].type === 'word' &&
                   /^(DISTINCT|ALL|UNIQUE)$/.test(tokens[i + 1].value.toUpperCase())) {
              i++;
              add({ type: 'word', value: w(tokens[i].value) }, 'kw');
            }
            if (countFields(tokens, i + 1, CLAUSES) > 1) {
              listDepth = parenDepth;
              listIndent = stmtIndent + 1;
              newLine(listIndent);
            }
          }
          continue;
        }
      }

      // AND / OR (statement level only, not BETWEEN, not inside CASE)
      if (wrapLogic && parenDepth === stmtLevel && caseDepth === 0 && t.type === 'word' && (up === 'AND' || up === 'OR')) {
        if (betweenPending > 0) { betweenPending--; add({ type: 'word', value: w(up) }, 'kw'); continue; }
        newLine(stmtIndent + 1);
        add({ type: 'word', value: w(up) }, 'kw');
        continue;
      }

      // CASE ... WHEN ... ELSE ... END：一个 WHEN 一行，ELSE 一行，END 与 CASE 对齐
      if (t.type === 'word' && up === 'CASE') {
        add({ type: 'word', value: w(up) }, 'kw');
        caseDepth++;
        caseStack.push(cur.indent);
        continue;
      }
      if (t.type === 'word' && up === 'WHEN' && caseDepth > 0) {
        if (casePerLine) {
          var cbase = caseStack[caseStack.length - 1];
          if (cur.parts.length) newLine(cbase + 1);
        }
        add({ type: 'word', value: w(up) }, 'kw');
        continue;
      }
      if (t.type === 'word' && up === 'THEN' && caseDepth > 0) {
        add({ type: 'word', value: w(up) }, 'kw');
        continue;
      }
      if (t.type === 'word' && up === 'ELSE' && caseDepth > 0) {
        if (casePerLine) newLine(caseStack[caseStack.length - 1] + 1);
        add({ type: 'word', value: w(up) }, 'kw');
        continue;
      }
      if (t.type === 'word' && up === 'END' && caseDepth > 0) {
        var cend = caseStack.pop();
        caseDepth--;
        if (casePerLine) newLine(cend);
        add({ type: 'word', value: w(up) }, 'kw');
        continue;
      }

      // 字段列表：同层逗号后换行（配合 SELECT 一字段一行）
      if (listDepth >= 0 && t.value === ',' && parenDepth === listDepth) {
        add(t, 'punc');
        newLine(listIndent);
        continue;
      }

      if (t.type === 'word' && up === 'BETWEEN' && caseDepth === 0) betweenPending++;

      // CTE body open: `AS (` at statement level -> body on its own lines
      if (t.value === '(' && parenDepth === stmtLevel && prev && prev.type === 'word' && prev.value.toUpperCase() === 'AS') {
        add(t, 'punc');
        parenDepth++;
        cteStack.push([stmtLevel, stmtIndent]);
        stmtLevel = parenDepth;
        stmtIndent = stmtIndent + 1;
        newLine(stmtIndent);
        continue;
      }

      // CTE body close: `)` gets its own line at the CTE header level
      if (t.value === ')' && cteStack.length && parenDepth === stmtLevel) {
        listDepth = -1;
        newLine(stmtIndent - 1);
        parenDepth--;
        add(t, 'punc');
        var sv = cteStack.pop();
        stmtLevel = sv[0]; stmtIndent = sv[1];
        afterCteClose = true;
        continue;
      }

      // comma right after a CTE close: `),` then next CTE name starts a new line
      if (afterCteClose && t.value === ',') {
        add(t, 'punc');
        newLine(stmtIndent);
        afterCteClose = false;
        continue;
      }
      afterCteClose = false;

      if (t.value === '(') { add(t, 'punc'); parenDepth++; continue; }
      if (t.value === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        if (listDepth >= 0 && parenDepth < listDepth) listDepth = -1;
        add(t, 'punc');
        continue;
      }

      // `--` 注释会吃掉本行剩余内容，因此注释后必须换行；否则后面的 CTE 名 /
      // 字段会被拼进注释里（典型症状：整段 WITH 定义被注释掉，SQL 直接失效）
      if (t.type === 'comment') {
        var isDash = t.value.slice(0, 2) === '--';
        // 注释是不是独占一行：输出行首（cur 为空）或源码里它前面就换过行
        var onOwnLine = cur.parts.length === 0;
        if (!onOwnLine && i > 0) {
          var prevTok = tokens[i - 1];
          onOwnLine = sql.slice(prevTok.pos + prevTok.value.length, t.pos).indexOf('\n') !== -1;
        }
        if (onOwnLine && cur.parts.length) newLine(cur.indent);
        add({ type: 'comment', value: t.value }, 'com');
        if (isDash || onOwnLine) newLine(cur.indent);
        continue;
      }

      var cls = tokenClass(t, next, KW, FN);
      var val = t.value;
      if (t.type === 'word' && upper) {
        val = (KW.has(up) || FN.has(up)) ? up : t.value;
      }
      add({ type: t.type, value: val }, cls);

      // newline after semicolon if more tokens follow
      if (t.value === ';' && i + 1 < tokens.length) {
        newLine(0);
        stmtLevel = 0; stmtIndent = 0; cteStack = []; afterCteClose = false;
        caseStack = []; caseDepth = 0; betweenPending = 0; listDepth = -1;
      }
    }
    if (cur.parts.length) lines.push(cur);

    lines = wrapLongLines(lines, maxWidth, indentSize);
    var text = lines.map(function (ln) {
      return ' '.repeat(ln.indent * indentSize) + ln.parts.map(function (p) { return p.text; }).join('');
    }).join('\n');

    return { text: text, lines: lines, indentSize: indentSize };
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function toHtml(result) {
    var ind = ' '.repeat(result.indentSize);
    return result.lines.map(function (ln) {
      var lead = ind.repeat(ln.indent);
      var body = ln.parts.map(function (p) {
        return '<span class="t-' + (p.cls || 'plain') + '">' + escapeHtml(p.text) + '</span>';
      }).join('');
      return lead + body;
    }).join('\n');
  }

  var API = {
    format: format,
    tokenize: tokenize,
    toHtml: toHtml,
    getDialects: function () {
      var out = [];
      Object.keys(DIALECTS).forEach(function (k) { out.push({ id: k, label: DIALECTS[k].label }); });
      return out;
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.SQLFmt = API;

})(typeof window !== 'undefined' ? window : globalThis);
