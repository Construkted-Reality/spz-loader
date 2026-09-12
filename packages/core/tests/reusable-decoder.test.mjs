import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createSpzDecoder, loadSpz } from "../dist/index.js";

function point(x = 1) {
  const bytes = Buffer.alloc(35);
  bytes.writeUInt32LE(0x5053474e, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(1, 8);
  bytes[13] = 12;
  bytes.writeUIntLE(x * 4096, 16, 3);
  bytes[25] = 255;
  bytes.fill(128, 26, 29);
  bytes.fill(160, 29, 32);
  bytes.fill(128, 32, 35);
  return gzipSync(bytes);
}

test("matches one-shot decoding and preserves returned arrays", async () => {
  const expected = await loadSpz(point());
  assert.equal(expected.numPoints, 1);
  assert.equal(expected.positions[0], 1);
  const decoder = createSpzDecoder();
  const first = await decoder.loadSpz(point());
  assert.deepEqual(first, expected);
  await decoder.loadSpz(point(2));
  decoder.release();
  assert.deepEqual(first, expected);
  assert.deepEqual(await decoder.loadSpz(point()), expected);
  decoder.release();
});

test("serializes concurrent requests and accepts typed-array views", async () => {
  const decoder = createSpzDecoder();
  const input = point();
  const backing = new Uint8Array(input.length + 16);
  backing.set(input, 8);
  const results = await Promise.all([
    decoder.loadSpz(backing.subarray(8, 8 + input.length)),
    decoder.loadSpz(point(2)),
    decoder.loadSpz(point(3)),
  ]);
  assert.deepEqual(
    results.map((cloud) => cloud.positions[0]),
    [1, 2, 3],
  );
  decoder.release();
});

test("recovers queued requests after conversion fails", async () => {
  const decoder = createSpzDecoder();
  const failure = decoder.loadSpz(point(), {
    get colorScaleFactor() {
      throw new Error("conversion failed");
    },
  });
  const recovery = decoder.loadSpz(point(2));
  await assert.rejects(failure, /conversion failed/);
  assert.equal((await recovery).positions[0], 2);
  decoder.release();
});

test("release during initialization preserves pending results", async () => {
  const decoder = createSpzDecoder();
  const pending = decoder.loadSpz(point());
  await Promise.resolve();
  decoder.release();
  assert.equal((await pending).positions[0], 1);
  assert.equal((await decoder.loadSpz(point(2))).positions[0], 2);
  decoder.release();
});

test("supports independent decoders and repeated release", async () => {
  const first = createSpzDecoder();
  const second = createSpzDecoder();
  await first.loadSpz(point());
  first.release();
  first.release();
  assert.equal((await second.loadSpz(point(2))).positions[0], 2);
  assert.equal((await first.loadSpz(point(3))).positions[0], 3);
  first.release();
  second.release();
});

test("reuses a decoder for repeated allocations", async () => {
  const decoder = createSpzDecoder();
  const input = point();
  for (let i = 0; i < 2000; i++) {
    const cloud = await decoder.loadSpz(input);
    assert.equal(cloud.positions[0], 1);
  }
  decoder.release();
});

test("recovers queued requests after module initialization fails", async () => {
  const instantiate = WebAssembly.instantiate;
  let calls = 0;
  WebAssembly.instantiate = (...args) => {
    if (calls++ === 0) {
      return Promise.reject(new Error("initialization failed"));
    }
    return instantiate(...args);
  };
  const decoder = createSpzDecoder();
  try {
    const failure = decoder.loadSpz(point());
    const recovery = decoder.loadSpz(point(2));
    await assert.rejects(failure);
    assert.equal((await recovery).positions[0], 2);
    assert.ok(calls >= 2);
  } finally {
    WebAssembly.instantiate = instantiate;
    decoder.release();
  }
});

test("applies options separately to each request", async () => {
  const decoder = createSpzDecoder();
  const input = point();
  const options = {
    colorScaleFactor: 0,
    unpackOptions: { coordinateSystem: "RUB" },
  };
  assert.deepEqual(
    await decoder.loadSpz(input, options),
    await loadSpz(input, options),
  );
  assert.deepEqual(await decoder.loadSpz(input), await loadSpz(input));
  decoder.release();
});
