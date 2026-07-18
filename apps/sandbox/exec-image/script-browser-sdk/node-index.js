"use strict";

const { execute } = require("/opt/persai-script-browser/persai-browser-cli.js");

function snapshot(input) {
  return execute({ ...input, action: "snapshot" });
}

function act(input) {
  return execute({ ...input, action: "act" });
}

module.exports = { browser: { snapshot, act }, snapshot, act };
