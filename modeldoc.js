/* ============================================================
 * modeldoc.js — 建表语句 → 模型设计文档（.xlsx）
 * 零依赖：自写 ZIP(store) + XLSX(SpreadsheetML) 生成器
 * 用法：
 *   ModelDoc.parse(ddlText)              → {tables:[...], errors:[...]}
 *   ModelDoc.bytes(ddlText, opts)        → Uint8Array（完整 xlsx）
 *   ModelDoc.bytesFromTables(tables, o)  → 同上，跳过解析
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 基础工具 ---------------- */

  function utf8(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++; continue;
        }
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return new Uint8Array(out);
  }

  var CRC_TABLE = (function () {
    var t = new Int32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = -1;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  /* ---------------- ZIP（store，无压缩） ---------------- */

  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  }

  function zip(files) {
    var now = new Date();
    var t = dosTime(now), dt = dosDate(now);
    var chunks = [], central = [], offset = 0, i;

    function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
    function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

    for (i = 0; i < files.length; i++) {
      var nameBytes = utf8(files[i].name);
      var data = files[i].data;
      var crc = crc32(data);
      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(t), u16(dt),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0)
      );
      chunks.push(new Uint8Array(local), nameBytes, data);
      central.push({ name: nameBytes, crc: crc, size: data.length, offset: offset });
      offset += local.length + nameBytes.length + data.length;
    }

    var cdStart = offset, cdSize = 0;
    for (i = 0; i < central.length; i++) {
      var c = central[i];
      var head = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(t), u16(dt),
        u32(c.crc), u32(c.size), u32(c.size),
        u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset)
      );
      chunks.push(new Uint8Array(head), c.name);
      cdSize += head.length + c.name.length;
    }

    var eocd = [].concat(
      u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
      u32(cdSize), u32(cdStart), u16(0)
    );
    chunks.push(new Uint8Array(eocd));

    var total = 0, k;
    for (k = 0; k < chunks.length; k++) total += chunks[k].length;
    var buf = new Uint8Array(total), pos = 0;
    for (k = 0; k < chunks.length; k++) { buf.set(chunks[k], pos); pos += chunks[k].length; }
    return buf;
  }

  /* ---------------- 样式编号 ---------------- */
  // 0 默认 / 1 正文左对齐自动换行 / 2 表头加粗居中 / 3 标题黄色加粗 / 4 正文居中
  var S_DEFAULT = 0, S_BODY = 1, S_HEAD = 2, S_TITLE = 3, S_CENTER = 4, S_CELL = 5, S_CELL_W = 6;

  function cellXml(ref, value, style) {
    if (value === null || value === undefined || value === '') {
      return '<c r="' + ref + '" s="' + style + '"/>';
    }
    return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
      xmlEsc(value) + '</t></is></c>';
  }

  function colName(n) {
    var s = '';
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  /**
   * sheet = {
   *   name: '目录',
   *   widths: [71.6, 85.1],
   *   rows: [ {h: 82, cells: [{v, s}, ...]}, ... ],
   *   merges: ['A1:E1']
   * }
   */
  function sheetXml(sheet) {
    var out = [];
    out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    out.push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
    out.push('<sheetFormatPr defaultRowHeight="15.75"/>');

    if (sheet.widths && sheet.widths.length) {
      out.push('<cols>');
      for (var w = 0; w < sheet.widths.length; w++) {
        out.push('<col min="' + (w + 1) + '" max="' + (w + 1) + '" width="' + sheet.widths[w] + '" customWidth="1"/>');
      }
      out.push('</cols>');
    }

    out.push('<sheetData>');
    for (var r = 0; r < sheet.rows.length; r++) {
      var row = sheet.rows[r];
      var ht = row.h || 15.75;
      out.push('<row r="' + (r + 1) + '" ht="' + ht + '" customHeight="1">');
      var cells = row.cells || [];
      for (var c = 0; c < cells.length; c++) {
        var cell = cells[c];
        if (!cell) continue;
        out.push(cellXml(colName(c + 1) + (r + 1), cell.v, cell.s === undefined ? S_DEFAULT : cell.s));
      }
      out.push('</row>');
    }
    out.push('</sheetData>');

    if (sheet.merges && sheet.merges.length) {
      out.push('<mergeCells count="' + sheet.merges.length + '">');
      for (var m = 0; m < sheet.merges.length; m++) out.push('<mergeCell ref="' + sheet.merges[m] + '"/>');
      out.push('</mergeCells>');
    }

    out.push('</worksheet>');
    return out.join('');
  }

  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2">' +
      '<font><sz val="12"/><color rgb="FF000000"/><name val="等线"/><charset val="134"/><family val="2"/></font>' +
      '<font><b/><sz val="12"/><color rgb="FF000000"/><name val="等线"/><charset val="134"/><family val="2"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF2C150"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right>' +
      '<top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"><alignment vertical="center"/></xf></cellStyleXfs>' +
      '<cellXfs count="7">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  function buildXlsx(sheets) {
    var files = [];
    var ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'];
    for (var i = 0; i < sheets.length; i++) {
      ct.push('<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
    }
    ct.push('</Types>');
    files.push({ name: '[Content_Types].xml', data: utf8(ct.join('')) });

    files.push({
      name: '_rels/.rels', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>')
    });

    var wb = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<sheets>'];
    for (var s = 0; s < sheets.length; s++) {
      wb.push('<sheet name="' + xmlEsc(sheets[s].name) + '" sheetId="' + (s + 1) + '" r:id="rId' + (s + 2) + '"/>');
    }
    wb.push('</sheets></workbook>');
    files.push({ name: 'xl/workbook.xml', data: utf8(wb.join('')) });

    var rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'];
    for (var w = 0; w < sheets.length; w++) {
      rels.push('<Relationship Id="rId' + (w + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (w + 1) + '.xml"/>');
    }
    rels.push('</Relationships>');
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: utf8(rels.join('')) });

    files.push({ name: 'xl/styles.xml', data: utf8(stylesXml()) });

    for (var k = 0; k < sheets.length; k++) {
      files.push({ name: 'xl/worksheets/sheet' + (k + 1) + '.xml', data: utf8(sheetXml(sheets[k])) });
    }

    return zip(files);
  }

  /* ---------------- 词表：字段/表名 → 中文 ---------------- */

  var TOKENS = {
    ds: '数据日期', dt: '日期', date: '日期', day: '日', week: '周', month: '月', year: '年', quarter: '季度', hour: '小时', minute: '分钟',
    time: '时间', ts: '时间戳', timestamp: '时间戳', mtd: '月累计', qtd: '季累计', ytd: '年累计',
    yoy: '同比', mom: '环比', dod: '日环比', wow: '周环比',
    id: 'ID', key: '键', no: '编号', code: '编码', seq: '序号', rn: '行号', index: '索引', idx: '索引',
    name: '名称', nm: '名称', title: '标题', desc: '描述', remark: '备注', memo: '备注', comment: '备注',
    type: '类型', kind: '种类', class: '类别', category: '品类', level: '层级', lvl: '层级', grade: '等级', status: '状态', state: '状态',
    flag: '标记', is: '是否', has: '是否有', tag: '标签', grp: '分组', group: '分组', sort: '排序',
    cnt: '数', count: '数', num: '数量', qty: '数量', quantity: '数量', amount: '金额', amt: '金额', money: '金额',
    price: '价格', fee: '费用', cost: '成本', sale: '销售', sales: '销售', revenue: '收入', profit: '利润',
    rate: '率', ratio: '占比', pct: '百分比', percent: '百分比', avg: '平均', max: '最大', min: '最小',
    sum: '合计', total: '总计', diff: '差值', delta: '变化量', score: '得分', weight: '权重', rank: '排名',
    member: '会员', mbr: '会员', vip: '会员', user: '用户', cust: '客户', customer: '客户', person: '人员',
    staff: '员工', emp: '员工', employee: '员工', role: '角色', position: '岗位', job: '岗位',
    store: '门店', shop: '门店', storefront: '门店', region: '区域', area: '区域', province: '省份',
    city: '城市', county: '区县', district: '区县', town: '乡镇', village: '村', addr: '地址', address: '地址',
    channel: '渠道', source: '来源', src: '来源', target: '目标', tgt: '目标', method: '方式', way: '方式',
    service: '服务', svc: '服务', touch: '触达', contact: '触点', reach: '触达', push: '下发', send: '发送',
    expose: '曝光', click: '点击', view: '浏览', visit: '访问', browse: '浏览', collect: '收藏', share: '分享',
    valid: '有效', invalid: '无效', active: '主动', passive: '被动', smart: '智能', auto: '自动', manual: '人工',
    convert: '转化', trade: '交易', order: '订单', ord: '订单', pay: '支付', payment: '支付', refund: '退款',
    product: '商品', prod: '商品', sku: '商品', item: '商品', brand: '品牌', series: '系列', model: '型号',
    activity: '活动', act: '活动', campaign: '活动', task: '任务', topic: '主题', content: '内容', material: '素材',
    crowd: '人群', matrix: '矩阵', package: '包', pkg: '包', segment: '分群', label: '标签',
    exec: '执行', execute: '执行', dial: '拨打', call: '拨打', talk: '通话', duration: '时长', len: '长度',
    face: '面访', wechat: '企微', wx: '微信', sms: '短信', mail: '邮件', phone: '电话', message: '消息',
    qw: '企微', wo: '工单', work: '工单', workorder: '工单', ticket: '工单', follow: '跟进', reply: '回复',
    team: '团队', dept: '部门', department: '部门', org: '组织', organization: '组织', company: '公司',
    biz: '业务', business: '业务', data: '数据', detail: '明细', summary: '汇总', stat: '统计', stats: '统计',
    report: '报表', analysis: '分析', analyze: '分析', metric: '指标', dim: '维度', fact: '事实',
    period: '周期', start: '开始', end: '结束', begin: '开始', finish: '结束', create: '创建', created: '创建',
    update: '更新', updated: '更新', modify: '修改', insert: '插入', delete: '删除', last: '最后', first: '首个',
    prev: '上期', next: '下期', cur: '当期', current: '当期', new: '新', old: '老', main: '主', sub: '子',
    ext: '外部', inner: '内部', out: '出', in: '入', up: '上', down: '下', left: '左', right: '右',
    expose_cnt: '曝光数', click_cnt: '点击数', convert_cnt: '转化数', convert_amt: '转化金额',
    user_id: '用户ID', member_id: '会员ID', bizdate: '业务日期', source_table: '来源表', data_type: '数据类型'
  };

  var LAYER_PREFIX = {
    fact: ['fct_', 'dim_', 'dwd_', 'dws_', 'dm_', 'ods_', 'dwd', 'dws']
  };

  function stripAffixes(name) {
    var s = name.toLowerCase();
    s = s.replace(/^(ods|dwd|dws|dim|fct|ads|app|rpt|report|tmp|stg|dm)_/i, '');
    s = s.replace(/_(df|di|d|db|tmp|new|his|full|inc|snapshot|part\d*)$/i, '');
    return s;
  }

  function guessCN(name) {
    if (!name) return '';
    var key = String(name).toLowerCase().trim();
    if (TOKENS[key]) return TOKENS[key];
    var parts = stripAffixes(key).split('_').filter(Boolean);
    if (!parts.length) return '';
    var out = '';
    var known = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (TOKENS[p]) { out += TOKENS[p]; known++; }
      else if (/^\d+$/.test(p)) { out += p; known++; }
      else { out += (out ? ' ' : '') + p; }
    }
    if (!known) return '';
    return out;
  }

  /* ---------------- DDL 解析 ---------------- */

  function stripLineComments(s) {
    var out = '', i = 0, q = null;
    while (i < s.length) {
      var ch = s[i];
      if (q) {
        out += ch;
        if (ch === '\\') { out += s[i + 1] || ''; i += 2; continue; }
        if (ch === q) q = null;
        i++; continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { q = ch; out += ch; i++; continue; }
      if (ch === '-' && s[i + 1] === '-') {
        var j = s.indexOf('\n', i);
        if (j < 0) j = s.length;
        i = j; continue;
      }
      if (ch === '/' && s[i + 1] === '*') {
        var k = s.indexOf('*/', i + 2);
        if (k < 0) k = s.length - 2;
        i = k + 2; continue;
      }
      out += ch; i++;
    }
    return out;
  }

  function splitStatements(sql) {
    var out = [], cur = '', i = 0, q = null, depth = 0;
    while (i < sql.length) {
      var ch = sql[i];
      if (q) {
        cur += ch;
        if (ch === '\\') { cur += sql[i + 1] || ''; i += 2; continue; }
        if (ch === q) q = null;
        i++; continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; i++; continue; }
      if (ch === '-' && sql[i + 1] === '-') { var j = sql.indexOf('\n', i); if (j < 0) j = sql.length; cur += sql.slice(i, j); i = j; continue; }
      if (ch === '/' && sql[i + 1] === '*') { var k = sql.indexOf('*/', i + 2); if (k < 0) k = sql.length - 2; cur += sql.slice(i, k + 2); i = k + 2; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0) { out.push(cur); cur = ''; i++; continue; }
      cur += ch; i++;
    }
    if (cur.trim()) out.push(cur);
    return out.map(function (s) { return s.trim(); }).filter(function (s) { return s && !/^[\s;]*$/.test(s); });
  }

  function matchParen(s, open) {
    var d = 0, q = null;
    for (var i = open; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        if (ch === '\\') { i++; continue; }
        if (ch === q) q = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
      if (ch === '(') d++;
      else if (ch === ')') { d--; if (d === 0) return i; }
    }
    return -1;
  }

  function splitTopLevel(s, sep) {
    var out = [], cur = '', q = null, d = 0, a = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        cur += ch;
        if (ch === '\\') { cur += s[i + 1] || ''; i++; continue; }
        if (ch === q) q = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
      if (ch === '(') d++;
      else if (ch === ')') d--;
      else if (ch === '<') a++;
      else if (ch === '>') a = Math.max(0, a - 1);
      if (ch === sep && d === 0 && a === 0) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }

  function unquote(s) {
    return String(s || '').trim().replace(/^[`"\[]/, '').replace(/[`"\]]$/, '');
  }

  function parseColumn(def) {
    var s = def.trim();
    if (!s) return null;
    if (/^(primary|constraint|unique|index|key|foreign|partitioned|clustered|row|stored|location|tblproperties|with|comment)\b/i.test(s)) return null;

    var m = /^([`"\[]?[^\s`"\[\]]+[`"\]]?)\s+([\s\S]+)$/.exec(s);
    if (!m) return null;
    var name = unquote(m[1]);
    var rest = m[2].trim();

    var comment = '';
    var cm = /\s+comment\s+'((?:[^'\\]|\\.)*)'|\s+comment\s+"((?:[^"\\]|\\.)*)"/i.exec(rest);
    if (cm) {
      comment = (cm[1] || cm[2] || '').replace(/\\'/g, "'").replace(/\\"/g, '"');
      rest = rest.slice(0, cm.index).trim();
    }
    var type = rest.replace(/\s+/g, ' ');
    return { name: name, type: type, comment: comment, partition: false };
  }

  function isNumericType(type) {
    return /^(tinyint|smallint|int|integer|bigint|long|float|double|double precision|decimal|numeric|real|number|byte|short)\b/i.test(String(type || '').trim());
  }

  function parseTables(ddl, opts) {
    opts = opts || {};
    var prefixList = String(opts.appPrefixes == null ? 'ads_,app_,rpt_' : opts.appPrefixes)
      .split(/[,，\s]+/).filter(Boolean).map(function (p) { return p.toLowerCase(); });

    var stmts = splitStatements(stripLineComments(ddl || ''));
    var tables = [], errors = [];

    for (var i = 0; i < stmts.length; i++) {
      var stmt = stmts[i];
      var m = /create\s+(?:or\s+replace\s+)?(?:external\s+)?(?:temporary\s+)?table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)/i.exec(stmt);
      if (!m) {
        errors.push({ index: i + 1, message: '第 ' + (i + 1) + ' 段不是 CREATE TABLE', head: stmt.slice(0, 60).replace(/\s+/g, ' ') });
        continue;
      }
      var rawName = m[1];
      var fullName = rawName.replace(/[`"]/g, '');
      var afterName = stmt.slice(m.index + m[0].length);
      if (/^\s*(like|as\b)/i.test(afterName)) {
        errors.push({ index: i + 1, message: '表 ' + fullName + ' 是 LIKE/AS 建表，没有字段列表，已跳过' });
        continue;
      }
      var open = stmt.indexOf('(', m.index + m[0].length);
      if (open < 0) {
        errors.push({ index: i + 1, message: '表 ' + fullName + ' 没找到字段列表，已跳过' });
        continue;
      }
      var close = matchParen(stmt, open);
      if (close < 0) {
        errors.push({ index: i + 1, message: '表 ' + fullName + ' 的括号不匹配，已跳过' });
        continue;
      }

      var body = stmt.slice(open + 1, close);
      var cols = [];
      splitTopLevel(body, ',').forEach(function (def) {
        var c = parseColumn(def);
        if (c) cols.push(c);
      });
      if (!cols.length) {
        errors.push({ index: i + 1, message: '表 ' + fullName + ' 没解析到字段，已跳过' });
        continue;
      }

      var tail = stmt.slice(close + 1);
      var tableComment = '';
      var tcm = /\bcomment\s+'((?:[^'\\]|\\.)*)'|\bcomment\s+"((?:[^"\\]|\\.)*)"/i.exec(tail);
      if (tcm) tableComment = (tcm[1] || tcm[2] || '').replace(/\\'/g, "'").replace(/\\"/g, '"');

      var parts = [];
      var pm = /partitioned\s+by\s*\(/i.exec(tail);
      if (pm) {
        var pOpen = tail.indexOf('(', pm.index);
        var pClose = matchParen(tail, pOpen);
        if (pClose > pOpen) {
          splitTopLevel(tail.slice(pOpen + 1, pClose), ',').forEach(function (def) {
            var c = parseColumn(def);
            if (c) { c.partition = true; parts.push(c); }
          });
        }
      }

      var short = fullName.split('.').pop();
      var lower = short.toLowerCase();
      var layer = '公共层';
      for (var p = 0; p < prefixList.length; p++) {
        if (lower.indexOf(prefixList[p]) === 0) { layer = '应用层'; break; }
      }

      var partDesc = parts.length ? '以' + parts.map(function (x) { return x.name; }).join('、') + '作为数据分区' : '';
      tables.push({
        name: short,
        full: fullName,
        short: short,
        layer: layer,
        cn: tableComment || guessCN(short) || short,
        comment: tableComment,
        desc: partDesc,
        grain: '',
        source: '',
        cols: cols,
        partitions: parts
      });
    }

    return { tables: tables, errors: errors };
  }

  /* ---------------- 组装工作表 ---------------- */

  function fieldRows(table) {
    var rows = [];
    table.partitions.forEach(function (c) {
      rows.push({ cat: '分区字段', c: c });
    });
    table.cols.forEach(function (c) {
      rows.push({ cat: isNumericType(c.type) ? '指标' : '维度', c: c });
    });
    return rows;
  }

  function detailSheet(table) {
    var headLines = [
      '表名：' + table.name,
      '表中文名称：' + (table.cn || ''),
      '表内容描述：' + (table.desc || ''),
      '粒度：' + (table.grain || ''),
      '来源表：' + (table.source || '')
    ];
    var rows = [];
    rows.push({ h: Math.max(82, headLines.length * 16 + 2), cells: [{ v: headLines.join('\n'), s: S_BODY }, null, null, null, null] });
    rows.push({
      h: 15.75, cells: [
        { v: '分类', s: S_HEAD }, { v: '字段名', s: S_HEAD }, { v: '数据类型', s: S_HEAD },
        { v: '字段中文名', s: S_HEAD }, { v: '备注', s: S_HEAD }]
    });

    fieldRows(table).forEach(function (r) {
      var cn = r.c.comment || guessCN(r.c.name) || '';
      var wlen = String(cn).replace(/[\x21-\x7e]/g, 'x').length;
      var lines = Math.max(1, Math.ceil(wlen / 26));
      rows.push({
        h: 15.75 * lines, cells: [
          { v: r.cat, s: S_CELL },
          { v: r.c.name, s: S_CELL },
          { v: r.c.type, s: S_CELL },
          { v: cn, s: S_CELL_W },
          { v: '', s: S_CELL_W }]
      });
    });

    return {
      name: sheetName(table.cn || table.short),
      widths: [10, 34, 12, 52, 40],
      rows: rows,
      merges: ['A1:E1']
    };
  }

  var USED = {};
  function sheetName(raw) {
    var s = String(raw || 'Sheet').replace(/[\[\]\*\?\/\\:]/g, '').replace(/\s+/g, ' ').trim();
    if (!s) s = 'Sheet';
    if (s.length > 31) s = s.slice(0, 31);
    var base = s, n = 2;
    while (USED[s]) { s = base.slice(0, 28) + '(' + n + ')'; n++; }
    USED[s] = true;
    return s;
  }

  function catalogSheet(tables, opts) {
    var title = opts.title || '模型设计：';
    var rows = [];
    rows.push({ h: 15.75, cells: [{ v: title, s: S_TITLE }, null, null, { v: '备注', s: S_DEFAULT }] });

    var pub = tables.filter(function (t) { return t.layer === '公共层'; });
    var app = tables.filter(function (t) { return t.layer === '应用层'; });

    function section(label) {
      rows.push({ h: 15.75, cells: [{ v: label, s: S_DEFAULT }, { v: '表名', s: S_DEFAULT }, { v: '开发状态', s: S_CENTER }] });
    }
    function items(list) {
      list.forEach(function (t) {
        rows.push({ h: 15.75, cells: [{ v: t.name, s: S_DEFAULT }, { v: t.cn, s: S_DEFAULT }, { v: '', s: S_CENTER }] });
      });
    }

    section('公共层设计：'); items(pub);
    section('应用层设计：'); items(app);

    return { name: '目录', widths: [71.6, 85.1, 65.6, 38], rows: rows, merges: [] };
  }

  /* ---------------- 对外 API ---------------- */

  function buildSheets(tables, opts) {
    opts = opts || {};
    var sheets = [];
    if (opts.catalog !== false) sheets.push(catalogSheet(tables, opts));
    for (var i = 0; i < tables.length; i++) sheets.push(detailSheet(tables[i]));
    return sheets;
  }

  function bytesFromTables(tables, opts) {
    USED = {};
    return buildXlsx(buildSheets(tables, opts));
  }

  function bytes(ddl, opts) {
    var parsed = parseTables(ddl, opts);
    if (!parsed.tables.length) {
      var err = new Error(parsed.errors.length ? parsed.errors[0].message : '没有识别到任何建表语句');
      err.details = parsed.errors;
      throw err;
    }
    return bytesFromTables(parsed.tables, opts);
  }

  global.ModelDoc = {
    parse: parseTables,
    bytes: bytes,
    bytesFromTables: bytesFromTables,
    buildSheets: buildSheets,
    guessCN: guessCN,
    isNumericType: isNumericType,
    _splitStatements: splitStatements
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.ModelDoc;
})(typeof window !== 'undefined' ? window : globalThis);