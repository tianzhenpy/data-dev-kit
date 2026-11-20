/*  ddlchange.js — 表结构变更：新旧建表语句 → ALTER 变更脚本
    零依赖，依赖 modeldoc.js 的 window.ModelDoc.parse
    用法：DDLChange.build(oldDdl, newDdl, opts)
    opts: dialect(hive|mysql) dropTable(false) cascade(true) rename(true)
    返回：{ ok, dialect, tables:[{...}], summary, sql, warnings }
*/
(function (global) {
  'use strict';

  function MD() {
    var m = global.ModelDoc;
    if (!m) throw new Error('modeldoc.js 未加载');
    return m;
  }

  function lc(s) { return String(s == null ? '' : s).toLowerCase(); }
  function trimType(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function typeKey(t) { return lc(trimType(t)).replace(/\s+/g, ''); }

  function escHive(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
  function escMysql(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "''");
  }
  function commentSql(c, dialect) {
    if (!c) return '';
    return " COMMENT '" + (dialect === 'mysql' ? escMysql(c) : escHive(c)) + "'";
  }

  function quoteTable(full, dialect) {
    var parts = String(full).split('.');
    if (dialect === 'mysql') {
      return parts.map(function (p) { return '`' + p.replace(/`/g, '') + '`'; }).join('.');
    }
    return parts.map(function (p) { return '`' + p.replace(/`/g, '') + '`'; }).join('.');
  }
  function quoteCol(name) { return '`' + String(name).replace(/`/g, '') + '`'; }

  function findStatement(ddl, table) {
    var m = MD();
    var stmts = m._splitStatements ? m._splitStatements(ddl) : String(ddl).split(';');
    var want = lc(table.full);
    var wantShort = lc(table.short || table.full.split('.').pop());
    for (var i = 0; i < stmts.length; i++) {
      var s = stmts[i];
      var mm = /create\s+(?:or\s+replace\s+)?(?:external\s+)?(?:temporary\s+)?table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)/i.exec(s);
      if (!mm) continue;
      var name = mm[1].replace(/[`"]/g, '');
      if (lc(name) === want || lc(name.split('.').pop()) === wantShort) return s.trim().replace(/;\s*$/, '') + ';';
    }
    return '';
  }

  function tableIndex(tables) {
    var byFull = {}, byShort = {};
    tables.forEach(function (t) {
      byFull[lc(t.full)] = t;
      byShort[lc(t.short || t.full.split('.').pop())] = byShort[lc(t.short || t.full.split('.').pop())] || t;
    });
    return { byFull: byFull, byShort: byShort };
  }

  function colIndex(table) {
    var m = {};
    table.cols.forEach(function (c) { m[lc(c.name)] = c; });
    return m;
  }

  function diffColumns(oldT, newT, opts) {
    var changes = [];
    var oldMap = colIndex(oldT), newMap = colIndex(newT);
    var removed = [], added = [], renamePairs = [];

    oldT.cols.forEach(function (c) {
      if (!newMap[lc(c.name)]) removed.push(c);
    });
    newT.cols.forEach(function (c) {
      if (!oldMap[lc(c.name)]) added.push(c);
    });

    // 智能识别重命名：类型一致且注释一致（且注释非空），一对一才认
    var usedOld = {};
    if (opts.rename !== false) {
      added.forEach(function (a) {
        var cands = removed.filter(function (r) {
          return !usedOld[lc(r.name)] && typeKey(r.type) === typeKey(a.type) &&
            r.comment && a.comment && lc(r.comment) === lc(a.comment);
        });
        if (cands.length === 1) {
          var r = cands[0];
          usedOld[lc(r.name)] = true;
          renamePairs.push({ from: r, to: a });
        }
      });
    }
    var renamedFrom = {}, renamedTo = {};
    renamePairs.forEach(function (p) { renamedFrom[lc(p.from.name)] = true; renamedTo[lc(p.to.name)] = true; });

    removed.forEach(function (r) {
      if (renamedFrom[lc(r.name)]) return;
      changes.push({ kind: 'drop', col: r.name, before: trimType(r.type), after: '', comment: r.comment });
    });
    added.forEach(function (a) {
      if (renamedTo[lc(a.name)]) return;
      changes.push({ kind: 'add', col: a.name, before: '', after: trimType(a.type), comment: a.comment });
    });
    renamePairs.forEach(function (p) {
      changes.push({ kind: 'rename', col: p.to.name, before: p.from.name, after: trimType(p.to.type), comment: p.to.comment });
    });

    // 同名字段：类型 / 注释变更
    newT.cols.forEach(function (n) {
      var o = oldMap[lc(n.name)];
      if (!o) return;
      var t1 = trimType(o.type), t2 = trimType(n.type);
      if (typeKey(t1) !== typeKey(t2)) {
        changes.push({ kind: 'modify', col: n.name, before: t1, after: t2, comment: n.comment, reason: '类型' });
      } else if ((o.comment || '') !== (n.comment || '')) {
        changes.push({ kind: 'modify', col: n.name, before: o.comment || '', after: n.comment || '', comment: n.comment, reason: '注释' });
      }
    });

    // 分区字段
    var oldP = oldT.partitions || [], newP = newT.partitions || [];
    var oldPk = oldP.map(function (c) { return lc(c.name) + ':' + typeKey(c.type); }).join(',');
    var newPk = newP.map(function (c) { return lc(c.name) + ':' + typeKey(c.type); }).join(',');
    var partChanged = oldPk !== newPk;

    return { changes: changes, partChanged: partChanged, oldParts: oldP, newParts: newP };
  }

  function build(oldDdl, newDdl, opts) {
    opts = opts || {};
    var dialect = opts.dialect === 'mysql' ? 'mysql' : 'hive';
    var m = MD();
    var oldP = m.parse(oldDdl || '', {});
    var newP = m.parse(newDdl || '', {});
    if (!oldP.tables.length && !newP.tables.length) {
      throw new Error('两边都没有识别到 CREATE TABLE 语句');
    }

    var oldIdx = tableIndex(oldP.tables);
    var newIdx = tableIndex(newP.tables);
    var out = [], warnings = [];
    var summary = { added: 0, removed: 0, changed: 0, same: 0, addCols: 0, dropCols: 0, modCols: 0, renames: 0 };

    function sqlHeader(t) {
      return '-- ===== ' + t.full + ' =====';
    }

    // 遍历新版：新增 / 变更
    newP.tables.forEach(function (nt) {
      var ot = oldIdx.byFull[lc(nt.full)] || null;
      var matchedBy = 'full';
      if (!ot) {
        var shortKey = lc(nt.short || nt.full.split('.').pop());
        ot = oldIdx.byShort[shortKey] || null;
        if (ot) matchedBy = 'short';
      }

      if (!ot) {
        var createSql = findStatement(newDdl, nt) || ('-- 未找到原始 CREATE TABLE 语句：' + nt.full);
        out.push({
          full: nt.full, name: nt.short, status: 'added',
          changes: [{ kind: 'create', col: '', before: '', after: '', note: '新增表 · ' + nt.cols.length + ' 字段' }],
          sql: sqlHeader(nt) + '\n-- 新增表\n' + createSql
        });
        summary.added++;
        return;
      }

      var d = diffColumns(ot, nt, opts);
      var sqls = [];
      var items = d.changes.slice();

      if (matchedBy === 'short' && lc(ot.full) !== lc(nt.full)) {
        items.unshift({ kind: 'retable', col: '', before: ot.full, after: nt.full, note: '库名 / 表名不同，按短表名匹配' });
        warnings.push(nt.full + '：新旧全名不一致（' + ot.full + '），已按短表名匹配，请确认是否为同一张表');
      }

      if (d.partChanged) {
        items.push({ kind: 'partition', col: (d.newParts || []).map(function (c) { return c.name; }).join(', '),
          before: (d.oldParts || []).map(function (c) { return c.name + ' ' + trimType(c.type); }).join(', '),
          after: (d.newParts || []).map(function (c) { return c.name + ' ' + trimType(c.type); }).join(', '),
          note: '分区字段变化，无法用 ALTER 平滑演进，需重建表 / 迁数据' });
        warnings.push(nt.full + '：分区字段发生变化，ALTER 无法完成，建议新建表后迁数');
      }

      if ((ot.comment || '') !== (nt.comment || '') && nt.comment) {
        items.push({ kind: 'tcomment', col: '', before: ot.comment || '', after: nt.comment, note: '表注释变更' });
      }

      var tq = quoteTable(nt.full, dialect);
      var adds = [], drops = [], mods = [], renames = [];
      d.changes.forEach(function (c) {
        if (c.kind === 'add') adds.push(c);
        else if (c.kind === 'drop') drops.push(c);
        else if (c.kind === 'rename') renames.push(c);
        else if (c.kind === 'modify') mods.push(c);
      });

      if (renames.length) {
        sqls.push('-- 字段重命名（类型 / 注释一致，自动识别）');
        renames.forEach(function (c) {
          sqls.push('ALTER TABLE ' + tq + ' CHANGE COLUMN ' + quoteCol(c.before) + ' ' + quoteCol(c.col) + ' ' + c.after + commentSql(c.comment, dialect) + (dialect === 'mysql' ? '' : (opts.cascade === false ? '' : ' CASCADE')) + ';');
        });
      }
      if (adds.length) {
        if (dialect === 'mysql') {
          sqls.push('-- 新增字段');
          adds.forEach(function (c) {
            sqls.push('ALTER TABLE ' + tq + ' ADD COLUMN ' + quoteCol(c.col) + ' ' + c.after + commentSql(c.comment, dialect) + ';');
          });
        } else {
          sqls.push('-- 新增字段');
          sqls.push('ALTER TABLE ' + tq + ' ADD COLUMNS (');
          sqls.push(adds.map(function (c) {
            return '  ' + quoteCol(c.col) + ' ' + c.after + commentSql(c.comment, dialect);
          }).join(',\n'));
          sqls.push(')' + (opts.cascade === false ? '' : ' CASCADE') + ';');
        }
      }
      if (mods.length) {
        sqls.push('-- 字段类型 / 注释变更');
        mods.forEach(function (c) {
          if (dialect === 'mysql') {
            sqls.push('ALTER TABLE ' + tq + ' MODIFY COLUMN ' + quoteCol(c.col) + ' ' + c.after + commentSql(c.comment, dialect) + ';');
          } else {
            sqls.push('ALTER TABLE ' + tq + ' CHANGE COLUMN ' + quoteCol(c.col) + ' ' + quoteCol(c.col) + ' ' + c.after + commentSql(c.comment, dialect) + (opts.cascade === false ? '' : ' CASCADE') + ';');
          }
        });
      }
      if (drops.length && opts.dropColumn !== false) {
        sqls.push('-- 删除字段' + (dialect === 'mysql' ? '' : '（Hive 3.x 起支持；低版本请改用 REPLACE COLUMNS）'));
        drops.forEach(function (c) {
          if (dialect === 'mysql') {
            sqls.push('ALTER TABLE ' + tq + ' DROP COLUMN ' + quoteCol(c.col) + ';');
          } else {
            sqls.push('-- ALTER TABLE ' + tq + ' DROP COLUMN ' + quoteCol(c.col) + ';');
          }
        });
        if (dialect !== 'mysql') {
          sqls.push('-- 若集群不支持 DROP COLUMN，可用下面整表重建字段列表：');
          sqls.push('-- ALTER TABLE ' + tq + ' REPLACE COLUMNS (');
          sqls.push(nt.cols.map(function (c) {
            return '--   ' + quoteCol(c.name) + ' ' + trimType(c.type) + commentSql(c.comment, dialect);
          }).join(',\n'));
          sqls.push('-- );');
        }
      }
      if ((ot.comment || '') !== (nt.comment || '') && nt.comment) {
        if (dialect === 'mysql') sqls.push('ALTER TABLE ' + tq + ' COMMENT = \'' + escMysql(nt.comment) + '\';');
        else sqls.push('ALTER TABLE ' + tq + ' SET TBLPROPERTIES (\'comment\' = \'' + escHive(nt.comment) + '\');');
      }

      var status = items.length ? 'changed' : 'same';
      if (status === 'same') {
        summary.same++;
      } else {
        summary.changed++;
        summary.addCols += adds.length + renames.length;
        summary.dropCols += drops.length;
        summary.modCols += mods.length;
        summary.renames += renames.length;
      }
      out.push({
        full: nt.full, name: nt.short, status: status, changes: items,
        sql: sqlHeader(nt) + (sqls.length ? '\n' + sqls.join('\n') : '\n-- 无结构变化')
      });
    });

    // 旧版有、新版没有：删表
    oldP.tables.forEach(function (ot) {
      if (newIdx.byFull[lc(ot.full)]) return;
      if (newIdx.byShort[lc(ot.short || ot.full.split('.').pop())]) return;
      summary.removed++;
      var q = quoteTable(ot.full, dialect);
      var s = sqlHeader(ot) + '\n-- 新版已删除该表';
      if (opts.dropTable) s += '\nDROP TABLE IF EXISTS ' + q + ';';
      else s += '\n-- DROP TABLE IF EXISTS ' + q + ';  -- 取消注释后执行';
      out.push({ full: ot.full, name: ot.short, status: 'removed', changes: [{ kind: 'droptable', col: '', note: '新版已删除该表' }], sql: s });
    });

    var sql = out.map(function (t) { return t.sql; }).join('\n\n');
    var head = '-- 表结构变更脚本 · ' + (dialect === 'mysql' ? 'MySQL' : 'Hive') + ' · 生成于 ' + new Date().toLocaleString('zh-CN') + '\n' +
      '-- 新增表 ' + summary.added + ' · 删除表 ' + summary.removed + ' · 变更表 ' + summary.changed + ' · 无变化 ' + summary.same + '\n' +
      '-- 新增字段 ' + summary.addCols + ' · 删除字段 ' + summary.dropCols + ' · 修改字段 ' + summary.modCols + ' · 重命名 ' + summary.renames + '\n';

    return {
      ok: true, dialect: dialect, tables: out, summary: summary, warnings: warnings,
      sql: head + '\n' + sql + '\n'
    };
  }

  function describe(r) {
    if (!r) return '';
    var s = r.summary;
    return '新增表 ' + s.added + ' · 删除表 ' + s.removed + ' · 变更表 ' + s.changed + ' · 无变化 ' + s.same;
  }

  global.DDLChange = {
    build: build,
    describe: describe,
    _quoteTable: quoteTable,
    _diffColumns: diffColumns
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.DDLChange;
})(typeof window !== 'undefined' ? window : globalThis);