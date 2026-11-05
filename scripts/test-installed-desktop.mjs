import { mkdtemp, cp, rm, readdir, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { execFileSafe } from '../companion/codex.mjs';
const root = await mkdtemp(join(tmpdir(), 'atlas-installed-'));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
let mounted = false, executable, updateExe;
const runTests = env => new Promise((done, reject) => {
  const args = ['--test', ...(env.ATLAS_DESKTOP_TEST_PATTERN ? ['--test-name-pattern', env.ATLAS_DESKTOP_TEST_PATTERN] : []), 'tests/desktop.integration.mjs'];
  const child = spawn(process.execPath, args, { stdio:'inherit', env });
  child.on('error', reject); child.on('exit', code => code === 0 ? done() : reject(new Error(`Installed app tests exited ${code}`)));
});
try {
  if (process.platform === 'darwin') {
    const mount = join(root, 'disk');
    await execFileSafe('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, resolve(`out/make/dmg/Viewport-Atlas-${version}-${process.arch}.dmg`)], { timeout:60000 });
    mounted = true;
    const installed = join(root, 'Installed App é', 'Viewport Atlas.app');
    await cp(join(mount, 'Viewport Atlas.app'), installed, { recursive:true, verbatimSymlinks:true });
    await execFileSafe('hdiutil', ['detach', mount], { timeout:60000 }); mounted = false;
    executable = join(installed, 'Contents/MacOS/viewport-atlas');
  } else if (process.platform === 'win32') {
    const installed = join(process.env.LOCALAPPDATA, 'ViewportAtlas');
    try { await access(installed); throw new Error('An existing Viewport Atlas installation was found. Run installation tests in a clean Windows account.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const folder = resolve(`out/make/squirrel.windows/${process.arch}`);
    const setup = (await readdir(folder)).find(file => /Setup\.exe$/i.test(file));
    if (!setup) throw new Error('Build the Windows Squirrel installer before testing installation.');
    await execFileSafe(join(folder, setup), ['--silent'], { timeout:120000 });
    executable = join(installed, `app-${version}`, 'viewport-atlas.exe');
    updateExe = join(installed, 'Update.exe');
  } else throw new Error('Installed desktop smoke tests require macOS or Windows.');
  const env = { ...process.env, ATLAS_DESKTOP_EXECUTABLE: executable, ATLAS_INSTALLED_SMOKE:'1' };
  delete env.ELECTRON_RUN_AS_NODE;
  await runTests(env);
} finally {
  if (mounted) await execFileSafe('hdiutil', ['detach', join(root, 'disk')], { timeout:60000 }).catch(console.error);
  if (updateExe) await execFileSafe(updateExe, ['--uninstall', '--silent'], { timeout:120000 }).catch(console.error);
  await rm(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
}
