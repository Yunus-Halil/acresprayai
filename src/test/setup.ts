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
