import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("process probe distinguishes reboot, absent group, mismatch and permission failure without signaling", () => {
  const runner = new URL(
    "../../../src/pi_secretary/src/process-runner.py",
    import.meta.url,
  ).pathname;
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import importlib.util, sys
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('runner',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
r=dict(machine='fixture-host',boot='fixture-boot',pid=424242,pgid=424242,start='fixture-start',token='fixture-token')
with patch.object(m,'host_identity',return_value=dict(machine='fixture-host',boot='next-boot')), patch.object(m.os,'killpg') as kill:
 assert m.probe(r)=='STOPPED'; kill.assert_not_called()
with patch.object(m,'host_identity',return_value=dict(machine='another-host',boot='next-boot')), patch.object(m.os,'killpg') as kill:
 assert m.probe(r)=='UNCONFIRMED'; kill.assert_not_called()
for error, expected in [(ProcessLookupError(),'STOPPED'),(PermissionError(),'UNCONFIRMED')]:
 with patch.object(m,'host_identity',return_value=dict(machine=r['machine'],boot=r['boot'])), patch.object(m.os,'killpg',side_effect=error) as kill:
  assert m.probe(r)==expected; kill.assert_called_once_with(r['pgid'],0)
with patch.object(m,'host_identity',return_value=dict(machine=r['machine'],boot=r['boot'])), patch.object(m.os,'killpg') as kill, patch.object(m,'identity',return_value=dict(pgid=r['pgid'],start='different',command='python --run fixture-token')):
 assert m.probe(r)=='UNCONFIRMED'; kill.assert_called_once_with(r['pgid'],0)
`,
      runner,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
