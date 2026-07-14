import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("exec image keeps root read-only while defaulting pip installs to writable user site", async () => {
  const dockerfile = await readFile(join(process.cwd(), "exec-image", "Dockerfile"), "utf8");

  assert.match(
    dockerfile,
    /python3 -m venv --system-site-packages \/opt\/venv/,
    "venv must expose Python user-site packages so runtime pip --user installs are importable"
  );
  assert.match(
    dockerfile,
    /ENV PYTHONUSERBASE="\/workspace\/\.local"/,
    "runtime Python user base must live on the writable session workspace"
  );
  assert.match(
    dockerfile,
    /ENV PIP_USER="1"/,
    "plain `pip install <pkg>` must default to a user install instead of read-only /opt/venv"
  );
  assert.match(
    dockerfile,
    /export PATH="\/workspace\/\.npm-global\/bin:\/workspace\/\.local\/bin:\/opt\/venv\/bin:\$PATH"/,
    "login shells must see npm-global, user-local, and venv bin in PATH before system paths"
  );
  assert.match(
    dockerfile,
    /readOnlyRootFilesystem: true/,
    "the image must preserve the read-only-root filesystem security invariant"
  );
});

test("exec image declares NPM_CONFIG_PREFIX under writable workspace", async () => {
  const dockerfile = await readFile(join(process.cwd(), "exec-image", "Dockerfile"), "utf8");

  assert.match(
    dockerfile,
    /ENV NPM_CONFIG_PREFIX="\/workspace\/\.npm-global"/,
    "NPM_CONFIG_PREFIX must be set to /workspace/.npm-global so npm install -g writes to the session workspace"
  );
});

test("exec image PATH includes npm-global bin before user-local bin before venv before system", async () => {
  const dockerfile = await readFile(join(process.cwd(), "exec-image", "Dockerfile"), "utf8");

  assert.match(
    dockerfile,
    /ENV PATH="\/workspace\/\.npm-global\/bin:\/workspace\/\.local\/bin:\/opt\/venv\/bin:\$PATH"/,
    "PATH ENV must start with /workspace/.npm-global/bin then /workspace/.local/bin then /opt/venv/bin"
  );
});

test("exec image login shell PATH includes npm-global bin", async () => {
  const dockerfile = await readFile(join(process.cwd(), "exec-image", "Dockerfile"), "utf8");

  assert.match(
    dockerfile,
    /export PATH="\/workspace\/\.npm-global\/bin:\/workspace\/\.local\/bin:\/opt\/venv\/bin:\$PATH"/,
    "/etc/profile.d/10-venv.sh must export the three-segment PATH for login shells"
  );
});

test("exec image installs tini for session pod init and reaping", async () => {
  const dockerfile = await readFile(join(process.cwd(), "exec-image", "Dockerfile"), "utf8");

  assert.match(
    dockerfile,
    /\btini\b/,
    "exec image must install tini so persistent session pods can reap terminated descendants"
  );
  assert.match(
    dockerfile,
    /\/usr\/bin\/tini --version/,
    "self-check must verify tini is present in the image"
  );
});

test("exec image self-check verifies bash brace expansion + pipefail + npm", async () => {
  const dockerfile = await readFile(join(process.cwd(), "exec-image", "Dockerfile"), "utf8");

  assert.match(
    dockerfile,
    /soffice --version/,
    "self-check must verify the real Office-to-PDF engine is present"
  );
  assert.match(
    dockerfile,
    /bash\s*-c\s*'\[\[ "\$\(echo \{a,b,c\}\)" = "a b c" \]\] && echo bash_brace_ok'/,
    "self-check must verify bash brace expansion and [[ ]] (the exact 2026-06-22 failure case)"
  );
  assert.match(
    dockerfile,
    /bash\s*-c\s*'set -o pipefail; true \| true && echo bash_pipefail_ok'/,
    "self-check must verify bash pipefail is available"
  );
  assert.match(dockerfile, /npm --version/, "self-check must verify npm is present");
});

test("exec image preinstalls curated document/data/image system and python baseline", async () => {
  const dockerfile = await readFile(join(process.cwd(), "exec-image", "Dockerfile"), "utf8");
  const requirements = await readFile(
    join(process.cwd(), "exec-image", "requirements.txt"),
    "utf8"
  );

  for (const pkg of [
    "libzbar0",
    "tesseract-ocr",
    "poppler-utils",
    "ghostscript",
    "libreoffice-core",
    "libreoffice-writer",
    "libreoffice-calc",
    "git",
    "libpangocairo-1.0-0",
    "shared-mime-info"
  ]) {
    assert.match(
      dockerfile,
      new RegExp(`\\b${pkg}\\b`),
      `system package ${pkg} must be preinstalled`
    );
  }

  for (const pkg of [
    "python-docx",
    "openpyxl",
    "weasyprint",
    "markdown",
    "xlsxwriter",
    "pypdf",
    "reportlab",
    "pyzbar",
    "qrcode",
    "pytesseract",
    "beautifulsoup4",
    "lxml",
    "jinja2",
    "seaborn",
    "python-dateutil",
    "pyyaml",
    "requests"
  ]) {
    assert.match(
      requirements,
      new RegExp(`^${pkg}==`, "m"),
      `python package ${pkg} must be pinned`
    );
  }
});
