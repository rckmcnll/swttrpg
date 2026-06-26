#!/usr/bin/env node
/*
 * convert-catalog.mjs — OggDude DataSet (XML) -> fad-catalog.js
 *
 * Reads a user-supplied OggDude "Star Wars Character Generator" DataSet and emits
 * fad-catalog.js (window.FAD_CATALOG, schema "fad-catalog-v1") for the Force & Destiny
 * character sheet. See docs/multi-tree-catalog-spec.md.
 *
 * Usage:  node tools/convert-catalog.mjs <path-to-DataSet/Data> [outFile]
 *   <DataDir>  folder containing Talents.xml, Skills.xml, "Force Abilities.xml",
 *              and the Careers/ Specializations/ "Force Powers"/ subfolders.
 *   [outFile]  output path (default: ./fad-catalog.js)
 *
 * Scope: Force & Destiny only — careers whose ForceRating >= 1, the specializations
 * they grant (+ Universal specializations), and all Force powers.
 *
 * LICENSING: this is a DEV-ONLY build step. It reads a dataset the user already
 * possesses; it is not shipped to the sheet user. OggDude's public descriptions are
 * page-reference stubs (not rulebook prose), so the generated catalog carries names +
 * page references only.  Zero external dependencies (no npm install required).
 */
import fs from 'node:fs';
import path from 'node:path';

/* ----------------------------- tiny XML parser ----------------------------- */
function decode(s){
  return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
          .replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,d)=>String.fromCharCode(+d))
          .replace(/&#x([0-9a-fA-F]+);/g,(_,h)=>String.fromCharCode(parseInt(h,16)))
          .replace(/&amp;/g,'&');
}
function parseXML(src){
  let s = src.replace(/<\?xml[^>]*\?>/g,'').replace(/<!--[\s\S]*?-->/g,'');
  let i = 0;
  function parseNodes(){
    const nodes = [];
    while(i < s.length){
      if(s[i] !== '<'){
        let j = s.indexOf('<', i); if(j < 0) j = s.length;
        const text = s.slice(i, j); i = j;
        if(text.trim()) nodes.push({ type:'text', text: decode(text) });
        continue;
      }
      if(s.startsWith('</', i)){ i = s.indexOf('>', i) + 1; return nodes; }
      let j = s.indexOf('>', i);
      let raw = s.slice(i + 1, j); i = j + 1;
      const selfClose = raw.endsWith('/');
      if(selfClose) raw = raw.slice(0, -1);
      const sp = raw.search(/\s/);
      const tag = sp < 0 ? raw : raw.slice(0, sp);
      const attrs = {};
      if(sp >= 0){ const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g; let m; while((m = re.exec(raw.slice(sp)))) attrs[m[1]] = decode(m[2]); }
      const node = { type:'el', tag, attrs, children: [] };
      if(!selfClose) node.children = parseNodes();
      nodes.push(node);
    }
    return nodes;
  }
  return parseNodes().find(n => n.type === 'el');
}
const kids   = (n, tag) => (n ? n.children.filter(c => c.type === 'el' && c.tag === tag) : []);
const kid    = (n, tag) => kids(n, tag)[0] || null;
const txt    = (n) => n ? n.children.filter(c => c.type === 'text').map(c => c.text).join('').replace(/\s+/g,' ').trim() : '';
const ktext  = (n, tag) => txt(kid(n, tag));
const keyList = (n, tag) => kids(kid(n, tag), 'Key').map(k => txt(k));

/* ------------------------------- helpers ---------------------------------- */
const readXML = (p) => parseXML(fs.readFileSync(p, 'utf8'));
const lc = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'');

const ACTIVATION = {
  taPassive:'Passive', taActive:'Active', taManeuver:'Maneuver', taAction:'Action',
  taIncidental:'Incidental', taIncidentalOOT:'Incidental (Out of Turn)'
};
const activation = (v) => ACTIVATION[v] || (v ? v.replace(/^ta/,'') : '');

function classifyUpgrade(key, name){
  const s = (key + ' ' + name).toLowerCase();
  if(/basic/.test(s)) return 'basic';
  if(/mastery/.test(s)) return 'mastery';
  if(/magnitude/.test(s)) return 'magnitude';
  if(/strength/.test(s)) return 'strength';
  if(/duration/.test(s)) return 'duration';
  if(/\brange\b|range/.test(s)) return 'range';
  if(/control/.test(s)) return 'control';
  return 'control';
}
function sourceText(n){
  const direct = kid(n, 'Source');
  if(direct) return txt(direct);
  const set = kid(n, 'Sources');
  if(set){ const all = kids(set, 'Source'); const fad = all.find(s => /Force and Destiny/i.test(txt(s))); return txt(fad || all[0] || null); }
  return '';
}

const warnings = [];

/* ----------------- direction grid -> from/to/down|right edges -------------- */
// rows: array of { cells:[{col,span,nodeId,dir:{Left,Right,Up,Down}} per START cell] , grid:[colIndex->nodeId] }
function buildEdges(rows){
  const edges = [];
  const seen = new Set();
  const add = (from, to, direction) => {
    if(!from || !to || from === to) return;
    const k = from + '|' + to;
    if(seen.has(k)) return;
    seen.add(k); edges.push({ from, to, direction });
  };
  for(let r = 0; r < rows.length; r++){
    for(const cell of rows[r].cells){
      for(let j = cell.col; j < cell.col + cell.span; j++){
        const d = rows[r].dirs[j] || {};
        if(d.Down && rows[r+1]) add(cell.nodeId, rows[r+1].grid[j], 'down');
        if(d.Right) add(cell.nodeId, rows[r].grid[j+1], 'right');
      }
    }
  }
  return edges;
}
const dirOf = (dirNode) => ({
  Left: ktext(dirNode,'Left') === 'true', Right: ktext(dirNode,'Right') === 'true',
  Up: ktext(dirNode,'Up') === 'true', Down: ktext(dirNode,'Down') === 'true'
});

/* --------------------------------- main ----------------------------------- */
const DATA = process.argv[2];
const OUT  = process.argv[3] || path.resolve(process.cwd(), 'fad-catalog.js');
if(!DATA){ console.error('Usage: node convert-catalog.mjs <DataSet/Data dir> [outFile]'); process.exit(2); }

// 1. Talents lookup
const talents = {};
for(const t of kids(readXML(path.join(DATA,'Talents.xml')), 'Talent')){
  const key = ktext(t,'Key');
  talents[key] = { name: ktext(t,'Name'), description: ktext(t,'Description'),
    activation: activation(ktext(t,'ActivationValue')),
    ranked: ktext(t,'Ranked') === 'true', forceTalent: ktext(t,'ForceTalent') === 'true' };
}
// 2. Force abilities lookup
const abilities = {};
for(const a of kids(readXML(path.join(DATA,'Force Abilities.xml')), 'ForceAbility')){
  abilities[ktext(a,'Key')] = { name: ktext(a,'Name'), description: ktext(a,'Description') };
}
// 3. Skills lookup (key -> name)
const skillName = {};
try { for(const sk of kids(readXML(path.join(DATA,'Skills.xml')), 'Skill')) skillName[ktext(sk,'Key')] = ktext(sk,'Name'); }
catch { warnings.push('Skills.xml missing; career skills shown as keys'); }
const skillNames = (keys) => keys.map(k => skillName[k] || k);

// 4. Careers -> F&D set (ForceRating >= 1)
const careers = {};
const specToCareer = {};
for(const f of fs.readdirSync(path.join(DATA,'Careers')).filter(f => f.endsWith('.xml'))){
  const c = readXML(path.join(DATA,'Careers',f));
  const fr = Number(ktext(kid(c,'Attributes'),'ForceRating') || 0);
  if(fr < 1) continue; // not Force & Destiny
  const key = ktext(c,'Key');
  const specs = keyList(c,'Specializations');
  careers[key] = { key, name: ktext(c,'Name'), source: sourceText(c),
    careerSkills: skillNames(keyList(c,'CareerSkills')), specializations: specs };
  specs.forEach(s => { if(!specToCareer[s]) specToCareer[s] = key; });
}

// 5. Specializations (F&D-career-granted or Universal)
const specializations = {};
for(const f of fs.readdirSync(path.join(DATA,'Specializations')).filter(f => f.endsWith('.xml'))){
  const sp = readXML(path.join(DATA,'Specializations',f));
  const key = ktext(sp,'Key');
  const universal = ktext(sp,'Universal') === 'true';
  const career = specToCareer[key] || null;
  if(!career && !universal) continue; // skip EotE/AoR-only specs
  const rows = [];
  const trRows = kids(kid(sp,'TalentRows'),'TalentRow');
  trRows.forEach((row, r) => {
    const tKeys = keyList(row,'Talents');
    const dirs = kids(kid(row,'Directions'),'Direction').map(dirOf);
    const cost = Number(ktext(row,'Cost') || 0);
    const grid = []; const cells = [];
    tKeys.forEach((tk, c) => {
      const det = talents[tk] || (warnings.push(`talent ${tk} (spec ${key}) not found`), { name: tk, description:'', activation:'', ranked:false, forceTalent:false });
      const id = `${lc(key)}_r${r+1}c${c+1}_${lc(tk)}`;
      grid[c] = id;
      cells.push({ col:c, span:1, nodeId:id });
      (specializations[key] ||= { nodes: [] }).nodes.push({
        id, key: tk, name: det.name, row: r+1, column: c+1, span: 1, cost,
        activation: det.activation, ranked: det.ranked, forceTalent: det.forceTalent, description: det.description });
    });
    rows.push({ grid, dirs, cells });
  });
  const meta = specializations[key] || { nodes: [] };
  Object.assign(meta, { key, name: ktext(sp,'Name'), kind:'specialization', career,
    careerSkills: skillNames(keyList(sp,'CareerSkills')), source: sourceText(sp), columns: 4,
    edges: buildEdges(rows) });
  specializations[key] = meta;
}

// 6. Force powers
const forcePowers = {};
for(const f of fs.readdirSync(path.join(DATA,'Force Powers')).filter(f => f.endsWith('.xml'))){
  const fp = readXML(path.join(DATA,'Force Powers',f));
  const key = ktext(fp,'Key');
  const nodes = [];
  const rows = [];
  kids(kid(fp,'AbilityRows'),'AbilityRow').forEach((row, r) => {
    const aKeys = keyList(row,'Abilities');
    const spans = kids(kid(row,'AbilitySpan'),'Span').map(s => Number(txt(s) || 0));
    const costs = kids(kid(row,'Costs'),'Cost').map(s => Number(txt(s) || 0));
    const dirs = kids(kid(row,'Directions'),'Direction').map(dirOf);
    const grid = []; const cells = [];
    for(let c = 0; c < aKeys.length; ){
      const span = spans[c];
      const ak = aKeys[c];
      if(!span || !ak){ c += 1; continue; } // empty/covered cell (a hole in the grid)
      const det = abilities[ak] || (warnings.push(`ability ${ak} (power ${key}) not found`), { name: ak, description:'' });
      const id = `${lc(key)}_r${r+1}c${c+1}_${lc(ak)}`;
      for(let j = c; j < c + span; j++) grid[j] = id;
      cells.push({ col:c, span, nodeId:id });
      nodes.push({ id, key: ak, name: det.name, row: r+1, column: c+1, span, cost: costs[c] || 0,
        activation:'', ranked:false, forceTalent:true, description: det.description, upgrade: classifyUpgrade(ak, det.name) });
      c += span;
    }
    rows.push({ grid, dirs, cells });
  });
  forcePowers[key] = { key, name: ktext(fp,'Name'), kind:'force_power', career:null,
    source: sourceText(fp), description: ktext(fp,'Description'), columns: 4, nodes, edges: buildEdges(rows) };
}

/* ------------------------------ validate ---------------------------------- */
let unresolved = 0;
const checkEdges = (t) => { const ids = new Set(t.nodes.map(n => n.id)); for(const e of t.edges){ if(!ids.has(e.from) || !ids.has(e.to)){ warnings.push(`${t.key}: edge ${e.from}->${e.to} has missing endpoint`); unresolved++; } } };
Object.values(specializations).forEach(checkEdges);
Object.values(forcePowers).forEach(checkEdges);
const universalCount = Object.values(specializations).filter(s => !s.career).length;
let nodeCount = 0, edgeCount = 0;
[...Object.values(specializations), ...Object.values(forcePowers)].forEach(t => { nodeCount += t.nodes.length; edgeCount += t.edges.length; });

/* ------------------------------- emit ------------------------------------- */
// stable key ordering for clean diffs
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
const catalog = {
  schema: 'fad-catalog-v1', version: 1, generatedAt: new Date().toISOString(),
  source: 'OggDude DataSet (user-supplied) — Force & Destiny',
  careers: sortKeys(careers), specializations: sortKeys(specializations), forcePowers: sortKeys(forcePowers)
};
const banner = `/* GENERATED by tools/convert-catalog.mjs from an OggDude DataSet. Do not edit by hand.\n` +
  `   Descriptions are OggDude page-reference stubs. Regenerate with: node tools/convert-catalog.mjs <Data> */\n`;
fs.writeFileSync(OUT, banner + 'window.FAD_CATALOG = Object.freeze(\n' + JSON.stringify(catalog, null, 2) + '\n);\n', 'utf8');

console.log(`careers (F&D):     ${Object.keys(careers).length}  [${Object.keys(careers).join(', ')}]`);
console.log(`specializations:   ${Object.keys(specializations).length}  (universal: ${universalCount})`);
console.log(`force powers:      ${Object.keys(forcePowers).length}`);
console.log(`nodes / edges:     ${nodeCount} / ${edgeCount}`);
console.log(`warnings:          ${warnings.length}`);
if(warnings.length) console.log(warnings.slice(0, 20).map(w => '  - ' + w).join('\n'));
console.log(`wrote ${OUT}`);
process.exit(unresolved ? 1 : 0);
