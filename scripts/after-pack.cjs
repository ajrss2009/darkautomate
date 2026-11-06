/*
 * Depois de empacotar (electron-builder afterPack): grava o ícone do Dark Automate e o nome/versão no .exe.
 * A edição nativa do electron-builder está desligada (signAndEditExecutable: false, evita baixar o winCodeSign),
 * então o ícone entra aqui com a biblioteca resedit (JavaScript puro, sem binários externos).
 */
const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const name = ctx.packager.appInfo.productFilename;
  const exe = path.join(ctx.appOutDir, `${name}.exe`);
  if (!fs.existsSync(exe)) { console.warn(`after-pack: ${exe} não encontrado`); return; }
  const ico = path.join(__dirname, '..', 'build', 'icon.ico');
  const version = ctx.packager.appInfo.version;
  const data = fs.readFileSync(exe);
  const exeObj = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const rs = ResEdit.NtExecutableResource.from(exeObj);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(ico));
  /* substitui o grupo de ícones principal (id 1) — é o que o Windows mostra no Explorer, na barra e no atalho */
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(rs.entries);
  const groupId = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(rs.entries, groupId, lang, iconFile.icons.map((i) => i.data));
  /* nome e descrição do produto nas propriedades do arquivo */
  const vi = ResEdit.Resource.VersionInfo.fromEntries(rs.entries)[0] ?? ResEdit.Resource.VersionInfo.createEmpty();
  const [a, b, c] = version.split('.').map((x) => parseInt(x, 10) || 0);
  vi.setFileVersion(a, b, c, 0, lang); vi.setProductVersion(a, b, c, 0, lang);
  vi.setStringValues({ lang, codepage: 1200 }, { ProductName: 'Dark Automate', FileDescription: 'Dark Automate', CompanyName: 'Dark Automate', InternalName: 'Dark Automate', OriginalFilename: `${name}.exe`, ProductVersion: version, FileVersion: version });
  vi.outputToResourceEntries(rs.entries);
  rs.outputResource(exeObj);
  fs.writeFileSync(exe, Buffer.from(exeObj.generate()));
  console.log(`after-pack: ícone e nome gravados em ${path.basename(exe)}`);
};
