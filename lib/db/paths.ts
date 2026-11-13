import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where the SQLite database and uploaded photographs live.
 *
 * Local development / self-hosting: `<repo>/data`.
 * Serverless (Vercel, Lambda, Netlify): the deployment bundle is read-only, so we
 * fall back to the platform's temp directory. That directory survives for the
 * life of a warm instance but is NOT shared between instances and is wiped on
 * redeploy — fine for previewing the app, not for taking live orders. See the
 * deployment section of the README for the production path (Postgres/Turso).
 */

const isServerless = Boolean(
  process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY ||
    process.env.CF_PAGES,
);

let cachedDir: string | null = null;
let ephemeral = false;
let warned = false;

function canWrite(dir: string): boolean {
  try {
    if (fs.existsSync(dir)) {
      fs.accessSync(dir, fs.constants.W_OK);
    } else {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function getDataDir(): string {
  if (cachedDir) return cachedDir;

  const candidates: { dir: string; ephemeral: boolean; reason: string }[] = [];
  if (process.env.KB_DATA_DIR) {
    candidates.push({ dir: process.env.KB_DATA_DIR, ephemeral: false, reason: "KB_DATA_DIR" });
  }
  if (!isServerless) {
    candidates.push({ dir: path.join(process.cwd(), "data"), ephemeral: false, reason: "project data directory" });
  }
  candidates.push({ dir: path.join(os.tmpdir(), "khanbaba"), ephemeral: true, reason: "temporary directory" });

  for (const candidate of candidates) {
    if (canWrite(candidate.dir)) {
      cachedDir = candidate.dir;
      ephemeral = candidate.ephemeral;
      if (ephemeral && !warned) {
        warned = true;
        console.warn(
          `[khanbaba] No writable persistent data directory; using ${candidate.dir}. ` +
            "Data is ephemeral on this platform — configure KB_DATA_DIR or a hosted database for production.",
        );
      }
      return cachedDir;
    }
  }

  throw new Error(
    "Khan Baba could not find a writable data directory. Set KB_DATA_DIR to a persistent, writable path.",
  );
}

export function getUploadsDir(): string {
  const dir = path.join(getDataDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** True when orders written now will not survive a restart (serverless preview). */
export function isEphemeralStorage(): boolean {
  getDataDir();
  return ephemeral;
}

export function isServerlessRuntime(): boolean {
  return isServerless;
}
