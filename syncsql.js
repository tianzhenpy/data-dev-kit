/*  syncsql.js — 同步 SQL 生成（DDL / 全量 / 增量 / 拉链表）
    零依赖，依赖 modeldoc.js 的 window.ModelDoc.parse
    用法：SyncSQL.build(ddlText, opts) -> { ddL, full, incr, zip, stats, src, dst, errors }
    opts: dialect(hive|spark|mysql) var('${bizdate}') format(ORC|PARQUET|TEXTFILE)
          target('' 目标表) pk('') incrField('') compare('' 逗号分隔对比字段)
*/
(function (global) {
  'use strict';

  function MD() {
    var m = global.ModelDoc;
    if (!m) throw new Error('modeldoc.js 未加载');
    return m;
  }

  function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
  function esc(s) { return String(s == null ? '' : s).replace(/'/g, "''"); }
  function dbOf(t) { var i = t.full.indexOf('.'); return i < 0 ? '' : t.full.slice(0, i); }
  function shortOf(t) { var i = t.full.lastIndexOf('.'); return i < 0 ? t.full : t.full.slice(i + 1); }

  function maxLen(list) {
    var n = 1;
    for (var i = 0; i < list.length; i++) n = Math.max(n, String(list[i]).length);
    return n;
  }

  function mysqlType(type) {
    var t = String(type || 'string').toLowerCase();
    if (/^varchar/.test(t) || /^char/.test(t)) return type;
    if (/^(tinyint|smallint|int|integer|bigint)/.test(t)) return t.replace('integer', 'int');
    if (/^(float|double|decimal|numeric)/.test(t)) return t;
    if (/^date$/.test(t) || /^datetime$/.test(t) || /^timestamp$/.test(t)) return t === 'date' ? 'date' : 'datetime';
    return 'varchar(255)';
  }

  function guessPk(t) {
    var names = t.cols.map(function (c) { return c.name; });
    var hit = names.filter(function (n) { return n === 'id'; })[0];
    if (hit) return hit;
    hit = names.filter(function (n) { return /_id$/.test(n); })[0];
    return hit || (names[0] || 'id');
  }

  function guessIncr(t) {
    var re = /(update|modify|modif|upd|etl|last).*(time|date|ts)$|^(update_time|modified_time|modify_time|etl_time)$/i;
    var hit = t.cols.filter(function (c) { return re.test(c.name); })[0];
    return hit ? hit.name : '';
  }

  function cloneTable(t, full, cn) {
    return {
      name: shortOf({ full: full }), full: full, cn: cn || t.cn, layer: t.layer,
      comment: t.comment, desc: t.desc, grain: t.grain, source: t.source,
      cols: t.cols.map(function (c) { return { name: c.name, type: c.type, comment: c.comment, partition: false }; }),
      partitions: t.partitions.map(function (c) { return { name: c.name, type: c.type, comment: c.comment, partition: true }; })
    };
  }

  function findTable(tables, name) {
    var n = String(name).trim().toLowerCase();
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      if (t.full.toLowerCase() === n || t.name.toLowerCase() === n) return t;
    }
    return null;
  }

  function partClause(t, v) {
    if (!t.partitions.length) return '';
    return ' PARTITION (' + t.partitions.map(function (p) { return p.name + " = '" + v + "'"; }).join(', ') + ')';
  }

  function srcPartCond(t, v) {
    if (!t.partitions.length) return '1 = 1';
    return t.partitions.map(function (p) { return p.name + " = '" + v + "'"; }).join('\n  AND ');
  }

  function selExpr(src, col, alias) {
    var hit = src.cols.filter(function (c) { return c.name === col.name; })[0];
    var pre = alias ? alias + '.' : '';
    return hit ? pre + col.name : 'NULL';
  }

  function condList(t, v, alias, incrField) {
    var list = [];
    var pre = alias ? alias + '.' : '';
    t.partitions.forEach(function (p) { list.push(pre + p.name + " = '" + v + "'"); });
    if (incrField) list.push(pre + incrField + " >= '" + v + "'");
    return list;
  }

  function changedExpr(cmpCols, a, b) {
    if (!cmpCols.length) return '1 = 0';
    return 'NOT (' + cmpCols.map(function (c) { return a + '.' + c + ' <=> ' + b + '.' + c; }).join(' AND ') + ')';
  }

  function zipCols(dst, cmp) {
    return dst.cols.filter(function (c) { return c.name !== 'start_date' && c.name !== 'end_date'; });
  }

  /* ---------------- DDL ---------------- */
  function genDDL(src, dst, o) {
    var v = o.var, out = [];
    out.push('-- ============================================================');
    out.push('-- 目标表建表语句（自动生成）');
    out.push('-- 源表  ：' + src.full + (src.cn ? '   ' + src.cn : ''));
    out.push('-- 目标表：' + dst.full + (dst.cn ? '   ' + dst.cn : ''));
    out.push('-- ============================================================');

    if (o.dialect === 'mysql') {
      var w = maxLen(dst.cols.map(function (c) { return c.name; }));
      var body = dst.cols.map(function (c) {
        var line = '  `' + c.name + '`' + new Array(w - c.name.length + 1).join(' ') + ' ' + mysqlType(c.type);
        if (c.comment) line += " COMMENT '" + esc(c.comment) + "'";
        return line;
      });
      body.push('  PRIMARY KEY (`' + o.pk + '`)');
      out.push('CREATE TABLE IF NOT EXISTS `' + dbOf(dst) + '`.`' + shortOf(dst) + '` (');
      out.push(body.join(',\n'));
      out.push(') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' + (dst.cn ? " COMMENT='" + esc(dst.cn) + "'" : '') + ';');
      return out.join('\n');
    }

    var wn = maxLen(dst.cols.map(function (c) { return c.name; }));
    var wt = maxLen(dst.cols.map(function (c) { return c.type; }));
    out.push('CREATE TABLE IF NOT EXISTS ' + dst.full + ' (');
    out.push(dst.cols.map(function (c) {
      return '  ' + pad(c.name, wn) + ' ' + pad(c.type, wt) + (c.comment ? " COMMENT '" + esc(c.comment) + "'" : '');
    }).join(',\n'));
    out.push(')');
    if (dst.cn) out.push("COMMENT '" + esc(dst.cn) + "'");
    if (dst.partitions.length) {
      var wp = maxLen(dst.partitions.map(function (c) { return c.name; }));
      out.push('PARTITIONED BY (');
      out.push(dst.partitions.map(function (p) {
        return '  ' + pad(p.name, wp) + ' ' + (p.type || 'string') + (p.comment ? " COMMENT '" + esc(p.comment) + "'" : '');
      }).join(',\n'));
      out.push(')');
    }
    out.push('STORED AS ' + o.format);
    if (o.format !== 'TEXTFILE') out.push("TBLPROPERTIES ('" + o.format.toLowerCase() + ".compress' = 'SNAPPY');");
    return out.join('\n');
  }

  /* ---------------- 全量 ---------------- */
  function genFull(src, dst, o) {
    var v = o.var, out = [];
    var sel = dst.cols.map(function (c) { return selExpr(src, c, ''); });
    out.push('-- ============================================================');
    out.push('-- 全量同步：' + dst.full + '  ←  ' + src.full);
    out.push('-- 覆盖目标表分区（或整表），执行前请确认上游分区已就绪');
    out.push('-- ============================================================');
    out.push('INSERT OVERWRITE TABLE ' + dst.full + partClause(dst, v));
    out.push('SELECT');
    out.push(sel.map(function (s) { return '  ' + s; }).join(',\n'));
    out.push('FROM ' + src.full);
    if (src.partitions.length) out.push('WHERE ' + srcPartCond(src, v) + ';');
    else out.push(';');
    return out.join('\n');
  }

  /* ---------------- 增量 ---------------- */
  function genIncr(src, dst, o) {
    if (o.dialect === 'mysql') return genIncrMySQL(src, dst, o);
    if (o.dialect === 'spark') return genMerge(src, dst, o, false);
    return genIncrHive(src, dst, o);
  }

  function genIncrHive(src, dst, o) {
    var v = o.var, out = [];
    var cols = dst.cols.map(function (c) { return c.name; });
    var sel = dst.cols.map(function (c) { return selExpr(src, c, ''); });
    var orderBy = o.incrField || o.pk;

    out.push('-- ============================================================');
    out.push('-- 增量同步（Hive）：源表当日变化行 + 目标当日存量 → 按主键去重取最新');
    out.push('-- 主键 ' + o.pk + (o.incrField ? ' · 增量字段 ' + o.incrField : '') + ' · 分区 ' + v);
    if (o.incrField) out.push('-- 增量条件：' + o.incrField + " >= '" + v + "'（按实际类型调整，如补 00:00:00）");
    out.push('-- ============================================================');
    out.push('INSERT OVERWRITE TABLE ' + dst.full + partClause(dst, v));
    out.push('SELECT');
    out.push(cols.map(function (c) { return '  ' + c; }).join(',\n'));
    out.push('FROM (');
    out.push('  SELECT');
    out.push(cols.map(function (c) { return '    ' + c + ','; }).join('\n'));
    out.push('    ROW_NUMBER() OVER (PARTITION BY ' + o.pk + ' ORDER BY ' + orderBy + ' DESC) AS rn');
    out.push('  FROM (');
    out.push('    -- 当日变化行');
    out.push('    SELECT');
    out.push(sel.map(function (s) { return '      ' + s; }).join(',\n'));
    out.push('    FROM ' + src.full);
    var srcConds = condList(src, v, '', o.incrField);
    if (srcConds.length) out.push('    WHERE ' + srcConds.join('\n      AND '));
    out.push('    UNION ALL');
    out.push('    -- 目标表当日存量');
    out.push('    SELECT');
    out.push(cols.map(function (c) { return '      ' + c; }).join(',\n'));
    out.push('    FROM ' + dst.full);
    var dstConds = condList(dst, v, '', '');
    if (dstConds.length) out.push('    WHERE ' + dstConds.join('\n      AND '));
    out.push('  ) u');
    out.push(') t');
    out.push('WHERE rn = 1;');
    return out.join('\n');
  }

  function genMerge(src, dst, o, needMerge) {
    var v = o.var, out = [];
    var cols = dst.cols.map(function (c) { return c.name; });
    var sel = dst.cols.map(function (c) { return selExpr(src, c, 's'); });
    out.push('-- ============================================================');
    out.push('-- 增量合并（MERGE INTO）：主键 ' + o.pk + '，未匹配插入、已匹配更新');
    out.push('-- ============================================================');
    out.push('MERGE INTO ' + dst.full + ' AS t');
    out.push('USING (');
    out.push('  SELECT');
    out.push(sel.map(function (s) { return '    ' + s; }).join(',\n'));
    out.push('  FROM ' + src.full + ' s');
    var sConds = condList(src, v, 's', o.incrField);
    if (sConds.length) out.push('  WHERE ' + sConds.join('\n    AND '));
    out.push(') s');
    out.push('ON t.' + o.pk + ' = s.' + o.pk);
    var upd = cols.filter(function (c) { return c !== o.pk; });
    if (upd.length) {
      out.push('WHEN MATCHED THEN UPDATE SET');
      out.push(upd.map(function (c) { return '  ' + c + ' = s.' + c; }).join(',\n'));
    }
    out.push('WHEN NOT MATCHED THEN INSERT (' + cols.join(', ') + ')');
    out.push('  VALUES (' + cols.map(function (c) { return 's.' + c; }).join(', ') + ');');
    return out.join('\n');
  }

  function genIncrMySQL(src, dst, o) {
    var v = o.var, out = [];
    var cols = dst.cols.map(function (c) { return c.name; });
    var sel = dst.cols.map(function (c) { return selExpr(src, c, 's'); });
    var upd = cols.filter(function (c) { return c !== o.pk; });
    out.push('-- ============================================================');
    out.push('-- 增量同步（MySQL / Doris upsert）：主键 ' + o.pk);
    out.push('-- ============================================================');
    out.push('INSERT INTO `' + dbOf(dst) + '`.`' + shortOf(dst) + '` (' + cols.map(function (c) { return '`' + c + '`'; }).join(', ') + ')');
    out.push('SELECT');
    out.push(sel.map(function (s) { return '  ' + s; }).join(',\n'));
    out.push('FROM `' + dbOf(src) + '`.`' + shortOf(src) + '` s');
    var mConds = condList(src, v, 's', '');
    if (mConds.length) out.push('WHERE ' + mConds.join('\n  AND '));
    if (upd.length) {
      out.push('ON DUPLICATE KEY UPDATE');
      out.push(upd.map(function (c) { return '  `' + c + '` = VALUES(`' + c + '`)'; }).join(',\n') + ';');
    } else {
      out.push('ON DUPLICATE KEY UPDATE `' + o.pk + '` = VALUES(`' + o.pk + '`);');
    }
    return out.join('\n');
  }

  /* ---------------- 拉链表 ---------------- */
  function genZip(src, dst, o) {
    var v = o.var;
    var zipFull = dst.full + '_zip';
    var zipShort = shortOf(dst) + '_zip';
    var cols = zipCols(dst, o);
    var names = cols.map(function (c) { return c.name; });
    var cmp = o.compareCols;
    var orderBy = o.incrField || o.pk;
    var head = [];
    head.push('-- ============================================================');
    head.push('-- 拉链表（SCD2）：' + zipFull);
    head.push('-- 主键 ' + o.pk + ' · 生效日期 start_date · 失效日期 end_date');
    head.push('-- 变化判断字段：' + (cmp.length ? cmp.join(', ') : '（全部主键外字段）'));
    head.push('-- ============================================================');

    if (o.dialect === 'mysql') return head.concat(genZipMySQL(src, dst, o, cmp)).join('\n');

    var lines = head.slice();
    lines.push('-- 1) 拉链表建表（如不存在）');
    var wn = maxLen(names);
    var wt = maxLen(cols.map(function (c) { return c.type; }));
    lines.push('CREATE TABLE IF NOT EXISTS ' + zipFull + ' (');
    lines.push(cols.map(function (c) {
      return '  ' + pad(c.name, wn) + ' ' + pad(c.type, wt) + (c.comment ? " COMMENT '" + esc(c.comment) + "'" : '');
    }).join(',\n') + ',');
    lines.push('  ' + pad('start_date', wn) + ' ' + pad('string', wt) + " COMMENT '生效日期',");
    lines.push('  ' + pad('end_date', wn) + ' ' + pad('string', wt) + " COMMENT '失效日期'");
    lines.push(') STORED AS ' + o.format + ';');
    lines.push('');
    lines.push('-- 2) 全量重写：已关闭历史 + 有效链（关闭变化行）+ 当日新增/变更行');
    lines.push('WITH today AS (');
    lines.push('  SELECT ' + names.join(', '));
    lines.push('  FROM (');
    lines.push('    SELECT ' + names.join(', ') + ',');
    lines.push('           ROW_NUMBER() OVER (PARTITION BY ' + o.pk + ' ORDER BY ' + orderBy + ' DESC) AS rn');
    lines.push('    FROM ' + src.full);
    lines.push('    WHERE ' + srcPartCond(src, v));
    lines.push('  ) x WHERE rn = 1');
    lines.push('),');
    lines.push('cur AS (');
    lines.push('  SELECT ' + names.join(', ') + ', start_date, end_date');
    lines.push('  FROM ' + zipFull);
    lines.push("  WHERE end_date = '9999-12-31'");
    lines.push(")");
    lines.push('INSERT OVERWRITE TABLE ' + zipFull);
    // 历史已关闭
    lines.push('SELECT ' + names.join(', ') + ', start_date, end_date');
    lines.push('FROM ' + zipFull);
    lines.push("WHERE end_date < '" + v + "'");
    lines.push('UNION ALL');
    // 有效链
    lines.push('SELECT ' + names.map(function (n) { return 'c.' + n; }).join(', ') + ',');
    lines.push("       c.start_date,");
    lines.push('       CASE WHEN t.' + o.pk + ' IS NULL OR ' + changedExpr(cmp, 't', 'c') + " THEN '" + v + "'");
    lines.push('            ELSE c.end_date END AS end_date');
    lines.push('FROM cur c');
    lines.push('LEFT JOIN today t ON c.' + o.pk + ' = t.' + o.pk);
    lines.push('UNION ALL');
    // 新增/变更
    lines.push('SELECT ' + names.map(function (n) { return 't.' + n; }).join(', ') + ',');
    lines.push("       '" + v + "' AS start_date,");
    lines.push("       '9999-12-31' AS end_date");
    lines.push('FROM today t');
    lines.push('LEFT JOIN cur c ON t.' + o.pk + ' = c.' + o.pk);
    lines.push('WHERE c.' + o.pk + ' IS NULL OR ' + changedExpr(cmp, 't', 'c') + ';');
    return lines.join('\n');
  }

  function genZipMySQL(src, dst, o, cmp) {
    var v = o.var, out = [];
    var zipFull = dst.full + '_zip';
    var names = zipCols(dst, o).map(function (c) { return c.name; });
    var chg = cmp.length ? changedExpr(cmp, 's', 'z') : '1 = 0';
    out.push('-- 1) 拉链表建表');
    out.push('CREATE TABLE IF NOT EXISTS `' + dbOf(dst) + '`.`' + shortOf(dst) + '_zip` (');
    out.push('  ' + names.map(function (n) { return '`' + n + '` varchar(255)'; }).join(',\n  ') + ',');
    out.push("  `start_date` varchar(10) COMMENT '生效日期',");
    out.push("  `end_date` varchar(10) COMMENT '失效日期',");
    out.push('  PRIMARY KEY (`' + o.pk + '`, `start_date`)');
    out.push(') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;');
    out.push('');
    out.push('-- 2) 关闭变化 / 消失的旧链');
    out.push('UPDATE `' + dbOf(dst) + '`.`' + shortOf(dst) + '_zip` z');
    out.push('LEFT JOIN `' + dbOf(src) + '`.`' + shortOf(src) + '` s');
    out.push('  ON z.' + o.pk + ' = s.' + o.pk + " AND s.ds = '" + v + "'");
    out.push("SET z.end_date = '" + v + "'");
    out.push("WHERE z.end_date = '9999-12-31'");
    out.push('  AND (s.' + o.pk + ' IS NULL OR ' + chg + ');');
    out.push('');
    out.push('-- 3) 追加新增 / 变更后的新链');
    out.push('INSERT INTO `' + dbOf(dst) + '`.`' + shortOf(dst) + '_zip` (' + names.concat(['start_date', 'end_date']).map(function (n) { return '`' + n + '`'; }).join(', ') + ')');
    out.push('SELECT ' + names.map(function (n) { return 's.' + n; }).join(', ') + ',');
    out.push("       '" + v + "', '9999-12-31'");
    out.push('FROM `' + dbOf(src) + '`.`' + shortOf(src) + '` s');
    out.push('LEFT JOIN `' + dbOf(dst) + '`.`' + shortOf(dst) + '_zip` z');
    out.push('  ON s.' + o.pk + ' = z.' + o.pk + " AND z.end_date = '9999-12-31'");
    out.push("WHERE s.ds = '" + v + "'");
    out.push('  AND (z.' + o.pk + ' IS NULL OR ' + chg + ');');
    return out;
  }

  /* ---------------- 入口 ---------------- */
  function build(text, opts) {
    opts = opts || {};
    var o = {
      dialect: (opts.dialect || 'hive').toLowerCase(),
      var: (opts.var || '${bizdate}').trim() || '${bizdate}',
      format: (opts.format || 'ORC').toUpperCase(),
      pk: (opts.pk || '').trim(),
      incrField: (opts.incrField || '').trim(),
      compare: (opts.compare || '').trim(),
      target: (opts.target || '').trim()
    };
    var parsed = MD().parse(text, {});
    var errors = parsed.errors.slice();
    var tables = parsed.tables.slice();
    if (!tables.length) throw new Error(errors.length ? errors[0].message : '没有识别到建表语句');

    var src, dst = null;
    if (o.target) dst = findTable(tables, o.target);
    if (tables.length >= 2) {
      src = tables[0];
      dst = dst || tables[1];
    } else {
      if (!o.target) throw new Error('只识别到 1 张表：请同时粘贴源表与目标表的建表语句（用 ; 分隔），或填写目标表名');
      src = tables[0];
      if (!dst) dst = cloneTable(src, o.target, '');
    }
    if (!dst.partitions.length && src.partitions.length) dst.partitions = cloneTable(src, dst.full, dst.cn).partitions;

    if (!o.pk) o.pk = guessPk(dst);
    if (!o.incrField) o.incrField = guessIncr(dst);
    if (!o.incrField) o.incrField = guessIncr(src);

    var reserved = [o.pk, 'start_date', 'end_date'];
    var partNames = dst.partitions.map(function (p) { return p.name; });
    var cmpSrc = o.compare
      ? o.compare.split(/[,，\s]+/).filter(Boolean)
      : dst.cols.map(function (c) { return c.name; }).filter(function (n) { return reserved.indexOf(n) < 0 && partNames.indexOf(n) < 0; });
    o.compareCols = cmpSrc.filter(function (n) { return dst.cols.some(function (c) { return c.name === n; }); });
    if (!o.compareCols.length) o.compareCols = [o.pk];

    var result = {
      ddl: genDDL(src, dst, o),
      full: genFull(src, dst, o),
      incr: genIncr(src, dst, o),
      zip: genZip(src, dst, o),
      src: src, dst: dst, errors: errors, options: o
    };
    result.stats = {
      src: src.full, dst: dst.full, cols: dst.cols.length,
      partitions: dst.partitions.map(function (p) { return p.name; }),
      pk: o.pk, incrField: o.incrField, compare: o.compareCols
    };
    return result;
  }

  global.SyncSQL = {
    build: build,
    _guessPk: guessPk,
    _guessIncr: guessIncr,
    _mysqlType: mysqlType,
    _changedExpr: changedExpr
  };
})(typeof window !== 'undefined' ? window : globalThis);