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
    /export PATH="\/workspace\/\.local\/bin:\/opt\/venv\/bin:\$PATH"/,
    "login shells must see user-installed console scripts before the immutable venv"
  );
  assert.match(
    dockerfile,
    /readOnlyRootFilesystem: true/,
    "the image must preserve the read-only-root filesystem security invariant"
  );
});
