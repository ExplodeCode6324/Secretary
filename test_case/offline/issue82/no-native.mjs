// Loaded only by product PTY tests, before tsx and the entrypoint.
process.dlopen = () => { throw new Error('Terminal product must not load native addons'); };
