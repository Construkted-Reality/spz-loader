import MainModuleFactory from "./build/main";
import type { MainModule } from "./build/main";
import {
  type GaussianCloud,
  createGaussianCloudFromRaw,
  disposeRawGSCloud,
} from "./gaussianCloud";

type CoordinateSystemUnion = keyof MainModule["CoordinateSystem"];

interface ILoadSpzOptions {
  colorScaleFactor?: number;
  unpackOptions?: {
    coordinateSystem?: CoordinateSystemUnion;
  };
}

interface SpzDecoder {
  loadSpz(
    spzData: Uint8Array | ArrayBuffer,
    options?: ILoadSpzOptions,
  ): Promise<GaussianCloud>;
  /** Release the cached module. An active decode can finish. Later calls initialize a new module. */
  release(): void;
}

const decodeWithModule = (
  wasmModule: MainModule,
  spzData: Uint8Array | ArrayBuffer,
  options?: ILoadSpzOptions,
): GaussianCloud => {
  const spzBuffer =
    spzData instanceof Uint8Array ? spzData : new Uint8Array(spzData);
  const pointer = wasmModule._malloc(spzBuffer.length);
  if (pointer === 0) {
    throw new Error("couldn't allocate memory");
  }
  try {
    wasmModule.HEAPU8.set(spzBuffer, pointer);
    const coordinateSystem =
      wasmModule.CoordinateSystem[
        options?.unpackOptions?.coordinateSystem ?? "UNSPECIFIED"
      ];
    const rawGsCloud = wasmModule.load_spz(pointer, spzBuffer.length, {
      coordinateSystem,
    });
    try {
      return createGaussianCloudFromRaw(wasmModule, rawGsCloud, options);
    } finally {
      disposeRawGSCloud(wasmModule, rawGsCloud);
    }
  } finally {
    wasmModule._free(pointer);
  }
};

/** Decode SPZ data with a new WebAssembly module. */
const loadSpz = async (
  spzData: Uint8Array | ArrayBuffer,
  options?: ILoadSpzOptions,
): Promise<GaussianCloud> =>
  decodeWithModule(await MainModuleFactory(), spzData, options);

/**
 * Create an independent decoder that reuses its WebAssembly module.
 * Calls run in request order. A failed decode releases the module before the next call.
 * Call release() when idle to allow the module and its memory to be collected.
 */
const createSpzDecoder = (): SpzDecoder => {
  let modulePromise: Promise<MainModule> | undefined;
  let tail: Promise<void> = Promise.resolve();
  return {
    loadSpz(spzData, options) {
      const task = tail.then(async () => {
        const current = modulePromise ?? MainModuleFactory();
        modulePromise = current;
        try {
          return decodeWithModule(await current, spzData, options);
        } catch (error) {
          if (modulePromise === current) {
            modulePromise = undefined;
          }
          throw error;
        }
      });
      tail = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
    release() {
      modulePromise = undefined;
    },
  };
};

const loadSpzFromUrl = (
  url: string,
  options?: ILoadSpzOptions,
): Promise<GaussianCloud> =>
  fetch(url)
    .then((res) => res.arrayBuffer())
    .then((data) => loadSpz(data, options));

export {
  type ILoadSpzOptions,
  type SpzDecoder,
  loadSpz,
  loadSpzFromUrl,
  createSpzDecoder,
  type CoordinateSystemUnion,
};
