/* Confere se o app.asar empacotado tem o código novo. */
const a = require('@electron/asar');
const p = 'release/win-unpacked/resources/app.asar';
const list = a.listPackage(p).map((x) => x.replace(/^[\\/]+/, ''));
console.log('arquivos no asar:', list.length, '| ws:', list.some((x) => /node_modules[\\/]ws[\\/]index\.js$/.test(x)));
const main = a.extractFile(p, list.find((x) => /dist[\\/]main[\\/]main\.js$/.test(x))).toString();
const rend = a.extractFile(p, list.find((x) => /dist[\\/]renderer[\\/]renderer\.js$/.test(x))).toString();
const check = (src, keys) => keys.map((k) => `${k}=${src.includes(k) ? 'ok' : 'FALTA'}`).join('  ');
console.log('main  :', check(main, ['agy', 'run.preflight', 'plugins:list', 'exportLibrary', 'parseAgyModels', 'runTool', 'web_search', 'shellFor', 'sceneConcurrency']));
console.log('render:', check(rend, ['prog-fill', 'ed-preflight', 'refreshProject', 'Plugin', 'deliverables']));
console.log('index.html:', a.extractFile(p, list.find((x) => /renderer[\\/]index\.html$/.test(x))).toString().includes('Configurações'));
