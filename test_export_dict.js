// 端到端验证导出词典筛选：用项目真实 knowledgebase.js 函数
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = process.argv[2] || '.';
const src = fs.readFileSync(path.join(root, 'js/knowledgebase.js'), 'utf8');
const store = JSON.parse(fs.readFileSync(path.join(root, 'data/store.json'), 'utf8'));
const KB = store.kb || [];
const CATEGORY_LABEL = {
  vocabulary: '词汇库', expressions: '表达库', sentencePatterns: '句型库',
  beautifulSentences: '精彩句库', writingMaterials: '写作素材库', literary: '文学笔记', annotation: '批注'
};

const sandbox = {
  KB, CATEGORY_LABEL, console,
  document: { getElementById: () => null },
  window: {}, setTimeout: () => {},
  TextEncoder: require('util').TextEncoder,
  Uint8Array, ArrayBuffer, Blob: function(){}, URL: { createObjectURL: ()=>'', revokeObjectURL: ()=>{} },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext('var __downloads=[]; function download(name,content,mime){ __downloads.push({name,content:String(content)}); }', sandbox);
vm.runInContext(src, sandbox);
// 关键：把真实 KB 注入到 knowledgebase.js 内部（它自己声明 let KB=[], 由 loadKB 填充）
vm.runInContext('loadKB(' + JSON.stringify(KB) + ');', sandbox);

const sample = KB.find(e => e.category === 'vocabulary' && Array.isArray(e.fields && e.fields.defs) && e.fields.defs.length >= 2);
console.log('测试样本词:', sample && sample.fields.word, '| 词典:', sample && sample.fields.defs.map(d=>d.dict).join('/'));

function runWith(selectedDict) {
  return sandbox.buildMarkdown('full', { books: null, cats: new Set(['vocabulary']), selectedDict: selectedDict || null });
}

const allMd = runWith(null);
const larousseMd = runWith('Larousse');

console.log('\n=== 测试1: 不选词典（应含 Le Robert / Larousse / CNRTL） ===');
['Le Robert','Larousse','CNRTL'].forEach(d => {
  console.log(`  含 ${d}：`, allMd.includes(d + '：') ? '是 ✅' : '否 ❌');
});

console.log('\n=== 测试2: 选 Larousse（应只含 Larousse，不含 Le Robert / CNRTL） ===');
console.log('  含 Larousse：', larousseMd.includes('Larousse：') ? '是 ✅' : '否 ❌');
console.log('  含 Le Robert：', larousseMd.includes('Le Robert：') ? '❌ 不应出现' : '否 ✅');
console.log('  含 CNRTL：', larousseMd.includes('CNRTL：') ? '❌ 不应出现' : '否 ✅');

const ok = larousseMd.includes('Larousse：') && !larousseMd.includes('Le Robert：') && !larousseMd.includes('CNRTL：');
console.log('\n结论: 导出弹窗“仅导出该词典释义”下拉', ok ? '✅ 代码层面生效' : '❌ 存在 bug');
