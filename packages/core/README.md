# @spz-loader/core

## About

core logics for decode .spz

## Usage

Install like below.

```sh
# for npm
npm i @spz-loader/core

# for pnpm
pnpm add @spz-loader/core
```

Usage example of core package.

```ts
import { loadSpz } from "@spz-loader/core";

import spzUrl from "../assets/racoonfamily.spz?url";

const splat = await loadSpzFromUrl(spzUrl);
console.log(splat.numPoints);
```

## Reuse a decoder

Use `createSpzDecoder()` when you decode multiple files. Each decoder owns one WebAssembly module. Calls run in request order.

```ts
import { createSpzDecoder } from "@spz-loader/core";

const decoder = createSpzDecoder();
const first = await decoder.loadSpz(firstFile);
const second = await decoder.loadSpz(secondFile);
decoder.release();
```

The decoder retains its module between calls. Its memory can grow to fit the largest file. Call `release()` when idle to allow garbage collection. An active decode can finish. A later call creates a new module. Returned arrays remain valid after release.

A failed decode releases the cached module. The next queued call uses a new module. Separate decoder instances do not share memory.

The existing `loadSpz()` function still creates one module per call.
