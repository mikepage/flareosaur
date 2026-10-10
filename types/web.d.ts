// Copyright 2026 the flareosaur authors. MIT license.
// Ambient types for `deno check` (see compilerOptions in deno.json).

// TypeScript's lib.dom limits BYOB views to ArrayBuffer-backed views, while
// workerd and Deno accept any ArrayBufferView. std is written against Deno's
// looser signatures.
interface ReadableStreamBYOBReader {
  read<T extends ArrayBufferView>(
    view: T,
    options?: { min?: number },
  ): Promise<ReadableStreamReadResult<T>>;
}
interface ReadableStreamBYOBRequest {
  respondWithNewView(view: ArrayBufferView): void;
}
interface ReadableByteStreamController {
  enqueue(chunk: ArrayBufferView): void;
}

// Workers bundlers (wrangler, @cloudflare/vite-plugin) import .wasm files as
// compiled modules.
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
