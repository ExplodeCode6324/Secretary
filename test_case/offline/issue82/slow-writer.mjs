// Test-only fault injection. No production option or altered durability policy.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = childProcess.spawn;
childProcess.spawn = function(executable, args, options) {
  if (executable === '/usr/bin/python3' && args?.[0]?.endsWith('/src/tui/writer.py')) {
    if (!process.env.TERMINAL_TEST_WRITER) throw Error('Missing synthetic slow writer');
    args = [process.env.TERMINAL_TEST_WRITER, ...args.slice(1)];
  }
  return original.call(this, executable, args, options);
};
syncBuiltinESMExports();
