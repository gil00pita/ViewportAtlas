import { cp, mkdir, mkdtemp, rm, symlink, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSafe } from "../companion/codex.mjs";
if (process.platform === "darwin") {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const stage = await mkdtemp(join(tmpdir(), 'atlas-dmg-'));
  const destination = resolve('out/make/dmg');
  const file = join(destination, `Viewport-Atlas-${version}-${process.arch}.dmg`);
  try {
    await mkdir(destination, { recursive: true });
    await cp(resolve(`out/Viewport Atlas-darwin-${process.arch}/Viewport Atlas.app`), join(stage, 'Viewport Atlas.app'), { recursive: true, verbatimSymlinks: true });
    await symlink('/Applications', join(stage, 'Applications'));
    await execFileSafe('hdiutil', ['create', '-volname', 'Viewport Atlas', '-srcfolder', stage, '-ov', '-format', 'UDZO', file], { timeout: 180000 });
    if (process.env.ATLAS_RELEASE === '1') {
      await execFileSafe('codesign', ['--force', '--timestamp', '--sign', process.env.MAC_SIGNING_IDENTITY, file], { timeout: 60000 });
      await execFileSafe('xcrun', ['notarytool', 'submit', file, '--apple-id', process.env.APPLE_ID, '--password', process.env.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', process.env.APPLE_TEAM_ID, '--wait'], { timeout: 1200000 });
      await execFileSafe('xcrun', ['stapler', 'staple', file], { timeout: 60000 });
    }
    console.log(`Created ${file}`);
  } finally { await rm(stage, { recursive: true, force: true }); }
}
