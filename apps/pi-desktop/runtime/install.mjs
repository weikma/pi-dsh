/** Install an exact official Pi release into an isolated, locally owned npm project. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageName = "@earendil-works/pi-coding-agent";
const runtimeDir = dirname(fileURLToPath(import.meta.url));
const appRoot = dirname(runtimeDir);
const selector = process.argv[2] ?? "latest";
if (selector !== "latest" && !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(selector)) throw new Error("Use pi:install latest or an exact Pi version");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19)) throw new Error("Pi requires Node 22.19 or later");

const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/${selector}`);
if (!response.ok) throw new Error(`Official npm registry returned HTTP ${response.status}`);
const metadata = await response.json();
if (metadata.name !== packageName || typeof metadata.version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(metadata.version)
  || typeof metadata.dist?.integrity !== "string" || typeof metadata.gitHead !== "string"
  || metadata.repository?.url !== "git+https://github.com/earendil-works/pi.git") throw new Error("Registry metadata did not identify the official Pi release");
const version = metadata.version;
const installRoot = join(appRoot, ".pi-runtime", version);
await mkdir(installRoot, { recursive: true });
const installedPackagePath = join(installRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
let alreadyInstalled = false;
try {
  const existing = JSON.parse(await readFile(installedPackagePath, "utf8"));
  if (existing.name !== packageName || existing.version !== version) throw new Error("Existing runtime directory contains a different package; select another version or repair it while stopped");
  alreadyInstalled = true;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const packagePath = join(installRoot, "package.json");
try {
  await writeFile(packagePath, `${JSON.stringify({ name: `pi-desktop-runtime-${version}`, private: true, type: "module" }, null, 2)}\n`, { flag: "wx" });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
if (!alreadyInstalled) await new Promise((resolvePromise, reject) => {
  const child = spawn(npmCommand, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", "--registry=https://registry.npmjs.org", `${packageName}@${version}`], {
    cwd: installRoot, stdio: "inherit", windowsHide: true, shell: process.platform === "win32",
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => code === 0 && !signal ? resolvePromise() : reject(new Error(`Pi npm install failed (${signal ?? code})`)));
});
const installedPackage = JSON.parse(await readFile(installedPackagePath, "utf8"));
if (installedPackage.name !== packageName || installedPackage.version !== version || typeof installedPackage.bin?.pi !== "string") throw new Error("Installed Pi package differs from the selected release");
const lock = JSON.parse(await readFile(join(installRoot, "package-lock.json"), "utf8"));
const lockEntry = lock.packages?.[`node_modules/${packageName}`];
if (lockEntry?.version !== version || lockEntry?.integrity !== metadata.dist.integrity) throw new Error("Pi lockfile integrity differs from official registry metadata");
const cli = resolve(installRoot, "node_modules", "@earendil-works", "pi-coding-agent", installedPackage.bin.pi);
await new Promise((resolvePromise, reject) => {
  const child = spawn(process.execPath, [cli, "--version"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (text) => { stdout += text; });
  child.stderr.on("data", (text) => { stderr += text; });
  child.once("error", reject);
  child.once("close", (code, signal) => {
    if (code === 0 && !signal && stdout.trim() === version) resolvePromise();
    else reject(new Error(`Pi CLI version check failed (${signal ?? code}): ${stderr.trim()}`));
  });
});
const selected = { command: process.execPath, args: [cli], version, package: packageName, gitHead: metadata.gitHead, integrity: metadata.dist.integrity };
const temporary = join(runtimeDir, `.selected-${randomUUID()}.json`);
await writeFile(temporary, `${JSON.stringify(selected, null, 2)}\n`, { mode: 0o600, flag: "wx" });
await rename(temporary, join(runtimeDir, "selected.json"));
console.log(`Selected official Pi ${version}. Runtime and lockfile: ${installRoot}`);
