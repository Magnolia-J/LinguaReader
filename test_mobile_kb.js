const fs = require("fs");
const vm = require("vm");
const html = fs.readFileSync("public/index.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function stubEl() {
  return {
    _html: "", value: "", textContent: "",
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, querySelectorAll() { return []; },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
  };
}
const els = {};
const document = {
  getElementById(id) { return els[id] || (els[id] = stubEl()); },
  querySelectorAll() { return []; }, addEventListener() {},
};
const sandbox = {
  document, console,
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  window: {}, setTimeout, fetch: async () => ({ ok: false, json: async () => ({}) }),
  supabase: null, location: { search: "" },
};
sandbox.window = sandbox;

const test = `
DATA = { kb: [
  {book:"Book A", author:"x", category:"vocabulary", fields:{word:"w"}, createdAt:"1"},
  {book:"Book B", author:"y", category:"expressions", fields:{expression:"e"}, createdAt:"2"},
  {book:"", author:"", category:"literary", fields:{}, createdAt:"3"}
]};
kbBook="all"; kbCat="all"; kbQ="";
populateKbBookFilter();
console.log("OPTIONS:\\n" + document.getElementById("kb-book-filter").innerHTML.replace(/<\\/option>/g,"</option>\\n"));
function countCards(){ return (document.getElementById("kb-list").innerHTML.match(/kb-card/g)||[]).length; }
kbBook="all"; renderKb(); console.log("all -> cards:", countCards());
kbBook="Book A"; renderKb(); console.log("Book A -> cards:", countCards());
kbBook="Book B"; renderKb(); console.log("Book B -> cards:", countCards());
kbBook="__none__"; renderKb(); console.log("__none__ -> cards:", countCards());
`;
vm.createContext(sandbox);
vm.runInContext(script + "\n" + test, sandbox);
