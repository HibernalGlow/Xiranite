import {mkdtemp, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const projectRoot = resolve(import.meta.dir, '..');
const outputDirectory = resolve(
  projectRoot,
  '../../output/legal-jurisdiction-animation/motion-canvas',
);
const baseUrl = 'http://127.0.0.1:9000';

type AgentStatus = {
  readonly connected: boolean;
  readonly rendering: boolean;
  readonly errors: readonly {readonly message: string}[];
};

const delay = (milliseconds: number) =>
  new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const resolveBrowserExecutable = async () => {
  const candidates = [
    process.env.MOTION_CANVAS_BROWSER,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }

  throw new Error('Chrome or Edge was not found. Set MOTION_CANVAS_BROWSER.');
};

const waitForAgent = async (predicate: (status: AgentStatus) => boolean, timeoutMs: number) => {
  const startedAt = Date.now();
  let lastStatus: AgentStatus | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/__agent/status`);
    } catch {
      await delay(250);
      continue;
    }

    if (response.ok) {
      lastStatus = (await response.json()) as AgentStatus;
      if (lastStatus.errors.length > 0) {
        throw new Error(lastStatus.errors.map((error) => error.message).join('\n'));
      }
      if (predicate(lastStatus)) return lastStatus;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for Motion Canvas agent: ${JSON.stringify(lastStatus)}`);
};

const post = async (path: string, body: Record<string, unknown> = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as {readonly error?: string};
  if (!response.ok || result.error) {
    throw new Error(result.error ?? `${path} failed with HTTP ${response.status}`);
  }
  return result;
};

const killProcessTree = async (child: ReturnType<typeof Bun.spawn>) => {
  if (child.exitCode !== null) return;

  if (process.platform === 'win32') {
    const taskkill = Bun.spawn(['taskkill', '/PID', String(child.pid), '/T', '/F'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    await taskkill.exited;
  } else {
    child.kill();
  }
};

const findRenderedVideo = async () => {
  const expectedPath = join(outputDirectory, 'motion-canvas.mp4');
  await stat(expectedPath);
  return expectedPath;
};

if (await fetch(baseUrl).then(() => true).catch(() => false)) {
  throw new Error('Port 9000 is already in use. Stop that server before rendering.');
}

const browserExecutable = await resolveBrowserExecutable();
const browserProfile = await mkdtemp(join(tmpdir(), 'xiranite-motion-canvas-'));
const vite = Bun.spawn(
  [process.execPath, 'x', 'vite', '--config', 'motion-canvas.vite.config.ts', '--port', '9000'],
  {cwd: projectRoot, stdout: 'inherit', stderr: 'inherit'},
);
let browser: ReturnType<typeof Bun.spawn> | undefined;

try {
  await waitForAgent(() => false, 1_000).catch(() => undefined);
  browser = Bun.spawn(
    [
      browserExecutable,
      '--headless=new',
      '--no-first-run',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      `--user-data-dir=${browserProfile}`,
      baseUrl,
    ],
    {stdout: 'ignore', stderr: 'inherit'},
  );

  await waitForAgent((status) => status.connected, 60_000);
  await post('/__agent/settings/size', {width: 1920, height: 1080});
  await post('/__agent/settings/preview-fps', {fps: 30});
  await post('/__agent/settings/rendering-fps', {fps: 30});
  await post('/__agent/settings/rendering-scale', {scale: 1});
  await post('/__agent/settings/range', {start: 0, end: 17});
  await post('/__agent/seek', {frame: 480});
  await post('/__agent/screenshot', {name: 'motion-canvas-final'});

  await post('/__agent/render', {exporter: '@motion-canvas/ffmpeg'});
  await waitForAgent((status) => status.rendering, 10_000);
  await waitForAgent((status) => !status.rendering, 300_000);

  const videoPath = await findRenderedVideo();
  console.log(`Motion Canvas video: ${videoPath}`);
} finally {
  if (browser) await killProcessTree(browser);
  await killProcessTree(vite);
  await rm(browserProfile, {recursive: true, force: true});
}
