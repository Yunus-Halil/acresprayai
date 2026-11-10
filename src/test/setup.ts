import "@testing-library/jest-dom";

// The edge-function contract tests run under the `node` environment (they
// exercise server code), where `window` does not exist. Guard the DOM shims so
// one setup file can serve both environments.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}

// One turn of the event loop between tests. The image-reading test files run tens of seconds of back-to-back
// synchronous work in one worker (photoScout.test.ts: 50 s alone, 70-80 s in the full run); the worker's reports to
// the runner are answered by messages it can only read when its loop turns, and after 60 s its timer is read first:
// "Timeout calling onTaskUpdate", an unhandled error that failed the whole run (exit 1) with every test passing.
afterEach(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
