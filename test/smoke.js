// Open-source smoke test: verify every module loads via CommonJS and still works.
const MD = require('../modeldoc.js');
const DC = require('../ddlchange.js');
const DL = require('../ddllint.js');
const PF = require('../profiler.js');

const oldDdl = `CREATE TABLE dwd_mbr_member_df (
  member_id bigint COMMENT '会员ID',
  member_name string COMMENT '会员名称',
  amt decimal(18,2) COMMENT '金额',
  created_at string COMMENT '创建时间'
) COMMENT '会员明细表' PARTITIONED BY (dt string COMMENT '日期分区');`;

const newDdl = `CREATE TABLE dwd_mbr_member_df (
  member_id bigint COMMENT '会员ID',
  member_name string COMMENT '会员名称',
  nick_name string COMMENT '昵称',
  amt decimal(20,4) COMMENT '订单金额',
  created_at string COMMENT '创建时间'
) COMMENT '会员明细表' PARTITIONED BY (dt string COMMENT '日期分区');`;

const p = MD.parse(oldDdl, {});
console.log('ModelDoc   tables=' + p.tables.length + ' cols=' + p.tables[0].cols.length);

const c = DC.build(oldDdl, newDdl, { dialect: 'hive', rename: true });
console.log('DDLChange  ' + JSON.stringify(c.summary));
console.log('DDLChange  sql=' + c.sql.split('\n').filter(l => l.trim()).length + ' lines');

const l = DL.check(newDdl, {});
console.log('DDLLint    score=' + l.summary.avgScore + ' grade=' + l.summary.grade +
  ' e/w/i=' + l.summary.errors + '/' + l.summary.warns + '/' + l.summary.infos);

const f = PF.build(newDdl, {});
console.log('Profiler   tables=' + f.stats.tables + ' cols=' + f.stats.cols + ' lines=' + f.stats.lines);

const ok = p.tables.length === 1 && c.ok && c.summary.addCols === 1 && c.summary.modCols === 1 &&
  typeof l.summary.avgScore === 'number' && f.stats.lines > 50;
console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL');
process.exit(ok ? 0 : 1);