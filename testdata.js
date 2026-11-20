/*!
 * testdata.js — 依据建表语句生成 INSERT 测试数据
 * 零依赖；解析复用 modeldoc.js 的 ModelDoc.parse
 * 挂载到 window.TestData（Node 下为 globalThis.TestData）
 */
(function (global) {
  'use strict';

  var SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹喻柏水窦章'.split('');
  var GIVENS = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '霞', '平', '刚'];
  var REGIONS = ['华东', '华南', '华北', '华中', '西南', '西北', '东北'];
  var BRANDS = ['品牌A', '品牌B', '品牌C', '品牌D'];
  var CHANNELS = ['app', 'wechat', 'sms', 'phone', 'h5', 'mini'];

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(list, r) { return list[Math.floor(r() * list.length) % list.length]; }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* ---------- 类型 ---------- */
  function baseType(t) { return String(t || '').toLowerCase().replace(/\(.*$/, '').replace(/<.*$/, '').trim(); }
  function decScale(t) { var m = /decimal\s*\(\s*\d+\s*,\s*(\d+)\s*\)/i.exec(String(t || '')); return m ? parseInt(m[1], 10) : 2; }
  function isNumeric(t) { return /^(tinyint|smallint|int|integer|bigint|float|double|decimal|numeric|number|real)$/.test(baseType(t)); }
  function isTemporal(t) { return /^(date|datetime|timestamp|time)$/.test(baseType(t)); }
  function isComplex(t) { return /^(array|map|struct|binary)$/.test(baseType(t)); }

  /* ---------- 注释里提取枚举 ---------- */
  // "0潜客 1准客 2生效中"  → ['0','1','2']
  // "渠道: phone/wechat/sms" → ['phone','wechat','sms']
  function commentOptions(cm) {
    if (!cm) return null;
    var m, pairs = [], re = /(?:^|[\s,，、;；])([0-9A-Za-z]{1,4})\s*([\u4e00-\u9fa5]{1,12})/g;
    while ((m = re.exec(cm))) {
      if (/^[A-Za-z]+$/.test(m[1])) continue;          // yyyymmdd 之类
      if (pairs.indexOf(m[1]) < 0) pairs.push(m[1]);
    }
    if (pairs.length >= 2 && pairs.length <= 10) return pairs;
    var body = cm.replace(/^[^:：]{0,20}[:：]\s*/, '');
    var slash = body.split(/[\/|、]/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (slash.length >= 2 && slash.length <= 10 && slash.join('').length <= 60) return slash;
    return null;
  }

  /* ---------- 值生成 ---------- */
  function dateStr(offsetDays, withTime) {
    var d = new Date(Date.UTC(2024, 0, 1));
    d.setUTCDate(d.getUTCDate() + offsetDays);
    var y = d.getUTCFullYear(), mo = pad(d.getUTCMonth() + 1, 2), da = pad(d.getUTCDate(), 2);
    if (!withTime) return y + '-' + mo + '-' + da;
    return y + '-' + mo + '-' + da + ' ' + pad(9 + (offsetDays % 9), 2) + ':' + pad((offsetDays * 7) % 60, 2) + ':00';
  }

  function genString(col, ctx) {
    var n = col.name.toLowerCase(), r = ctx.r, i = ctx.i;
    var opts = commentOptions(col.comment);
    if (opts) return pick(opts, r);
    if (/phone|mobile|tel/.test(n)) return '1' + pick(['3', '5', '7', '8', '9'], r) + pad(Math.floor(r() * 1e9), 9);
    if (/email|mail/.test(n)) return 'user' + (100 + i) + '@example.com';
    if (/url|link|addr/.test(n)) return 'https://example.com/item/' + (1000 + i);
    if (/(^|_)(id|no|code|sn)($|_)|_id$/.test(n)) {
      if (/mbr|member|vip|user|会员|用户/.test(n + (col.comment || ''))) return 'M' + pad(100000 + i * 37 + Math.floor(r() * 900), 9);
      if (/order|trade|pay/.test(n)) return 'O' + pad(202401000 + i * 11, 9);
      if (/sku|goods|item|prod/.test(n)) return 'S' + pad(10000 + i * 3, 8);
      return pad(1000000 + i * 29 + Math.floor(r() * 900), 8);
    }
    if (/(姓名|name)$/.test(n) || /_name$/.test(n)) {
      if (/region|province|city|area|大区|区域/.test(n)) return pick(REGIONS, r);
      if (/brand/.test(n)) return pick(BRANDS, r);
      if (/channel/.test(n)) return pick(CHANNELS, r);
      return pick(SURNAMES, r) + pick(GIVENS, r);
    }
    if (/region|province|city|area|大区|区域/.test(n)) return pick(REGIONS, r);
    if (/brand/.test(n)) return pick(BRANDS, r);
    if (/channel|source|来源|渠道/.test(n)) return pick(CHANNELS, r);
    if (/status|state|_type$|^type/.test(n)) return pick(['1', '2', '3'], r);
    if (/flag|is_|是否/.test(n)) return pick(['0', '1'], r);
    if (/lvl|level|grade|等级/.test(n)) return pick(['1', '2', '3', '4'], r);
    if (/week|星期/.test(n)) return String(1 + Math.floor(r() * 7));
    if (/time|date|dt$/.test(n)) return dateStr(ctx.i, /time/.test(n));
    if (/desc|remark|comment|备注|说明/.test(n)) return pick(['测试数据', '示例备注', '自动生成'], r);
    return 'TXT' + pad(1000 + i, 4);
  }

  function genNumber(col, ctx) {
    var n = col.name.toLowerCase(), r = ctx.r, bt = baseType(col.type);
    var isDec = /^(decimal|numeric|number)$/.test(bt);
    var isFloat = /^(double|float|real)$/.test(bt);
    var scale = isDec ? decScale(col.type) : (isFloat ? 2 : 0);
    var opts = commentOptions(col.comment);
    if (opts) return pick(opts, r);                       // 注释里写死的枚举（0否 1是）
    if (isFloat && /rate|ratio|pct|percent|率|占比/.test(n)) return r().toFixed(4);
    if (/flag|is_|是否/.test(n)) return r() < 0.5 ? '0' : '1';
    if (/lvl|level|grade|等级/.test(n)) return String(1 + Math.floor(r() * 4));
    if (/week|星期/.test(n)) return String(1 + Math.floor(r() * 7));
    if (/amt|amount|price|fee|money|cost|bal|income|gmv|金额|费|收入/.test(n)) return (r() * 9800 + 200).toFixed(Math.max(scale, 2));
    if (/score|point|integral|积分|分数/.test(n)) return scale ? (r() * 5000).toFixed(scale) : String(Math.floor(r() * 5000));
    if (/cnt|count|num|qty|times|pv|uv|数|次/.test(n)) return String(1 + Math.floor(r() * 500));
    return scale ? (r() * 1000).toFixed(scale) : String(1 + Math.floor(r() * 1000));
  }

  function quote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

  function genValue(col, ctx) {
    var t = baseType(col.type);
    if (isComplex(col.type) || t === 'binary') return 'NULL';
    if (isTemporal(col.type)) {
      var s = dateStr(ctx.i, t === 'timestamp' || t === 'datetime' || t === 'time');
      return quote(s);
    }
    if (t === 'boolean' || t === 'bool') return ctx.r() < 0.5 ? 'false' : 'true';
    if (isNumeric(col.type)) return genNumber(col, ctx, decScale(col.type));
    return quote(genString(col, ctx));
  }

  /* ---------- 输出 ---------- */
  function colList(cols) { return '(' + cols.map(function (c) { return c.name; }).join(', ') + ')'; }

  function buildTable(t, opts) {
    var rows = opts.rows, sql = [], i, j, r, vals, seed = (opts.seed + hash(t.full)) >>> 0;
    var partVal = opts.partition == null || opts.partition === '' ? '20240101' : String(opts.partition);
    var parts = t.partitions || [];
    var dataCols = t.cols || [];
    var allCols = parts.concat(dataCols);
    if (!allCols.length) return null;

    var dialect = opts.dialect || 'hive';
    if (opts.comment !== false) {
      sql.push('-- ' + (t.cn || t.name) + '（' + (t.layer || '公共层') + '）· ' + t.full);
    }
    var colsForList = dialect === 'hive' ? dataCols : allCols;
    if (dialect === 'hive') {
      var partClause = parts.length
        ? ' PARTITION (' + parts.map(function (p) {
          var v = isNumeric(p.type) ? partVal : quote(partVal);
          return p.name + '=' + v;
        }).join(', ') + ')'
        : '';
      sql.push('INSERT INTO TABLE ' + t.full + partClause);
      if (colsForList.length) sql.push(colList(colsForList));
      sql.push('VALUES');
    } else if (dialect === 'plain') {
      sql.push('INSERT INTO ' + t.full);
      if (colsForList.length) sql.push(colList(colsForList));
      sql.push('VALUES');
    } else {
      sql.push('INSERT INTO ' + t.full + (colsForList.length ? ' ' + colList(colsForList) : '') + ' VALUES');
    }

    for (i = 0; i < rows; i++) {
      r = rng((seed + i * 2654435761) >>> 0);
      vals = [];
      for (j = 0; j < colsForList.length; j++) {
        var c = colsForList[j];
        if (parts.indexOf(c) >= 0) {
          vals.push(isNumeric(c.type) ? partVal : quote(partVal));
        } else {
          vals.push(genValue(c, { i: i, r: r, rows: rows }));
        }
      }
      sql.push('  (' + vals.join(', ') + ')' + (i < rows - 1 ? ',' : ';'));
    }
    if (!colsForList.length) { sql.push('  ();'); }
    return sql.join('\n');
  }

  function generate(ddl, options) {
    var MD = global.ModelDoc;
    if (!MD || typeof MD.parse !== 'function') throw new Error('modeldoc.js 未加载');
    var opts = {
      rows: Math.max(1, Math.min(1000, parseInt((options && options.rows), 10) || 10)),
      dialect: (options && options.dialect) || 'hive',
      partition: options && options.partition,
      table: (options && options.table) || '',
      comment: !(options && options.comment === false),
      seed: (options && options.seed) || (Date.now() % 2147483647)
    };
    var st = MD.parse(ddl, {});
    var tables = st.tables || [], errors = (st.errors || []).slice(), out = [], used = [];
    tables.forEach(function (t) {
      if (opts.table && opts.table !== t.full) return;
      var s = buildTable(t, opts);
      if (s) { out.push(s); used.push(t); }
    });
    return { sql: out.join('\n\n'), tables: used, errors: errors, rows: opts.rows };
  }

  global.TestData = {
    generate: generate,
    valueFor: genValue,
    commentOptions: commentOptions,
    _baseType: baseType,
    _isNumeric: isNumeric
  };
})(typeof window !== 'undefined' ? window : globalThis);