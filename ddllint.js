/*  ddllint.js — 建表规范体检（数仓建模 Lint）
    零依赖，依赖 modeldoc.js 的 window.ModelDoc.parse
    用法：DDLLint.check(ddlText, opts) -> { tables, summary, markdown }
    opts: layers('ods,dwd,dws,ads,dim,tmp,app,rpt')
*/
(function (global) {
  'use strict';

  var RESERVED = ('select,from,where,group,order,by,having,join,left,right,inner,outer,full,on,as,and,or,not,' +
    'null,true,false,case,when,then,else,end,in,is,like,between,union,all,distinct,insert,update,delete,' +
    'create,drop,alter,table,index,key,values,set,into,limit,offset,desc,asc,user,date,time,timestamp,' +
    'comment,primary,foreign,check,default,constraint,partition,over,rows,range,current,level,type,status,' +
    'value,values,column,columns,file,format,location,stored,row,lines,terminated').split(',');

  var LAYERS = ['ods', 'dwd', 'dws', 'ads', 'dim', 'tmp', 'app', 'rpt'];
  var AMOUNT_RE = /(amt|amount|price|fee|cost|money|payment|gmv|sales|discount|tax|balance|revenue|income|salary)/i;
  var DATE_NAME_RE = /(_date|_dt|_day|_time|_ts|^dt$|^ds$|^dt_|^ds_)/i;
  var PK_NAME_RE = /(^id$|_id$|_no$|_code$|_key$|_uuid$)/i;
  var AUDIT_RE = /^(etl_time|etl_date|update_time|modified_time|modify_time|create_time|created_at|updated_at)$/i;

  function lc(s) { return String(s == null ? '' : s).toLowerCase(); }
  function typeBase(t) { return lc(t).replace(/\(.*$/, '').replace(/<.*$/, '').trim(); }
  function has(text, re) { return re.test(text); }

  function push(list, level, rule, message, field, hint) {
    list.push({ level: level, rule: rule, message: message, field: field || '', hint: hint || '' });
  }

  function checkTable(t, opts) {
    var issues = [];
    var short = t.short || t.full.split('.').pop();
    var name = lc(short);

    // 1. 表名基础规范
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      push(issues, 'error', '表名格式', '表名「' + short + '」包含大写字母、中文或特殊字符，建议全小写下划线', short, '统一小写 + 下划线，避免大小写敏感问题');
    }
    if (name.length > 64) {
      push(issues, 'error', '表名长度', '表名超过 64 字符（' + name.length + '）', short, '缩短表名，保留业务含义即可');
    }

    // 2. 分层前缀
    var layer = '';
    for (var i = 0; i < LAYERS.length; i++) {
      if (name.indexOf(LAYERS[i] + '_') === 0) { layer = LAYERS[i]; break; }
    }
    if (!layer) {
      push(issues, 'warn', '分层前缀', '表名缺少数仓分层前缀（ods_/dwd_/dws_/ads_/dim_/tmp_）', short, '按 ODS → DWD → DWS → ADS 分层命名，便于血缘与权限管理');
    }

    // 3. 全量 / 增量后缀
    if (layer === 'dwd' || layer === 'dws' || layer === 'ads') {
      if (!/(_df|_di|_zip|_tmp)$/.test(name)) {
        push(issues, 'info', '表后缀', '明细 / 汇总表建议以 _df（全量）、_di（增量）或 _zip（拉链）结尾', short, '后缀能直接表达更新方式，减少下游误用');
      }
    }

    // 4. 表注释
    if (!String(t.comment || '').trim()) {
      push(issues, 'error', '表注释', '缺少表注释（COMMENT），数据地图 / 血缘平台无法识别业务含义', short, "在建表语句末尾补 COMMENT '业务含义'");
    }

    // 5. 字段注释
    var noComment = t.cols.filter(function (c) { return !String(c.comment || '').trim(); });
    if (noComment.length) {
      var names = noComment.slice(0, 10).map(function (c) { return c.name; }).join('、');
      push(issues, 'warn', '字段注释',
        noComment.length + ' 个字段缺少注释：' + names + (noComment.length > 10 ? ' 等' : ''),
        '', '字段注释是模型文档与指标口径的基础，建议补全');
    }

    // 6. 字段命名 / 保留字 / 长度
    var badName = [], reserved = [], tooLong = [];
    t.cols.forEach(function (c) {
      var n = lc(c.name);
      if (!/^[a-z][a-z0-9_]*$/.test(n)) badName.push(c.name);
      if (RESERVED.indexOf(n) >= 0) reserved.push(c.name);
      if (n.length > 64) tooLong.push(c.name);
    });
    if (badName.length) push(issues, 'warn', '字段命名', '字段名不规范：' + badName.slice(0, 8).join('、') + (badName.length > 8 ? ' 等' : ''), '', '字段名统一小写下划线，避免中文 / 驼峰');
    if (reserved.length) push(issues, 'warn', '保留字', '字段名使用了 SQL 保留字：' + reserved.join('、'), '', '保留字在不同引擎兼容性差，建议加业务前缀或改名');
    if (tooLong.length) push(issues, 'error', '字段长度', '字段名超过 64 字符：' + tooLong.join('、'), '', '缩短字段名');

    // 7. 类型规范
    var noLen = [], decimalNoScale = [], amountFloat = [], dateString = [], intId = [];
    t.cols.forEach(function (c) {
      var bt = typeBase(c.type), n = lc(c.name);
      if (/^(varchar|char)$/.test(bt) && !/\(\s*\d+\s*\)/.test(c.type)) noLen.push(c.name);
      if (/^(decimal|numeric|number)$/.test(bt) && !/\(\s*\d+\s*(,\s*\d+\s*)?\)/.test(c.type)) decimalNoScale.push(c.name);
      if (AMOUNT_RE.test(n) && /^(float|double|real)$/.test(bt)) amountFloat.push(c.name);
      if (DATE_NAME_RE.test(n) && /^string$/.test(bt)) dateString.push(c.name);
      if (PK_NAME_RE.test(n) && /^(int|integer|smallint|tinyint)$/.test(bt)) intId.push(c.name);
    });
    if (noLen.length) push(issues, 'error', '变长类型', 'VARCHAR / CHAR 未指定长度：' + noLen.join('、'), '', '补上长度，如 varchar(64)，否则部分引擎建表失败');
    if (decimalNoScale.length) push(issues, 'warn', '数值精度', 'DECIMAL 未指定精度：' + decimalNoScale.join('、'), '', '金额建议 decimal(18,2)，比率 decimal(18,6)');
    if (amountFloat.length) push(issues, 'warn', '金额类型', '金额类字段使用 float/double 有精度风险：' + amountFloat.join('、'), '', '金额统一 decimal(18,2)，避免浮点误差');
    if (dateString.length) push(issues, 'info', '日期类型', '日期 / 时间字段使用 string：' + dateString.slice(0, 8).join('、') + (dateString.length > 8 ? ' 等' : ''), '', '若下游需日期计算，建议 date / timestamp；分区字段用 yyyyMMdd string 可保留');
    if (intId.length) push(issues, 'warn', '主键类型', 'ID 类字段用了 int：' + intId.slice(0, 8).join('、'), '', '主键 / 外键建议 bigint，int 上限约 21 亿，数据量增长后易溢出');

    // 8. 分区
    if (!t.partitions.length) {
      if (layer === 'dwd' || layer === 'dws' || layer === 'ads') {
        push(issues, 'warn', '分区设计', '事实 / 汇总表未设置分区字段', short, '按 dt / ds 分区，避免全表扫描并支持重跑');
      }
    } else {
      t.partitions.forEach(function (p) {
        var bt = typeBase(p.type);
        if (!/^(string|int|integer|bigint|smallint|tinyint|date)$/.test(bt)) {
          push(issues, 'warn', '分区类型', '分区字段「' + p.name + '」类型为 ' + p.type + '，建议 string / int / date', p.name, '分区字段类型影响分区裁剪与元数据性能');
        }
        if (!/^(dt|ds|pt|day|month|hour|biz_date|stat_date)$/i.test(p.name)) {
          push(issues, 'info', '分区命名', '分区字段名「' + p.name + '」不是常见命名（dt/ds/pt）', p.name, '统一分区字段名，便于跨表 UNION 与调度模板复用');
        }
        if (!String(p.comment || '').trim()) {
          push(issues, 'info', '分区注释', '分区字段「' + p.name + '」缺少注释', p.name, '注明格式，如 yyyyMMdd / yyyy-MM-dd');
        }
      });
    }

    // 9. 审计字段
    var audit = t.cols.some(function (c) { return AUDIT_RE.test(lc(c.name)); });
    if (!audit && t.cols.length >= 6) {
      push(issues, 'info', '审计字段', '未发现 etl_time / update_time 等审计字段', short, '补更新时间与 ETL 时间，便于增量同步与问题追溯');
    }

    // 10. 主键类字段
    if (!t.cols.some(function (c) { return PK_NAME_RE.test(lc(c.name)); })) {
      push(issues, 'info', '主键线索', '未发现 id / _no / _code 等主键类字段', short, '明确业务主键，便于去重、拉链与幂等重跑');
    }

    // 11. 字段数量
    if (t.cols.length > 200) {
      push(issues, 'warn', '字段数量', '字段数量过多（' + t.cols.length + '）', short, '宽表建议控制字段数，或拆分为明细 + 扩展表');
    }

    // 计分
    var cost = { error: 10, warn: 4, info: 1 };
    var score = 100;
    issues.forEach(function (it) { score -= cost[it.level] || 1; });
    score = Math.max(0, score);
    var grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';

    return { name: t.name, full: t.full, layer: layer || '未分层', score: score, grade: grade, issues: issues };
  }

  function check(ddl, opts) {
    opts = opts || {};
    var m = global.ModelDoc;
    if (!m) throw new Error('modeldoc.js 未加载');
    var parsed = m.parse(ddl || '', opts);
    if (!parsed.tables.length) {
      throw new Error(parsed.errors.length ? parsed.errors[0].message : '没有识别到 CREATE TABLE 语句');
    }
    var tables = parsed.tables.map(function (t) { return checkTable(t, opts); });
    var summary = { tables: tables.length, errors: 0, warns: 0, infos: 0, avgScore: 0, grade: 'A' };
    tables.forEach(function (t) {
      t.issues.forEach(function (i) {
        if (i.level === 'error') summary.errors++;
        else if (i.level === 'warn') summary.warns++;
        else summary.infos++;
      });
    });
    summary.avgScore = Math.round(tables.reduce(function (s, t) { return s + t.score; }, 0) / tables.length);
    summary.grade = summary.avgScore >= 90 ? 'A' : summary.avgScore >= 75 ? 'B' : summary.avgScore >= 60 ? 'C' : 'D';

    var md = ['# 建模规范体检报告', '',
      '- 生成时间：' + new Date().toLocaleString('zh-CN'),
      '- 总体：' + summary.tables + ' 张表 · 平均 ' + summary.avgScore + ' 分（' + summary.grade + '）',
      '- 问题：' + summary.errors + ' 错误 / ' + summary.warns + ' 警告 / ' + summary.infos + ' 提示', ''];
    tables.forEach(function (t) {
      md.push('## ' + t.full + ' · ' + t.score + ' 分（' + t.grade + '） · ' + t.layer);
      if (!t.issues.length) md.push('- 未发现问题 ✓');
      t.issues.forEach(function (i) {
        var tag = i.level === 'error' ? '错误' : i.level === 'warn' ? '警告' : '提示';
        md.push('- [' + tag + '] ' + i.message + (i.hint ? '（建议：' + i.hint + '）' : ''));
      });
      md.push('');
    });
    return { tables: tables, summary: summary, errors: parsed.errors, markdown: md.join('\n') };
  }

  global.DDLLint = { check: check, _checkTable: checkTable };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.DDLLint;
})(typeof window !== 'undefined' ? window : globalThis);