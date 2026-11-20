/*  profiler.js — 数据探查 SQL 生成器
    零依赖，依赖 modeldoc.js（有建表语句时解析字段；只有表名时生成通用探查）
    用法：Profiler.build(input, opts) -> { sql, tables, stats, errors }
    opts: dialect(hive|mysql) partVar('${bizdate}') limit(20) topN(20)
          checks: {count, nulls, numeric, enum, dup, sample}
*/
(function (global) {
  'use strict';

  var ENUM_RE = /(type|status|flag|channel|source|level|category|brand|region|city|province|gender|state|是否|方式|渠道|状态|类型|等级|分类)/i;
  var AMOUNT_RE = /(amt|amount|price|fee|cost|money|payment|gmv|sales|discount|tax|balance|revenue)/i;
  var KEY_RE = /(^id$|_id$|_no$|_code$|_key$|_uuid$|_sn$)/i;
  var DATE_NAME_RE = /(_date|_dt$|_day$|_time$|_ts$|^dt$|^ds$)/i;

  function lc(s) { return String(s == null ? '' : s).toLowerCase(); }
  function q(name) { return '`' + String(name).replace(/`/g, '') + '`'; }
  function qtable(full) {
    return String(full).split('.').map(function (p) { return '`' + p.replace(/`/g, '') + '`'; }).join('.');
  }
  function typeBase(t) { return lc(t).replace(/\(.*$/, '').replace(/<.*$/, '').trim(); }
  function isNumeric(t) { return /^(tinyint|smallint|int|integer|bigint|long|float|double|decimal|numeric|number|real)$/.test(typeBase(t)); }
  function isString(t) { return /^(string|varchar|char|text)$/.test(typeBase(t)); }
  function isDate(t) { return /^(date|datetime|timestamp|time)$/.test(typeBase(t)); }

  function lit(v) {
    var s = String(v == null ? '' : v);
    if (/^'.*'$/.test(s)) return s;
    return "'" + s.replace(/'/g, "''") + "'";
  }

  function tableNames(input) {
    var text = String(input || '').trim();
    if (!text) return [];
    return text.split(/[\r\n,;]+/).map(function (s) { return s.trim().replace(/^['"`]|['"`]$/g, ''); })
      .filter(function (s) { return s && !/^--/.test(s); })
      .filter(function (s) { return /^[\w.$-]+$/.test(s); });
  }

  function buildTableSql(t, o) {
    var secNo = 0;
    function sec(title) { secNo++; out.push('-- ' + secNo + ') ' + title); }
    var out = [];
    var full = t.full;
    var tbl = qtable(full);
    var partCol = (t.partitions && t.partitions[0]) ? t.partitions[0].name : '';
    var where = partCol ? 'WHERE ' + q(partCol) + ' = ' + lit(o.partVar) : '';
    var whereOneLine = where ? ' ' + where : '';

    out.push('-- ==================== ' + full + ' ====================');
    out.push('-- ' + (t.comment || t.cn || '无表注释') + ' · 字段 ' + t.cols.length +
      ' · 分区 ' + ((t.partitions || []).map(function (p) { return p.name; }).join(', ') || '无'));
    out.push('');

    if (o.checks.count !== false) {
      sec('行数 / 分区范围');
      out.push('SELECT');
      var cl = ['  COUNT(1) AS row_cnt'];
      if (partCol) {
        cl.push('  COUNT(DISTINCT ' + q(partCol) + ') AS partition_cnt');
        cl.push('  MIN(' + q(partCol) + ') AS min_partition');
        cl.push('  MAX(' + q(partCol) + ') AS max_partition');
      }
      out.push(cl.join(',\n'));
      out.push('FROM ' + tbl);
      if (where) out.push(where);
      out.push(';');
      out.push('');
    }

    if (t.cols.length && o.checks.nulls !== false) {
      sec('空值率 / 基数（每个字段一行，UNION ALL；大表可分字段单独执行）');
      var nb = t.cols.map(function (c) {
        var e = isString(c.type) ? '(' + q(c.name) + " IS NULL OR TRIM(" + q(c.name) + ") = '')" : (q(c.name) + ' IS NULL');
        return ['SELECT ' + lit(c.name) + ' AS col_name,',
          '  COUNT(1) AS row_cnt,',
          '  SUM(CASE WHEN ' + e + ' THEN 1 ELSE 0 END) AS null_cnt,',
          '  ROUND(SUM(CASE WHEN ' + e + ' THEN 1 ELSE 0 END) * 1.0 / COUNT(1), 6) AS null_rate,',
          '  COUNT(DISTINCT ' + q(c.name) + ') AS distinct_cnt',
          'FROM ' + tbl].concat(where ? [where] : []).join('\n');
      });
      out.push(nb.join('\nUNION ALL\n'));
      out.push(';');
      out.push('');
    }

    var nums = t.cols.filter(function (c) { return isNumeric(c.type); });
    if (nums.length && o.checks.numeric !== false) {
      sec('数值分布（极值 / 均值 / 负值，每个字段一行）');
      var nl = nums.map(function (c) {
        return ['SELECT ' + lit(c.name) + ' AS col_name,',
          '  COUNT(1) AS row_cnt,',
          '  CAST(MIN(' + q(c.name) + ') AS DOUBLE) AS min_val,',
          '  CAST(MAX(' + q(c.name) + ') AS DOUBLE) AS max_val,',
          '  CAST(AVG(' + q(c.name) + ') AS DOUBLE) AS avg_val,',
          '  SUM(CASE WHEN ' + q(c.name) + ' < 0 THEN 1 ELSE 0 END) AS neg_cnt',
          'FROM ' + tbl].concat(where ? [where] : []).join('\n');
      });
      out.push(nl.join('\nUNION ALL\n'));
      out.push(';');
      out.push('');
    }

    var amounts = t.cols.filter(function (c) { return AMOUNT_RE.test(c.name) && isNumeric(c.type); });
    if (amounts.length) {
      sec('金额口径核对');
      out.push('SELECT');
      out.push('  COUNT(1) AS row_cnt,');
      out.push(amounts.map(function (c) {
        return '  ROUND(SUM(' + q(c.name) + '), 2) AS ' + q(c.name + '__sum');
      }).join(',\n'));
      out.push('FROM ' + tbl);
      if (where) out.push(where);
      out.push(';');
      out.push('');
    }

    var enums = t.cols.filter(function (c) {
      return (isString(c.type) || typeBase(c.type) === 'boolean') && ENUM_RE.test(c.name);
    }).slice(0, 8);
    if (enums.length && o.checks.enum !== false) {
      sec('枚举分布 TopN');
      enums.forEach(function (c) {
        out.push('SELECT ' + q(c.name) + ' AS val, COUNT(1) AS cnt');
        out.push('FROM ' + tbl);
        if (where) out.push(where);
        out.push('GROUP BY ' + q(c.name));
        out.push('ORDER BY cnt DESC');
        out.push('LIMIT ' + (o.topN || 20) + ';');
        out.push('');
      });
    }

    var keys = t.cols.filter(function (c) { return KEY_RE.test(c.name); });
    if (keys.length && o.checks.dup !== false) {
      var keyCols = keys.length <= 3 ? keys : keys.slice(0, 3);
      sec('主键唯一性（重复 TopN）');
      out.push('SELECT');
      out.push(keyCols.map(function (c) { return '  ' + q(c.name); }).join(',\n') + ',');
      out.push('  COUNT(1) AS dup_cnt');
      out.push('FROM ' + tbl);
      if (where) out.push(where);
      out.push('GROUP BY ' + keyCols.map(function (c) { return q(c.name); }).join(', '));
      out.push('HAVING COUNT(1) > 1');
      out.push('ORDER BY dup_cnt DESC');
      out.push('LIMIT ' + (o.limit || 20) + ';');
      out.push('');
    }

    var dates = t.cols.filter(function (c) { return isDate(c.type) || DATE_NAME_RE.test(c.name); }).slice(0, 6);
    if (dates.length && o.checks.nulls !== false) {
      sec('时间字段范围');
      out.push('SELECT');
      out.push(dates.map(function (c) {
        return '  MIN(' + q(c.name) + ') AS ' + q(c.name + '__min') + ', MAX(' + q(c.name) + ') AS ' + q(c.name + '__max');
      }).join(',\n'));
      out.push('FROM ' + tbl);
      if (where) out.push(where);
      out.push(';');
      out.push('');
    }

    if (o.checks.sample !== false) {
      sec('抽样预览');
      out.push('SELECT *');
      out.push('FROM ' + tbl);
      if (where) out.push(where);
      out.push('LIMIT ' + (o.limit || 20) + ';');
      out.push('');
    }

    return out.join('\n');
  }

  function build(input, opts) {
    opts = opts || {};
    var o = {
      dialect: opts.dialect === 'mysql' ? 'mysql' : 'hive',
      partVar: opts.partVar == null || opts.partVar === '' ? '${bizdate}' : opts.partVar,
      limit: Math.max(1, parseInt(opts.limit, 10) || 20),
      topN: Math.max(1, parseInt(opts.topN, 10) || 20),
      checks: opts.checks || {}
    };
    var text = String(input || '').trim();
    if (!text) throw new Error('请粘贴建表语句或输入表名');

    var parsed = { tables: [], errors: [] };
    if (/create\s+(?:or\s+replace\s+)?(?:external\s+)?table/i.test(text)) {
      var m = global.ModelDoc;
      if (!m) throw new Error('modeldoc.js 未加载');
      parsed = m.parse(text, {});
      if (!parsed.tables.length) {
        throw new Error(parsed.errors.length ? parsed.errors[0].message : '没有识别到 CREATE TABLE 语句');
      }
    } else {
      tableNames(text).forEach(function (n) {
        var short = n.split('.').pop();
        parsed.tables.push({ full: n, name: short, short: short, comment: '', cols: [], partitions: [] });
      });
      if (!parsed.tables.length) throw new Error('没有识别到表名，请每行一个表名或用逗号分隔');
    }

    var blocks = [], cols = 0;
    parsed.tables.forEach(function (t) {
      cols += t.cols.length;
      blocks.push(buildTableSql(t, o));
    });
    var head = '-- 数据探查脚本 · ' + (o.dialect === 'mysql' ? 'MySQL' : 'Hive') + ' · 生成于 ' + new Date().toLocaleString('zh-CN') + '\n' +
      '-- 共 ' + parsed.tables.length + ' 张表 · ' + cols + ' 个字段 · 分区变量 ' + o.partVar + '\n' +
      '-- 说明：按需替换分区变量后执行；大表建议先在采样分区跑一遍\n';
    var sql = head + '\n' + blocks.join('\n');

    return {
      sql: sql,
      tables: parsed.tables,
      errors: parsed.errors,
      stats: { tables: parsed.tables.length, cols: cols, lines: sql.split('\n').length }
    };
  }

  global.Profiler = { build: build, _tableNames: tableNames };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Profiler;
})(typeof window !== 'undefined' ? window : globalThis);