const no = () => false, none = () => undefined;
export const existsSync = no, mkdirSync = none, writeFileSync = none, rmSync = none, unlinkSync = none, appendFileSync = none;
export const readFileSync = () => { throw new Error("arquivo indisponível no navegador"); };
export const readdirSync = () => [], statSync = () => ({ isDirectory: no, isFile: no, size: 0 });
export const promises = { readFile: async () => { throw new Error("arquivo indisponível"); }, writeFile: async () => {}, mkdir: async () => {} };
export default { existsSync, mkdirSync, writeFileSync, rmSync, unlinkSync, appendFileSync, readFileSync, readdirSync, statSync, promises };