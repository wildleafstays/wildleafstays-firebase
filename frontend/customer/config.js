window.WILDLEAF_CONFIG = Object.freeze({
  // Keep the public API same-origin by default. Phase 8 hosting will route /v1/**
  // to the canonical platform API without exposing server credentials.
  apiBaseUrl: "",
});
